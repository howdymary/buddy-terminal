import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";

import { SPAWN_POINT, isWalkable } from "./collisionMap.js";
import { createPlayerRateLimits } from "./rateLimiter.js";
import { SpatialGrid } from "./spatialGrid.js";

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createIdentityKey({ name, spriteHash, spriteRef }) {
  return `${name}::${spriteHash || spriteRef || "default"}`;
}

export class GameState {
  constructor() {
    this.players = new Map();
    this.sessions = new Map();
    this.playerIndexCounter = 1;
    this.dirtyPlayers = new Set();
    this.grid = new SpatialGrid(8);
  }

  createSession({
    name,
    spriteType,
    spriteRef,
    spriteHash,
    spriteFormat = "sprite",
    hasRealBuddy = false,
    buddyMeta = null
  }) {
    const token = generateToken();
    const session = {
      token,
      name,
      spriteType,
      spriteRef,
      spriteHash,
      spriteFormat,
      hasRealBuddy,
      buddyMeta,
      identityKey: createIdentityKey({ name, spriteHash, spriteRef }),
      expiresAt: Date.now() + 5 * 60 * 1000
    };

    this.sessions.set(token, session);
    return session;
  }

  consumeSession(token) {
    const session = this.sessions.get(token);
    if (!session) {
      return null;
    }

    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }

