import { ChatPanel } from "./chatPanel.js";
import { FirstPersonController } from "./fpController.js";
import { stepRemotePlayers, applyRemoteMovement } from "./interpolation.js";
import { BuddyNetwork } from "./network.js";
import { OnboardingController } from "./onboarding.js";
import { RaycastRenderer } from "./raycastRenderer.js";
import { ClientSpriteCache } from "./spriteCache.js";
import { buildSpriteSheetFromUrl, loadSpriteSheetAsset } from "./spriteGen.js";
import { TokenHUD } from "./tokenHUD.js";
import { bindTouchControls } from "./touchControls.js";

const DEFAULT_BLOCKED_TILES = [2, 3, 4, 5, 7, 8, 10];
const DEFAULT_ALLOWED_EMOTES = ["👋", "❤️", "✨", "😂"];

const state = {
  bootstrap: null,
  map: null,
  players: new Map(),
  tombstones: new Map(),
  tokens: new Map(),
  playerIndexToId: new Map(),
  localPlayerId: null,
  spriteCache: new ClientSpriteCache(),
  network: null,
  renderer: null,
  controller: null,
  chatPanel: null,
  tokenHud: null,
  chatOpen: false,
  auraEnabled: true,
  heartbeatTimer: null,
  blockedTiles: new Set(DEFAULT_BLOCKED_TILES),
  allowedEmotes: DEFAULT_ALLOWED_EMOTES,
  hasSeenGhostExplainer: false,
  tutorialBubble: {
    text: "",
    expiresAt: 0,
    visible: false
  },
  lastFrameAt: performance.now(),
  lastMovementSentAt: 0,
  lastSentState: null
};

init();

async function init() {
  state.bootstrap = await fetchJson("/api/bootstrap");
  state.renderer = new RaycastRenderer(document.getElementById("gameCanvas"));
  state.controller = new FirstPersonController({
    canvas: document.getElementById("gameCanvas"),
    isChatting: () => state.chatOpen
  });
  state.controller.attach();

  state.blockedTiles = new Set(state.bootstrap.blockedTiles || DEFAULT_BLOCKED_TILES);
  state.allowedEmotes = state.bootstrap.allowedEmotes || DEFAULT_ALLOWED_EMOTES;
  state.auraEnabled = state.bootstrap.auraSettings?.enabledByDefault ?? true;
  state.chatPanel = new ChatPanel({
    root: document.getElementById("chatPanel"),
    list: document.getElementById("chatPanelMessages"),
    status: document.getElementById("chatPanelStatus")
  });
  state.tokenHud = new TokenHUD(document.getElementById("tokenCount"));

  setupChatControls();
  setupTouchControls();
  setupHudControls();

  const onboarding = new OnboardingController({
    bootstrap: state.bootstrap,
    onEnterWorld: async ({ session, localSpriteSheet, displayName }) => {
      await enterWorld(session, localSpriteSheet, displayName);
    }
  });

  await onboarding.init();
  window.addEventListener("resize", handleResize);
  requestAnimationFrame(gameLoop);
}

async function enterWorld(session, localSpriteSheet, displayName) {
  const fadeOverlay = document.getElementById("fadeOverlay");
  fadeOverlay.classList.add("active");

  if (session.spriteRef && localSpriteSheet) {
    state.spriteCache.prime(session.spriteRef, localSpriteSheet);
  }

  state.network = new BuddyNetwork({
    token: session.token,
    handlers: {
      onJson: handleNetworkJson,
      onBatch: handleNetworkBatch,
      onClose() {
        document.getElementById("playerSummary").textContent = "Connection closed. Refresh to rejoin.";
      }
    }
  });

  await state.network.connect();

  document.getElementById("landingScreen").classList.add("hidden");
  document.getElementById("gameScreen").classList.remove("hidden");
  document.getElementById("playerSummary").textContent = `🧭 ${displayName} · click to look`;

  setTimeout(() => {
    fadeOverlay.classList.remove("active");
  }, 320);

  clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = setInterval(() => {
    state.network?.sendHeartbeat();
  }, 10_000);
}

