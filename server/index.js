process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || "16";

import fs from "node:fs";
import http from "node:http";
import { performance } from "node:perf_hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import multer from "multer";
import { WebSocketServer } from "ws";

import { parseBuddyCard } from "./buddyCardParser.js";
import { sanitizeChatMessage, isFlooding } from "./chatFilter.js";
import { ChatLog } from "./chatLog.js";
import { BLOCKED_TILES, getMapPayload } from "./collisionMap.js";
import { BuddyTerminalDb } from "./db.js";
import { GameState } from "./gameState.js";
import { GhostManager } from "./ghostManager.js";
import { decodeMove } from "./protocol.js";
import { generateBuddySpriteSheet } from "./spriteGenerator.js";
import { SpriteCache } from "./spriteCache.js";
import { startTickLoop } from "./tickLoop.js";
import { TokenSpawner } from "./tokenSpawner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "../client");
const defaultBuddyRoot = path.join(clientRoot, "assets/default-buddies");

const MAX_PLAYERS = 500;
const MAX_CHAT_LENGTH = 80;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_EMOTES = new Set(["👋", "❤️", "✨", "😂"]);
const TOMBSTONE_PRUNE_INTERVAL_MS = 60_000;
const SESSION_CREATE_LIMIT = 5;
const SESSION_CREATE_WINDOW = 60_000;
const WS_BUFFER_LIMIT = 65_536;

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const gameState = new GameState();
const spriteCache = new SpriteCache();
const chatLog = new ChatLog();
const db = new BuddyTerminalDb();
const ghostManager = new GhostManager({ db, gameState, spriteCache, chatLog });
const tokenSpawner = new TokenSpawner({ gameState });
const defaultBuddies = loadDefaultBuddies();
const tombstones = new Map(db.loadTombstones().map((tombstone) => [tombstone.id, tombstone]));
const sessionCreationByIp = new Map();

ghostManager.hydrate();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES
  }
});

