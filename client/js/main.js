import { Camera } from "./camera.js";
import { ChatPanel } from "./chatPanel.js";
import { InputController } from "./input.js";
import { stepRemotePlayers, applyRemoteMovement } from "./interpolation.js";
import { BuddyNetwork } from "./network.js";
import { OnboardingController } from "./onboarding.js";
import { Renderer } from "./renderer.js";
import { ClientSpriteCache } from "./spriteCache.js";
import { buildSpriteSheetFromUrl, loadSpriteSheetAsset } from "./spriteGen.js";
import { TokenHUD } from "./tokenHUD.js";
import { bindTouchControls } from "./touchControls.js";

const BLOCKED_TILES = new Set([2, 3, 4, 5, 7, 8, 10]);

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
  camera: null,
  input: null,
  chatPanel: null,
  tokenHud: null,
  chatOpen: false,
  auraEnabled: true,
  heartbeatTimer: null,
  hoveredPlayerId: null,
  hoveredTombstoneId: null,
  tutorialBubble: {
    text: "",
    expiresAt: 0,
    visible: false
  }
};

init();

async function init() {
  state.bootstrap = await fetchJson("/api/bootstrap");
  state.renderer = new Renderer(document.getElementById("gameCanvas"));
  state.camera = new Camera(window.innerWidth, window.innerHeight, state.renderer.tilePixels);
  state.input = new InputController();
  state.input.setCallbacks({
    onToggleChat: toggleChat,
    onCloseChat: closeChat,
    onEmote: sendEmote,
    onToggleChatPanel: toggleChatPanel,
    isTextInputActive: () => state.chatOpen
  });
  state.input.attach();

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
  setupCanvasInteractions();

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
  document.getElementById("playerSummary").textContent = `🧭 You are ${displayName}`;

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
      break;
    case "player_left":
      removePlayer(message.id);
      updateOnlineCount(message.onlineCount);
      break;
    case "ghost_spawn":
      upsertPlayer(message.ghost);
      if (message.ghost?.id) {
        setBubble(message.ghost.id, "boo... still here ✨", "chat");
      }
      updateOnlineCount(message.onlineCount);
      break;
    case "ghost_wake": {
      const player = state.players.get(message.playerId || message.ghostId);
      if (player) {
        player.isGhost = false;
        setBubble(player.id, "I'm back! 👋", "chat");
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
      setBubble(message.id, message.message, "chat");
      if (message.entry) {
        state.chatPanel.addEntry(message.entry);
      }
      break;
    case "ghost_chat":
      setBubble(message.id, message.message, "chat");
      if (message.entry) {
        state.chatPanel.addEntry(message.entry);
      }
      break;
    case "player_emote":
      setBubble(message.id, message.emote, "emote");
      if (message.entry) {
        state.chatPanel.addEntry(message.entry);
      }
      break;
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
      player.renderX = move.x;
      player.renderY = move.y;
      player.direction = move.direction;
      continue;
    }

    applyRemoteMovement(player, move.x, move.y, move.direction);
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
  showTutorialBubble(message.map.sign.message);

  if (message.players.length > 1) {
    state.camera.brieflyPan();
  }
}

function upsertPlayer(data) {
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
      direction: data.direction,
      spriteType: data.spriteType,
      spriteRef: data.spriteRef,
      spriteFormat: data.spriteFormat,
      hasRealBuddy: Boolean(data.hasRealBuddy),
      buddyMeta: data.buddyMeta,
      isGhost: Boolean(data.isGhost),
      isDormant: Boolean(data.isDormant),
      ghostData: data.ghostData,
      activeBubble: null,
      tokenCount: data.tokenCount || 0,
      isLocal: data.id === state.localPlayerId
    };
    state.players.set(data.id, player);
  } else {
    player.name = data.name;
    player.x = data.x;
    player.y = data.y;
    player.direction = data.direction;
    player.spriteType = data.spriteType;
    player.spriteRef = data.spriteRef;
    player.spriteFormat = data.spriteFormat;
    player.hasRealBuddy = Boolean(data.hasRealBuddy);
    player.buddyMeta = data.buddyMeta;
    player.isGhost = Boolean(data.isGhost);
    player.isDormant = Boolean(data.isDormant);
    player.ghostData = data.ghostData;
    player.tokenCount = data.tokenCount || 0;
  }

  player.isLocal = data.id === state.localPlayerId;
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
  if (state.hoveredPlayerId === id) {
    state.hoveredPlayerId = null;
  }
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
  if (!state.tombstones.has(id)) {
    return;
  }

  state.tombstones.delete(id);
  if (state.hoveredTombstoneId === id) {
    state.hoveredTombstoneId = null;
  }
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
  localPlayer.renderX = message.x;
  localPlayer.renderY = message.y;
  localPlayer.direction = message.direction;
}

function updateOnlineCount(count) {
  document.getElementById("onlineCount").textContent = `🌐 ${count} online`;
}