function handleNetworkJson(message) {
  switch (message.type) {
    case "state":
      hydrateState(message);
      break;
    case "player_joined":
      upsertPlayer(message.player);
      updateOnlineCount(message.onlineCount);
      if (message.player?.id !== state.localPlayerId) {
        announce("A new player joined the campus");
      }
      break;
    case "ghost_spawn":
      upsertPlayer(message.ghost);
      if (message.ghost?.id) {
        setBubble(message.ghost.id, "boo... still here ✨", "chat");
      }
      if (!state.hasSeenGhostExplainer) {
        state.hasSeenGhostExplainer = true;
        state.chatPanel.addNotice("👻 Ghost buddies keep the world alive when players log off.");
      }
      updateOnlineCount(message.onlineCount);
      break;
    case "ghost_wake": {
      const player = state.players.get(message.playerId || message.ghostId);
      if (player) {
        player.isGhost = false;
        player.isSleeping = false;
        player.ghostTransition = null;
        setBubble(player.id, "I'm back! 👋", "chat");
      }
      break;
    }
    case "ghost_sleep": {
      const player = state.players.get(message.id);
      if (player) {
        setGhostSleepState(player, true, message.fadeDuration ?? 3000);
      }
      break;
    }
    case "ghost_wake_ambient": {
      const player = state.players.get(message.id);
      if (player) {
        player.isGhost = true;
        player.x = message.x ?? player.x;
        player.y = message.y ?? player.y;
        player.renderX = player.x;
        player.renderY = player.y;
        setGhostSleepState(player, false, message.fadeDuration ?? 2000);
      }
      break;
    }
    case "ghost_evicted":
      removePlayer(message.id);
      break;
    case "tokens_spawned":
      for (const token of message.tokens || []) {
        upsertToken(token);
      }
      break;
    case "token_collected":
      removeToken(message.tokenId);
      state.renderer.recordTokenCollection({
        x: message.x,
        y: message.y,
        label: "+1"
      });
      if (message.playerId) {
        const collector = state.players.get(message.playerId);
        if (collector) {
          collector.tokenCount = message.newCount ?? collector.tokenCount ?? 0;
        }
      }
      if (message.playerId === state.localPlayerId) {
        state.tokenHud.setCount(message.newCount ?? 0);
        state.tokenHud.pulse();
      }
      break;
    case "token_line_cleared":
      state.chatPanel.addNotice("A compute line was cleared. Another will spin up soon.");
      break;
    case "tombstone_added":
      upsertTombstone(message.tombstone);
      break;
    case "tombstone_removed":
      removeTombstone(message.id);
      break;
    case "player_chat":
    case "ghost_chat":
      setBubble(message.id, message.message, "chat");
      if (message.entry) {
        state.chatPanel.addEntry(message.entry);
      }
      announce(`${getSpeakerName(message.id)} says: ${message.message}`);
      break;
    case "player_emote":
    case "ghost_emote":
      setBubble(message.id, message.emote, "emote");
      if (message.entry) {
        state.chatPanel.addEntry(message.entry);
      }
      break;
    case "chat_notice":
      state.chatPanel.addNotice(message.message);
      break;
    case "presence":
      updateOnlineCount(message.onlineCount);
      break;
    case "move_rejected":
      reconcileLocalMove(message);
      break;
    default:
      break;
  }
}

function handleNetworkBatch(moves) {
  for (const move of moves) {
    const playerId = state.playerIndexToId.get(move.playerIndex);
    if (!playerId) {
      continue;
    }

    const player = state.players.get(playerId);
    if (!player) {
      continue;
    }

    if (player.isLocal) {
      player.x = move.x;
      player.y = move.y;
      player.angle = normalizeAngle(move.angle);
      player.renderX = move.x;
      player.renderY = move.y;
      player.renderAngle = player.angle;
      player.direction = directionFromAngle(player.angle);
      continue;
    }

    applyRemoteMovement(player, move.x, move.y, normalizeAngle(move.angle));
  }
}