app.set("trust proxy", 1);
app.use(express.json({ limit: "250kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(express.static(clientRoot));

app.get("/api/bootstrap", (_req, res) => {
  res.json({
    map: getMapPayload(),
    defaultBuddies,
    blockedTiles: Array.from(BLOCKED_TILES),
    allowedEmotes: Array.from(ALLOWED_EMOTES),
    limits: {
      maxNameLength: 16,
      maxChatLength: MAX_CHAT_LENGTH,
      maxPlayers: MAX_PLAYERS
    },
    auraSettings: {
      enabledByDefault: false,
      tooltipRange: 3
    },
    rateLimits: {
      moves: { max: 20, windowMs: 1000 },
      chat: { max: 5, windowMs: 10_000, cooldownMs: 30_000 },
      emote: { max: 3, windowMs: 5000, cooldownMs: 10_000 }
    },
    tokenSettings: {
      maxActiveLines: tokenSpawner.maxActiveLines,
      respawnDelayMs: 30_000
    },
    ghostSettings: {
      gracePeriodMs: 10_000
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    players: gameState.getOnlineCount(),
    ghosts: Array.from(gameState.players.values()).filter((entity) => entity.isGhost).length,
    tombstones: tombstones.size,
    tokens: tokenSpawner.getSerializedTokens().length
  });
});

app.post("/api/process-sprite", upload.single("buddy"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Missing buddy image." });
    }

    if (!isSupportedImageType(file.mimetype)) {
      return res.status(400).json({ error: "Only PNG, JPG, or GIF uploads are supported." });
    }

    const parsed = await parseBuddyCard(file.buffer);
    const generated = await generateBuddySpriteSheet({
      sourceBuffer: file.buffer,
      cropRegion: parsed.cropRegion,
      dominantColor: parsed.buddyMeta?.dominantColor
    });

    const entry = {
      kind: "sheet",
      hasRealBuddy: parsed.looksCardLike,
      buddyMeta: parsed.buddyMeta
    };
    const spriteHash = spriteCache.register(generated.spriteSheet, "image/png", entry);
    db.saveSprite(spriteHash, {
      ...entry,
      buffer: generated.spriteSheet,
      mimeType: "image/png"
    });

    return res.json({
      spriteHash,
      spriteUrl: `/sprites/${spriteHash}.png`,
      spriteFormat: "sheet",
      hasRealBuddy: parsed.looksCardLike,
      buddyMeta: parsed.buddyMeta
    });
  } catch (error) {
    console.error("sprite processing failed", error);
    return res.status(400).json({
      error: error.message || "Unable to process buddy sprite."
    });
  }
});

app.get("/sprites/:hash.png", (req, res) => {
  const sprite = spriteCache.get(req.params.hash);
  if (!sprite) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", sprite.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(sprite.buffer);
});

app.post("/api/session", (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const currentTime = Date.now();
  const history = sessionCreationByIp.get(ip) || [];
  const recent = history.filter((timestamp) => currentTime - timestamp < SESSION_CREATE_WINDOW);
  if (recent.length >= SESSION_CREATE_LIMIT) {
    return res.status(429).json({ error: "Too many sessions. Try again in a minute." });
  }
  recent.push(currentTime);
  sessionCreationByIp.set(ip, recent);

  if (gameState.getOnlineCount() >= MAX_PLAYERS) {
    return res.status(503).json({
      error: `World is full! ${gameState.getOnlineCount()}/${MAX_PLAYERS} explorers online. Try again in a moment.`
    });
  }

  const { name, defaultBuddyId, spriteHash } = req.body ?? {};
  const sanitizedName = sanitizeName(name);

  if (!sanitizedName) {
    return res.status(400).json({ error: "Enter a valid display name." });
  }

  let sessionConfig;

  if (typeof defaultBuddyId === "string" && defaultBuddies.some((buddy) => buddy.id === defaultBuddyId)) {
    const buddy = defaultBuddies.find((entry) => entry.id === defaultBuddyId);
    sessionConfig = {
      spriteType: "default",
      spriteRef: buddy.url,
      spriteFormat: "sprite",
      hasRealBuddy: false,
      buddyMeta: null
    };
  } else if (typeof spriteHash === "string") {
    const cachedSprite = spriteCache.get(spriteHash);
    if (!cachedSprite) {
      return res.status(400).json({ error: "Upload your buddy again before entering the world." });
    }

    sessionConfig = {
      spriteType: "custom",
      spriteRef: `/sprites/${spriteHash}.png`,
      spriteHash,
      spriteFormat: cachedSprite.kind ?? "sheet",
      hasRealBuddy: cachedSprite.hasRealBuddy ?? false,
      buddyMeta: cachedSprite.buddyMeta ?? null
    };
  } else {
    return res.status(400).json({ error: "Choose a buddy before entering the world." });
  }

  const session = gameState.createSession({
    name: sanitizedName,
    ...sessionConfig
  });

  return res.json({
    token: session.token,
    name: sanitizedName,
    ...sessionConfig
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientRoot, "index.html"));
});

wss.on("connection", (ws, request) => {
  if (gameState.getOnlineCount() >= MAX_PLAYERS) {
    ws.close(4003, "World is full.");
    return;
  }

  const url = new URL(request.url, "http://localhost");
  const token = url.searchParams.get("token");
  const session = token ? gameState.consumeSession(token) : null;

  if (!session) {
    ws.close(4001, "Invalid or expired session.");
    return;
  }

  const player = ghostManager.wakeOrAdmitPlayer({
    ws,
    session,
    broadcastJsonToAll,
    onTombstonesRemoved(ids) {
      removeTombstones(ids);
    }
  });

  ws.playerId = player.id;

  sendJson(ws, {
    type: "state",
    selfId: player.id,
    selfIndex: player.playerIndex,
    onlineCount: gameState.getOnlineCount(),
    map: getMapPayload(),
    players: gameState.getSerializedPlayers(),
    tokens: tokenSpawner.getSerializedTokens(),
    selfTokenCount: player.tokenCount ?? 0,
    tombstones: Array.from(tombstones.values()),
    chatHistory: getRecentChatEntries()
  });
  broadcastPlayerJoined(player);

  ws.on("message", (rawMessage, isBinary) => {
    const currentPlayer = gameState.getPlayer(player.id);
    if (!currentPlayer || currentPlayer.isGhost || !currentPlayer.isConnected) {
      return;
    }

    gameState.setHeartbeat(player.id);

    if (isBinary) {
      if (rawMessage.length !== 4) {
        return;
      }

      const rate = currentPlayer.rateLimits.moves.allow();
      if (!rate.ok) {
        const noticeNow = performance.now();
        if (!currentPlayer._lastMoveThrottleNotice || noticeNow - currentPlayer._lastMoveThrottleNotice > 3000) {
          sendJson(ws, {
            type: "chat_notice",
            message: "Moving too fast! Slow down a bit."
          });
          currentPlayer._lastMoveThrottleNotice = noticeNow;
        }
        return;
      }

      const decoded = decodeMove(rawMessage);
      if (!decoded) {
        return;
      }

      const result = gameState.moveEntity(player.id, decoded.x, decoded.y, decoded.direction);
      if (!result.ok) {
        sendJson(ws, {
          type: "move_rejected",
          reason: result.reason,
          x: currentPlayer.x,
          y: currentPlayer.y,
          direction: currentPlayer.direction
        });
      } else {
        handleTokenCollection(result.player);
      }
      return;
    }

    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    handleJsonMessage(currentPlayer, message);
  });

  ws.on("close", () => {
    const leavingPlayer = gameState.markDisconnected(player.id, "disconnect");
    if (!leavingPlayer) {
      return;
    }

    ghostManager.scheduleTransition(player.id, {
      onGhostSpawn(ghost) {
        broadcastJsonToAll({
          type: "ghost_spawn",
          ghost: gameState.serializePlayer(ghost),
          onlineCount: gameState.getOnlineCount()
        });
      },
      onGhostEvicted(id) {
        handleGhostEviction(id);
      }
    });

    broadcastJsonToAll({
      type: "presence",
      onlineCount: gameState.getOnlineCount()
    });
  });
});

startTickLoop({
  gameState,
  ghostManager,
  tokenSpawner,
  onTimeoutPlayers(timedOutPlayers) {
    for (const player of timedOutPlayers) {
      try {
        player.ws?.close(4000, "Timed out");
      } catch {
        // Ignore close failures during cleanup.
      }

      const leavingPlayer = gameState.markDisconnected(player.id, "timeout");
      if (!leavingPlayer) {
        continue;
      }

      ghostManager.scheduleTransition(player.id, {
        onGhostSpawn(ghost) {
          broadcastJsonToAll({
            type: "ghost_spawn",
            ghost: gameState.serializePlayer(ghost),
            onlineCount: gameState.getOnlineCount()
          });
        },
        onGhostEvicted(id) {
          handleGhostEviction(id);
        }
      });
    }

    broadcastJsonToAll({
      type: "presence",
      onlineCount: gameState.getOnlineCount()
    });
  },
  onGhostChat(ghost, message, entry) {
    broadcastJsonToNearby(ghost, {
      type: "ghost_chat",
      id: ghost.id,
      message,
      entry
    });
  },
  onGhostEmote(ghost, emote, entry) {
    broadcastJsonToNearby(ghost, {
      type: "ghost_emote",
      id: ghost.id,
      emote,
      entry
    });
  },
  onGhostEvicted(eviction) {
    handleGhostEviction(eviction);
  },
  onTokensSpawned(tokens) {
    broadcastJsonToAll({
      type: "tokens_spawned",
      tokens
    });
  }
});

const tombstonePruner = setInterval(() => {
  removeTombstones(db.pruneExpiredTombstones());
}, TOMBSTONE_PRUNE_INTERVAL_MS);

tombstonePruner.unref?.();

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Buddy Terminal is running on http://localhost:${port}`);
});