function showTutorialBubble(message) {
  state.tutorialBubble = {
    text: message,
    expiresAt: performance.now() + 6000,
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

  const updateCounter = () => {
    chatCounter.textContent = `${chatInput.value.length}/80`;
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
    const text = chatInput.value.trim().slice(0, 80);
    if (!text) {
      closeChat();
      return;
    }

    state.network?.sendChat(text);
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
    onDirectionStart(direction) {
      state.input.pushDirection(direction);
    },
    onDirectionEnd(direction) {
      state.input.releaseDirection(direction);
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
}

function setupCanvasInteractions() {
  const canvas = document.getElementById("gameCanvas");

  canvas.addEventListener("mousemove", (event) => {
    if (!state.map) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hovered = getHoveredSceneTargets(x, y);
    state.hoveredPlayerId = hovered.playerId;
    state.hoveredTombstoneId = hovered.tombstoneId;
  });

  canvas.addEventListener("mouseleave", () => {
    state.hoveredPlayerId = null;
    state.hoveredTombstoneId = null;
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
    state.input.clearDirections();
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
  state.input.clearDirections();
}

function toggleChatPanel() {
  state.chatPanel.toggle();
}

function sendEmote(emote) {
  state.network?.sendEmote(emote);
}

function updateAuraToggle() {
  document.getElementById("toggleAurasButton").textContent = state.auraEnabled ? "✨ Auras on" : "✨ Auras off";
}

function handleResize() {
  state.renderer.resize();
  state.camera.resize(window.innerWidth, window.innerHeight);
}

function gameLoop() {
  const localPlayer = state.players.get(state.localPlayerId);

  if (state.map && localPlayer) {
    if (!state.chatOpen) {
      const direction = state.input.consumeMovement();
      if (direction) {
        tryMoveLocalPlayer(direction);
      }
    }

    stepRemotePlayers(state.players);
    const nearestPlayer = getNearestOtherPlayer(localPlayer);
    state.camera.update(localPlayer, nearestPlayer);

    if (state.tutorialBubble.visible && performance.now() > state.tutorialBubble.expiresAt) {
      state.tutorialBubble.visible = false;
    }

    state.renderer.render({
      map: state.map,
      camera: state.camera,
      players: state.players,
      tokens: state.tokens,
      tombstones: state.tombstones,
      localPlayerId: state.localPlayerId,
      tutorialBubble: state.tutorialBubble,
      hoveredPlayerId: state.hoveredPlayerId,
      hoveredTombstoneId: state.hoveredTombstoneId,
      auraEnabled: state.auraEnabled
    });
  }

  requestAnimationFrame(gameLoop);
}

function tryMoveLocalPlayer(direction) {
  const localPlayer = state.players.get(state.localPlayerId);
  if (!localPlayer || !state.map) {
    return;
  }

  const deltas = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0]
  };

  const [dx, dy] = deltas[direction];
  const nextX = localPlayer.x + dx;
  const nextY = localPlayer.y + dy;

  localPlayer.direction = direction;

  if (!isWalkableLocal(nextX, nextY, localPlayer.id)) {
    return;
  }

  localPlayer.x = nextX;
  localPlayer.y = nextY;
  localPlayer.renderX = nextX;
  localPlayer.renderY = nextY;
  state.network?.sendMove(nextX, nextY, direction);
  hideTutorialBubble();
}

function isWalkableLocal(x, y, selfId) {
  if (!state.map) {
    return false;
  }

  if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) {
    return false;
  }

  if (BLOCKED_TILES.has(state.map.tiles[y][x])) {
    return false;
  }

  for (const player of state.players.values()) {
    if (player.id !== selfId && player.x === x && player.y === y) {
      return false;
    }
  }

  return true;
}

function getNearestOtherPlayer(localPlayer) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const player of state.players.values()) {
    if (player.id === localPlayer.id) {
      continue;
    }

    const distance = Math.abs(player.x - localPlayer.x) + Math.abs(player.y - localPlayer.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }

  return best;
}

function getHoveredSceneTargets(mouseX, mouseY) {
  const hovered = {
    playerId: null,
    tombstoneId: null
  };
  const tileSize = state.renderer.tilePixels;

  for (const player of state.players.values()) {
    if (player.id === state.localPlayerId) {
      continue;
    }

    const spriteX = player.renderX * tileSize - state.camera.x - tileSize / 2;
    const spriteY = player.renderY * tileSize - state.camera.y - tileSize * 1.5;
    const width = tileSize * 1.5;
    const height = tileSize * 1.5;

    if (mouseX >= spriteX && mouseX <= spriteX + width && mouseY >= spriteY && mouseY <= spriteY + height) {
      hovered.playerId = player.id;
      break;
    }
  }

  for (const tombstone of state.tombstones.values()) {
    const tombstoneX = tombstone.x * tileSize - state.camera.x + tileSize * 0.18;
    const tombstoneY = tombstone.y * tileSize - state.camera.y + tileSize * 0.12;
    const width = tileSize * 0.64;
    const height = tileSize * 0.76;

    if (
      mouseX >= tombstoneX &&
      mouseX <= tombstoneX + width &&
      mouseY >= tombstoneY &&
      mouseY <= tombstoneY + height
    ) {
      hovered.tombstoneId = tombstone.id;
      break;
    }
  }

  return hovered;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url}`);
  }

  return response.json();
}