function hydrateState(message) {
  state.map = message.map;
  state.localPlayerId = message.selfId;
  state.players.clear();
  state.tombstones.clear();
  state.tokens.clear();
  state.playerIndexToId.clear();

  message.players.forEach((player) => upsertPlayer(player));
  (message.tokens || []).forEach((token) => upsertToken(token));
  (message.tombstones || []).forEach((tombstone) => upsertTombstone(tombstone));
  state.chatPanel.setEntries(message.chatHistory || []);
  state.tokenHud.setCount(message.selfTokenCount || 0);
  updateOnlineCount(message.onlineCount);

  if (message.map?.sign?.message) {
    showTutorialBubble(message.map.sign.message);
  }

  if (!state.hasSeenGhostExplainer && message.players.some((player) => player.isGhost)) {
    state.hasSeenGhostExplainer = true;
    state.chatPanel.addNotice("👻 Ghost buddies keep the campus alive between human visits.");
  }
}

function upsertPlayer(data) {
  const angle = normalizeAngle(data.angle ?? angleFromDirection(data.direction));
  let player = state.players.get(data.id);
  if (!player) {
    player = {
      id: data.id,
      playerIndex: data.playerIndex,
      name: data.name,
      x: data.x,
      y: data.y,
      renderX: data.x,
      renderY: data.y,
      prevRenderX: data.x,
      prevRenderY: data.y,
      targetX: data.x,
      targetY: data.y,
      angle,
      renderAngle: angle,
      prevRenderAngle: angle,
      targetAngle: angle,
      direction: directionFromAngle(angle),
      spriteType: data.spriteType,
      spriteRef: data.spriteRef,
      spriteFormat: data.spriteFormat,
      hasRealBuddy: Boolean(data.hasRealBuddy),
      buddyMeta: data.buddyMeta,
      isGhost: Boolean(data.isGhost),
      isDormant: Boolean(data.isDormant),
      isSleeping: Boolean(data.isSleeping),
      ghostData: data.ghostData,
      ghostTransition: null,
      activeBubble: null,
      tokenCount: data.tokenCount || 0,
      isLocal: data.id === state.localPlayerId
    };
    state.players.set(data.id, player);
  } else {
    player.name = data.name;
    player.x = data.x;
    player.y = data.y;
    player.angle = angle;
    player.renderAngle = angle;
    player.direction = directionFromAngle(angle);
    player.spriteType = data.spriteType;
    player.spriteRef = data.spriteRef;
    player.spriteFormat = data.spriteFormat;
    player.hasRealBuddy = Boolean(data.hasRealBuddy);
    player.buddyMeta = data.buddyMeta;
    player.isGhost = Boolean(data.isGhost);
    player.isDormant = Boolean(data.isDormant);
    player.isSleeping = Boolean(data.isSleeping);
    player.ghostData = data.ghostData;
    player.tokenCount = data.tokenCount || 0;
  }

  player.isLocal = data.id === state.localPlayerId;
  if (!player.isGhost) {
    player.isSleeping = false;
    player.ghostTransition = null;
  } else if (!player.ghostTransition) {
    player.ghostTransition = {
      from: player.isSleeping ? 0 : 1,
      to: player.isSleeping ? 0 : 1,
      startedAt: performance.now(),
      durationMs: 1
    };
  }

  state.playerIndexToId.set(data.playerIndex, data.id);

  if (data.chatMessage) {
    setBubble(data.id, data.chatMessage, "chat");
  }
  if (data.emote) {
    setBubble(data.id, data.emote, "emote");
  }

  ensureSpriteSheet(player);
  return player;
}

function upsertToken(data) {
  if (!data?.id) {
    return null;
  }

  const token = {
    id: data.id,
    x: data.x,
    y: data.y,
    lineId: data.lineId
  };
  state.tokens.set(token.id, token);
  return token;
}

function removeToken(id) {
  state.tokens.delete(id);
}