function handleJsonMessage(player, message) {
  switch (message.type) {
    case "chat": {
      const rate = player.rateLimits.chat.allow();
      if (!rate.ok) {
        sendJson(player.ws, {
          type: "chat_notice",
          message: `Slow down! Wait ${Math.max(1, Math.ceil(rate.cooldownRemainingMs / 1000))}s before chatting again.`
        });
        chatLog.record({
          kind: "chat_dropped",
          reason: "rate_limit",
          playerId: player.id,
          playerName: player.name
        });
        return;
      }

      const sanitized = sanitizeChatMessage(message.message);
      if (!sanitized.ok) {
        chatLog.record({
          kind: "chat_dropped",
          reason: sanitized.reason,
          playerId: player.id,
          playerName: player.name
        });
        return;
      }

      if (isFlooding(player.recentChatInputs, sanitized.cleaned)) {
        chatLog.record({
          kind: "chat_dropped",
          reason: "flood",
          playerId: player.id,
          playerName: player.name,
          message: sanitized.cleaned
        });
        return;
      }

      gameState.rememberChatInput(player.id, sanitized.cleaned);
      gameState.setChat(player.id, sanitized.cleaned, 6000);
      const entry = chatLog.record({
        kind: "chat",
        playerId: player.id,
        playerName: player.name,
        message: sanitized.cleaned,
        dominantColor: player.buddyMeta?.dominantColor ?? "#f2d36a",
        rarity: player.buddyMeta?.rarity ?? "common"
      });
      broadcastJsonToNearby(player, {
        type: "player_chat",
        id: player.id,
        message: sanitized.cleaned,
        entry
      });
      ghostManager.reactToNearbyChat(player, {
        onGhostChat(ghost, ghostMessage, ghostEntry) {
          broadcastJsonToNearby(ghost, {
            type: "ghost_chat",
            id: ghost.id,
            message: ghostMessage,
            entry: ghostEntry
          });
        },
        onGhostEmote(ghost, emote, ghostEntry) {
          broadcastJsonToNearby(ghost, {
            type: "ghost_emote",
            id: ghost.id,
            emote,
            entry: ghostEntry
          });
        }
      });
      return;
    }
    case "emote": {
      const rate = player.rateLimits.emote.allow();
      if (!rate.ok) {
        sendJson(player.ws, {
          type: "chat_notice",
          message: `Easy there. Emotes recharge in ${Math.max(1, Math.ceil(rate.cooldownRemainingMs / 1000))}s.`
        });
        return;
      }

      const emote = sanitizeEmote(message.emote);
      if (!emote) {
        return;
      }

      gameState.setEmote(player.id, emote, 4500);
      const entry = chatLog.record({
        kind: "emote",
        playerId: player.id,
        playerName: player.name,
        message: emote,
        dominantColor: player.buddyMeta?.dominantColor ?? "#f2d36a",
        rarity: player.buddyMeta?.rarity ?? "common"
      });
      broadcastJsonToNearby(player, {
        type: "player_emote",
        id: player.id,
        emote,
        entry
      });
      return;
    }
    case "heartbeat":
      gameState.setHeartbeat(player.id);
      return;
    default:
      return;
  }
}