    this.sessions.delete(token);
    return session;
  }

  addPlayer({ ws, session }) {
    const reconnectCandidate = this.findReconnectCandidate(session.identityKey);
    if (reconnectCandidate) {
      return this.wakeEntity(reconnectCandidate.id, ws, session);
    }

    const id = uuidv4();
    const player = this.buildLiveEntity({
      id,
      playerIndex: this.playerIndexCounter,
      ws,
      session,
      x: SPAWN_POINT.x,
      y: SPAWN_POINT.y,
      direction: "down"
    });

    this.playerIndexCounter += 1;
    this.players.set(id, player);
    this.grid.addOrUpdatePlayer(id, player.x, player.y);
    this.dirtyPlayers.add(id);
    return player;
  }

  restoreGhost(record) {
    const ghost = {
      id: record.id,
      playerIndex: record.playerIndex || this.playerIndexCounter,
      name: record.name,
      x: record.x,
      y: record.y,
      renderX: record.x,
      renderY: record.y,
      direction: record.direction || "down",
      spriteType: record.spriteHash ? "custom" : "default",
      spriteRef: record.spriteRef,
      spriteHash: record.spriteHash,
      spriteFormat: record.spriteFormat || "sprite",
      hasRealBuddy: Boolean(record.hasRealBuddy),
      buddyMeta: record.buddyMeta,
      ghostData: {
        originalPlayerId: record.ghostData?.originalPlayerId || record.id,
        createdAt: record.ghostData?.createdAt || new Date().toISOString(),
        personality: record.ghostData?.personality || "universal",
        lastSpoke: record.ghostData?.lastSpoke || 0,
        wanderTarget: record.ghostData?.wanderTarget || null,
        nextSpeechAt: Date.now() + 5000 + Math.floor(Math.random() * 10_000),
        nextDecisionAt: Date.now() + 2000 + Math.floor(Math.random() * 4000),
        nextStepAt: Date.now() + 500,
        reactCooldownUntil: 0
      },
      isGhost: true,
      isConnected: false,
      isDormant: false,
      disconnectPending: false,
      disconnectReason: null,
      disconnectedAt: null,
      identityKey: record.identityKey ?? createIdentityKey(record),
      lastHeartbeat: 0,
      lastUpdate: Date.now(),
      chatMessage: "",
      chatExpiresAt: 0,
      emote: "",
      emoteExpiresAt: 0,
      rateLimits: null,
      recentChatInputs: [],
      totalVisits: record.totalVisits ?? 1,
      tokenCount: 0,
      ws: null
    };

    this.players.set(ghost.id, ghost);
    this.grid.addOrUpdatePlayer(ghost.id, ghost.x, ghost.y);
    this.playerIndexCounter = Math.max(this.playerIndexCounter, ghost.playerIndex + 1);
    this.dirtyPlayers.add(ghost.id);
    return ghost;
  }

  wakeEntity(id, ws, session) {
    const entity = this.players.get(id);
    if (!entity) {
      return null;
    }

    entity.isGhost = false;
    entity.isConnected = true;
    entity.isDormant = false;
    entity.disconnectPending = false;
    entity.disconnectReason = null;
    entity.disconnectedAt = null;
    entity.ws = ws;
    entity.name = session.name;
    entity.spriteType = session.spriteType;
    entity.spriteRef = session.spriteRef;
    entity.spriteHash = session.spriteHash;
    entity.spriteFormat = session.spriteFormat;
    entity.hasRealBuddy = session.hasRealBuddy;
    entity.buddyMeta = session.buddyMeta;
    entity.identityKey = session.identityKey;
    entity.lastHeartbeat = Date.now();
    entity.lastUpdate = Date.now();
    entity.chatMessage = "";
    entity.chatExpiresAt = 0;
    entity.emote = "";
    entity.emoteExpiresAt = 0;
    entity.rateLimits = createPlayerRateLimits();
    entity.recentChatInputs = [];
    entity.ghostData = null;
    entity.totalVisits = (entity.totalVisits ?? 0) + 1;
    entity.tokenCount = 0;
    this.grid.addOrUpdatePlayer(id, entity.x, entity.y);
    this.dirtyPlayers.add(id);
    return entity;
  }

  markDisconnected(id, reason = "disconnect") {
    const player = this.players.get(id);
    if (!player || player.isGhost || !player.isConnected) {
      return null;
    }

    player.isConnected = false;
    player.disconnectPending = true;
    player.disconnectReason = reason;
    player.disconnectedAt = Date.now();
    player.lastUpdate = Date.now();
    player.ws = null;
    return player;
  }

  convertToGhost(id, personality = "universal") {
    const entity = this.players.get(id);
    if (!entity) {
      return null;
    }

    entity.isGhost = true;
    entity.isConnected = false;
    entity.disconnectPending = false;
    entity.isDormant = false;
    entity.ghostData = {
      originalPlayerId: entity.id,
      createdAt: new Date().toISOString(),
      personality,
      lastSpoke: 0,
      wanderTarget: null,
      nextSpeechAt: Date.now() + 8000 + Math.floor(Math.random() * 10_000),
      nextDecisionAt: Date.now() + 2500 + Math.floor(Math.random() * 4000),
      nextStepAt: Date.now() + 500,
      reactCooldownUntil: 0
    };
    entity.ws = null;
    entity.rateLimits = null;
    entity.recentChatInputs = [];
    entity.lastUpdate = Date.now();
    entity.chatMessage = "";
    entity.chatExpiresAt = 0;
    entity.emote = "";
    entity.emoteExpiresAt = 0;
    this.dirtyPlayers.add(id);
    return entity;
  }

  removeEntity(id) {
    this.players.delete(id);
    this.grid.removePlayer(id);
    this.dirtyPlayers.delete(id);
  }

  getOnlineCount() {
    let count = 0;
    for (const entity of this.players.values()) {
      if (!entity.isGhost && entity.isConnected) {
        count += 1;
      }
    }
    return count;
  }

  getPlayer(id) {
    return this.players.get(id) ?? null;
  }

  getLivePlayers() {
    return Array.from(this.players.values()).filter((entity) => !entity.isGhost && entity.isConnected);
  }

  getTimedOutPlayers(timeoutMs = 30_000) {
    const now = Date.now();
    return Array.from(this.players.values()).filter((entity) => (
      !entity.isGhost &&
      entity.isConnected &&
      now - entity.lastHeartbeat > timeoutMs
    ));
  }

  findReconnectCandidate(identityKey) {
    return Array.from(this.players.values()).find((entity) => (
      entity.identityKey === identityKey &&
      (!entity.isConnected || entity.isGhost)
    )) ?? null;
  }

  moveEntity(id, nextX, nextY, direction) {
    const entity = this.players.get(id);
    if (!entity) {
      return { ok: false, reason: "missing_player" };
    }

    if (!isWalkable(nextX, nextY)) {
      return { ok: false, reason: "blocked" };
    }

    for (const other of this.players.values()) {
      if (other.id !== id && other.x === nextX && other.y === nextY) {
        return { ok: false, reason: "occupied" };
      }
    }

    entity.x = nextX;
    entity.y = nextY;
    entity.direction = direction;
    entity.lastUpdate = Date.now();
    this.grid.addOrUpdatePlayer(id, nextX, nextY);
    this.dirtyPlayers.add(id);
    return { ok: true, player: entity };
  }

  setHeartbeat(id) {
    const entity = this.players.get(id);
    if (!entity || entity.isGhost) {
      return;
    }
    entity.lastHeartbeat = Date.now();
  }

  setChat(id, message, durationMs = 5000) {
    const entity = this.players.get(id);
    if (!entity) {
      return null;
    }

    entity.chatMessage = message;
    entity.chatExpiresAt = Date.now() + durationMs;
    entity.lastUpdate = Date.now();
    return entity;
  }

  setEmote(id, emote, durationMs = 5000) {
    const entity = this.players.get(id);
    if (!entity) {
      return null;
    }

    entity.emote = emote;
    entity.emoteExpiresAt = Date.now() + durationMs;
    entity.lastUpdate = Date.now();
    return entity;
  }

  rememberChatInput(id, message) {
    const entity = this.players.get(id);
    if (!entity) {
      return [];
    }

    entity.recentChatInputs.push(message);
    entity.recentChatInputs = entity.recentChatInputs.slice(-3);
    return entity.recentChatInputs;
  }

  clearExpiredSpeech(now = Date.now()) {
    for (const entity of this.players.values()) {
      if (entity.chatExpiresAt && entity.chatExpiresAt <= now) {
        entity.chatMessage = "";
        entity.chatExpiresAt = 0;
      }
      if (entity.emoteExpiresAt && entity.emoteExpiresAt <= now) {
        entity.emote = "";
        entity.emoteExpiresAt = 0;
      }
    }
  }

  isOccupiedTile(x, y, ignoreId = null) {
    for (const entity of this.players.values()) {
      if (entity.id !== ignoreId && entity.x === x && entity.y === y) {
        return true;
      }
    }
    return false;
  }

  serializePlayer(entity) {
    return {
      id: entity.id,
      playerIndex: entity.playerIndex,
      name: entity.name,
      x: entity.x,
      y: entity.y,
      direction: entity.direction,
      spriteType: entity.spriteType,
      spriteRef: entity.spriteRef,
      spriteHash: entity.spriteHash,
      spriteFormat: entity.spriteFormat,
      hasRealBuddy: entity.hasRealBuddy,
      buddyMeta: entity.buddyMeta,
      chatMessage: entity.chatMessage,
      emote: entity.emote,
      isGhost: Boolean(entity.isGhost),
      isDormant: Boolean(entity.isDormant),
      ghostData: entity.isGhost ? entity.ghostData : null,
      tokenCount: entity.tokenCount ?? 0
    };
  }

  getSerializedPlayers() {
    return Array.from(this.players.values(), (entity) => this.serializePlayer(entity));
  }

  consumeDirtyPlayers() {
    const dirty = Array.from(this.dirtyPlayers)
      .map((id) => this.players.get(id))
      .filter(Boolean);
    this.dirtyPlayers.clear();
    return dirty;
  }

  getVisiblePlayersFor(sourceEntity) {
    const nearbyIds = this.grid.getNeighborPlayerIds(sourceEntity.x, sourceEntity.y);
    return Array.from(nearbyIds)
      .map((id) => this.players.get(id))
      .filter(Boolean);
  }

  getLiveRecipients() {
    return Array.from(this.players.values()).filter((entity) => !entity.isGhost && entity.isConnected && entity.ws);
  }

  buildLiveEntity({ id, playerIndex, ws, session, x, y, direction }) {
    return {
      id,
      playerIndex,
      name: session.name,
      x,
      y,
      renderX: x,
      renderY: y,
      direction,
      spriteType: session.spriteType,
      spriteRef: session.spriteRef,
      spriteHash: session.spriteHash,
      spriteFormat: session.spriteFormat,
      hasRealBuddy: session.hasRealBuddy,
      buddyMeta: session.buddyMeta,
      ghostData: null,
      isGhost: false,
      isConnected: true,
      isDormant: false,
      disconnectPending: false,
      disconnectReason: null,
      disconnectedAt: null,
      identityKey: session.identityKey,
      ws,
      lastHeartbeat: Date.now(),
      lastUpdate: Date.now(),
      chatMessage: "",
      chatExpiresAt: 0,
      emote: "",
      emoteExpiresAt: 0,
      rateLimits: createPlayerRateLimits(),
      recentChatInputs: [],
      totalVisits: 1,
      tokenCount: 0
    };
  }
}