function removePlayer(id) {
  const player = state.players.get(id);
  if (!player) {
    return;
  }
  state.players.delete(id);
  state.playerIndexToId.delete(player.playerIndex);
}

function ensureSpriteSheet(player) {
  if (!player.spriteRef) {
    return;
  }

  const loader = player.spriteFormat === "sheet"
    ? () => loadSpriteSheetAsset(player.spriteRef)
    : () => buildSpriteSheetFromUrl(player.spriteRef);

  state.spriteCache
    .getOrCreate(player.spriteRef, loader)
    .then((spriteSheet) => {
      player.spriteSheet = spriteSheet;
    })
    .catch((error) => {
      console.error("sprite load failed", error);
    });
}

function upsertTombstone(data) {
  if (!data?.id) {
    return null;
  }

  const tombstone = {
    id: data.id,
    ghostId: data.ghostId,
    buddyName: data.buddyName,
    rarity: data.rarity || "common",
    rarityStars: data.rarityStars || 1,
    species: data.species || "terminal friend",
    dominantColor: data.dominantColor || "#9aa6a0",
    x: data.x,
    y: data.y,
    epitaph: data.epitaph || `Here rests ${data.buddyName || "a terminal friend"}`,
    createdAt: data.createdAt,
    expiresAt: data.expiresAt
  };

  state.tombstones.set(tombstone.id, tombstone);
  return tombstone;
}

function removeTombstone(id) {
  state.tombstones.delete(id);
}

function setBubble(playerId, text, kind = "chat") {
  const player = state.players.get(playerId);
  if (!player) {
    return;
  }
  player.activeBubble = {
    text,
    kind,
    expiresAt: performance.now() + 6000
  };
}

function reconcileLocalMove(message) {
  const localPlayer = state.players.get(state.localPlayerId);
  if (!localPlayer) {
    return;
  }

  localPlayer.x = message.x;
  localPlayer.y = message.y;
  localPlayer.angle = normalizeAngle(message.angle ?? localPlayer.angle);
  localPlayer.renderX = localPlayer.x;
  localPlayer.renderY = localPlayer.y;
  localPlayer.renderAngle = localPlayer.angle;
  localPlayer.direction = directionFromAngle(localPlayer.angle);
}

function updateOnlineCount(count) {
  document.getElementById("onlineCount").textContent = `🌐 ${count} online`;
}

function showTutorialBubble(message) {
  state.tutorialBubble = {
    text: message,
    expiresAt: performance.now() + 7000,
    visible: true
  };
}

function hideTutorialBubble() {
  state.tutorialBubble.visible = false;
}

function setupChatControls() {
  const chatBar = document.getElementById("chatBar");
  const chatInput = document.getElementById("chatInput");
  const sendButton = document.getElementById("sendChatButton");
  const chatCounter = document.getElementById("chatCounter");
  const maxChatLength = state.bootstrap?.limits?.maxChatLength ?? 80;

  chatInput.maxLength = maxChatLength;

  const updateCounter = () => {
    chatCounter.textContent = `${chatInput.value.length}/${maxChatLength}`;
  };

  sendButton.addEventListener("click", sendChat);
  chatInput.addEventListener("input", updateCounter);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendChat();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeChat();
    }
  });

  function sendChat() {
    const text = chatInput.value.trim().slice(0, maxChatLength);
    if (!text) {
      closeChat();
      return;
    }

    console.info("[CHAT] Sending message:", text);

    if (!state.network?.isOpen()) {
      console.error("[CHAT] WebSocket not connected");
      state.chatPanel.addNotice("Not connected to the world yet. Try again in a moment.");
      return;
    }

    const sent = state.network.sendChat(text);
    if (!sent) {
      console.error("[CHAT] Failed to send message");
      state.chatPanel.addNotice("Couldn't send chat right now. Connection looks sleepy.");
      return;
    }

    if (state.localPlayerId) {
      setBubble(state.localPlayerId, text, "chat");
    }

    console.info("[CHAT] Message sent to server");
    chatInput.value = "";
    updateCounter();
    closeChat();
  }

  updateCounter();
  window.__buddySendChat = sendChat;
  window.__buddyChatBar = chatBar;
  window.__buddyChatInput = chatInput;
}