function broadcastPlayerJoined(player) {
  broadcastJsonToAll({
    type: "player_joined",
    player: gameState.serializePlayer(player),
    onlineCount: gameState.getOnlineCount()
  });
}

function handleGhostEviction(eviction) {
  const payload = typeof eviction === "string"
    ? { id: eviction, tombstone: null }
    : eviction;

  broadcastJsonToAll({
    type: "ghost_evicted",
    id: payload.id
  });

  if (payload.tombstone) {
    tombstones.set(payload.tombstone.id, payload.tombstone);
    broadcastJsonToAll({
      type: "tombstone_added",
      tombstone: payload.tombstone
    });
  }
}

function handleTokenCollection(player) {
  const collected = tokenSpawner.collectAtPosition(player.id, player.x, player.y);
  if (!collected) {
    return;
  }

  broadcastJsonToNearby(player, {
    type: "token_collected",
    tokenId: collected.tokenId,
    playerId: collected.playerId,
    x: collected.x,
    y: collected.y,
    newCount: collected.newCount
  });

  if (collected.lineCleared) {
    broadcastJsonToAll({
      type: "token_line_cleared",
      lineId: collected.lineCleared
    });
  }
}

function removeTombstones(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    return;
  }

  for (const id of ids) {
    if (!tombstones.has(id)) {
      continue;
    }

    tombstones.delete(id);
    broadcastJsonToAll({
      type: "tombstone_removed",
      id
    });
  }
}

function broadcastJsonToAll(payload) {
  for (const player of gameState.getLiveRecipients()) {
    sendJson(player.ws, payload);
  }
}

function broadcastJsonToNearby(sourcePlayer, payload) {
  const nearbyPlayers = gameState.getVisiblePlayersFor(sourcePlayer);
  for (const player of nearbyPlayers) {
    if (!player.isGhost && player.isConnected && player.ws) {
      sendJson(player.ws, payload);
    }
  }
}

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== 1) {
    return;
  }

  if (ws.bufferedAmount > WS_BUFFER_LIMIT) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

function sanitizeName(input) {
  const raw = typeof input === "string" ? input.trim() : "";
  const cleaned = raw.replace(/[^a-zA-Z0-9_ ]/g, "").slice(0, 16).trim();
  return cleaned || null;
}

function sanitizeEmote(input) {
  return ALLOWED_EMOTES.has(input) ? input : null;
}

function isSupportedImageType(mimeType) {
  return ["image/png", "image/jpeg", "image/gif"].includes(mimeType);
}

function loadDefaultBuddies() {
  if (!fs.existsSync(defaultBuddyRoot)) {
    return [];
  }

  return fs.readdirSync(defaultBuddyRoot)
    .filter((fileName) => /\.(svg|png|jpg|jpeg|gif)$/iu.test(fileName))
    .map((fileName) => {
      const id = fileName.replace(/\.[^.]+$/u, "");
      return {
        id,
        label: toTitle(id),
        url: `/assets/default-buddies/${fileName}`
      };
    });
}

function getRecentChatEntries(limit = 50) {
  return chatLog
    .getRecent(limit * 2)
    .filter((entry) => /chat|emote/u.test(entry.kind))
    .slice(-limit);
}

function toTitle(slug) {
  return slug
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