function setupTouchControls() {
  const root = document.getElementById("touchControls");
  bindTouchControls(root, {
    onMove(x, y) {
      state.controller.setMoveVector(x, y);
    },
    onLook(x) {
      state.controller.setLookVector(x);
    },
    onChat: toggleChat,
    onEmote: sendEmote
  });
}

function setupHudControls() {
  const toggleAurasButton = document.getElementById("toggleAurasButton");
  const toggleChatPanelButton = document.getElementById("toggleChatPanelButton");

  toggleAurasButton.addEventListener("click", () => {
    state.auraEnabled = !state.auraEnabled;
    updateAuraToggle();
  });

  toggleChatPanelButton.addEventListener("click", () => {
    toggleChatPanel();
  });

  updateAuraToggle();

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      toggleChat();
    } else if (event.key === "Escape" && state.chatOpen) {
      event.preventDefault();
      closeChat();
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleChatPanel();
    } else if (event.key.toLowerCase() === "h") {
      event.preventDefault();
      showControlsHelp();
    } else if (event.key === "1") {
      sendEmote("👋");
    } else if (event.key === "2") {
      sendEmote("❤️");
    } else if (event.key === "3") {
      sendEmote("✨");
    } else if (event.key === "4") {
      sendEmote("😂");
    }
  });
}

function toggleChat() {
  const chatBar = window.__buddyChatBar;
  const chatInput = window.__buddyChatInput;
  const gameScreen = document.getElementById("gameScreen");

  if (!gameScreen || gameScreen.classList.contains("hidden")) {
    return;
  }

  if (!state.chatOpen) {
    chatBar.classList.add("open");
    state.chatOpen = true;
    state.controller.clearMotion();
    state.controller.releasePointerLock();
    state.chatPanel.bump();
    chatInput.focus();
    return;
  }

  if (document.activeElement === chatInput && chatInput.value.trim()) {
    window.__buddySendChat();
    return;
  }

  closeChat();
}

function closeChat() {
  const chatBar = window.__buddyChatBar;
  const chatInput = window.__buddyChatInput;
  chatBar.classList.remove("open");
  chatInput.blur();
  state.chatOpen = false;
  state.controller.clearMotion();
}

function toggleChatPanel() {
  state.chatPanel.toggle();
}

function sendEmote(emote) {
  if (!state.allowedEmotes.includes(emote)) {
    return;
  }
  state.network?.sendEmote(emote);
}

function updateAuraToggle() {
  document.getElementById("toggleAurasButton").textContent = state.auraEnabled ? "✨ Auras on" : "✨ Auras off";
}

function handleResize() {
  state.renderer.resize();
}

function gameLoop(now) {
  const localPlayer = state.players.get(state.localPlayerId);
  const deltaTime = Math.min((now - state.lastFrameAt) / 1000, 0.05);
  state.lastFrameAt = now;

  if (state.map && localPlayer) {
    const movement = state.controller.update(
      localPlayer,
      deltaTime,
      (x, y, margin) => isWalkableLocal(x, y, margin, localPlayer.id)
    );

    localPlayer.direction = directionFromAngle(localPlayer.angle);
    localPlayer.renderX = localPlayer.x;
    localPlayer.renderY = localPlayer.y;
    localPlayer.renderAngle = localPlayer.angle;

    if (movement.moved || movement.turned) {
      hideTutorialBubble();
      maybeSendMovement(now, localPlayer);
    }

    stepRemotePlayers(state.players);
    cullExpiredBubbles(now);

    state.renderer.render({
      map: state.map,
      localPlayer,
      players: state.players,
      tokens: state.tokens,
      tombstones: state.tombstones,
      tutorialBubble: state.tutorialBubble,
      auraEnabled: state.auraEnabled
    });
  }

  requestAnimationFrame(gameLoop);
}

function maybeSendMovement(now, player) {
  if (!state.network?.isOpen()) {
    return;
  }

  const snapshot = `${player.x.toFixed(2)}:${player.y.toFixed(2)}:${player.angle.toFixed(3)}`;
  if (snapshot === state.lastSentState) {
    return;
  }

  if (now - state.lastMovementSentAt < 45) {
    return;
  }

  const sent = state.network.sendMove(player.x, player.y, player.angle);
  if (sent) {
    state.lastMovementSentAt = now;
    state.lastSentState = snapshot;
  }
}

function isWalkableLocal(x, y, margin, selfId) {
  if (!state.map) {
    return false;
  }

  const corners = [
    [x - margin, y - margin],
    [x + margin, y - margin],
    [x - margin, y + margin],
    [x + margin, y + margin]
  ];

  for (const [cornerX, cornerY] of corners) {
    const tileX = Math.floor(cornerX);
    const tileY = Math.floor(cornerY);
    if (tileX < 0 || tileY < 0 || tileX >= state.map.width || tileY >= state.map.height) {
      return false;
    }
    if (state.blockedTiles.has(state.map.tiles[tileY][tileX])) {
      return false;
    }
  }

  for (const player of state.players.values()) {
    if (player.id === selfId || player.isSleeping) {
      continue;
    }
    if (Math.hypot(player.x - x, player.y - y) < 0.45) {
      return false;
    }
  }

  return true;
}

function cullExpiredBubbles(now) {
  for (const player of state.players.values()) {
    if (player.activeBubble?.expiresAt <= now) {
      player.activeBubble = null;
    }
  }

  if (state.tutorialBubble.visible && now > state.tutorialBubble.expiresAt) {
    state.tutorialBubble.visible = false;
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }

  return response.json();
}

function showControlsHelp() {
  state.chatPanel?.addNotice("🎮 Controls: click to lock camera, WASD move, mouse or right stick look, Enter chat, T chat log, 1-4 emotes.");
}

function getSpeakerName(playerId) {
  const player = state.players.get(playerId);
  if (!player) {
    return "A buddy";
  }

  return player.isGhost
    ? `Ghost ${player.buddyMeta?.buddyName || player.name}`
    : player.name;
}

function announce(text) {
  const announcer = document.getElementById("a11y-announcer");
  if (!announcer) {
    return;
  }

  announcer.textContent = "";
  window.setTimeout(() => {
    announcer.textContent = text;
  }, 20);
}

function setGhostSleepState(player, isSleeping, fadeDuration = 0) {
  if (!player) {
    return;
  }

  const visibility = getGhostVisibility(player);
  player.isSleeping = isSleeping;
  player.ghostTransition = {
    from: visibility,
    to: isSleeping ? 0 : 1,
    startedAt: performance.now(),
    durationMs: Math.max(1, fadeDuration)
  };
}

function getGhostVisibility(player) {
  if (!player.isGhost) {
    return 1;
  }

  if (!player.ghostTransition) {
    return player.isSleeping ? 0 : 1;
  }

  const progress = Math.min((performance.now() - player.ghostTransition.startedAt) / player.ghostTransition.durationMs, 1);
  return player.ghostTransition.from + ((player.ghostTransition.to - player.ghostTransition.from) * progress);
}

function directionFromAngle(angle) {
  const normalized = normalizeAngle(angle);
  if (normalized >= Math.PI * 0.25 && normalized < Math.PI * 0.75) {
    return "down";
  }
  if (normalized >= Math.PI * 0.75 && normalized < Math.PI * 1.25) {
    return "left";
  }
  if (normalized >= Math.PI * 1.25 && normalized < Math.PI * 1.75) {
    return "up";
  }
  return "right";
}

function angleFromDirection(direction) {
  switch (direction) {
    case "up":
      return Math.PI * 1.5;
    case "left":
      return Math.PI;
    case "right":
      return 0;
    case "down":
    default:
      return Math.PI * 0.5;
  }
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}
