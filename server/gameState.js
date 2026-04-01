import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { v4 as uuidv4 } from "uuid";

import { SPAWN_POINT, isWalkable } from "./collisionMap.js";
import { createPlayerRateLimits } from "./rateLimiter.js";
import { SpatialGrid } from "./spatialGrid.js";

const SPAWN_RADIUS = 5;
const PLAYER_RADIUS = 0.24;
const monoNow = () => performance.now();

function generateToken() {
  return crypto.randomBytes(24).toString("hex");
}

function createIdentityKey({ name, spriteHash, spriteRef }) {
  return `${name}::${spriteHash || spriteRef || "default"}`;
}

if (!isWalkable(SPAWN_POINT.x, SPAWN_POINT.y)) {
  throw new Error("SPAWN_POINT is not walkable — check collisionMap");
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
    const spawn = findSafeSpawn(this.players);
    const player = this.buildLiveEntity({
      id,
      playerIndex: this.playerIndexCounter,
      ws,
      session,
      x: spawn.x,
      y: spawn.y,
      angle: Math.PI / 2
    });

    this.playerIndexCounter += 1;
    this.players.set(id, player);
    this.grid.addOrUpdatePlayer(id, player.x, player.y);
    this.dirtyPlayers.add(id);
    return player;
  }

  restoreGhost(record) {
    const restorePoint = isWalkable(record.x, record.y)
      ? { x: record.x, y: record.y }
      : findSafeSpawn(this.players);
    if (restorePoint.x !== record.x || restorePoint.y !== record.y) {
      console.warn(`Ghost ${record.id} relocated to spawn (was in wall)`);
    }

    const ghost = {
      id: record.id,
      playerIndex: record.playerIndex || this.playerIndexCounter,
      name: record.name,
      x: restorePoint.x,
      y: restorePoint.y,
      renderX: restorePoint.x,
      renderY: restorePoint.y,
      angle: normalizeAngle(record.angle ?? angleFromDirection(record.direction || "down")),
      direction: directionFromAngle(record.angle ?? angleFromDirection(record.direction || "down")),
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
        nextSpeechAt: monoNow() + 5000 + Math.floor(Math.random() * 10_000),
        nextDecisionAt: monoNow() + 2000 + Math.floor(Math.random() * 4000),
        nextStepAt: monoNow() + 500,
        reactCooldownUntil: 0
      },
      isGhost: true,
      isConnected: false,
      isDormant: false,
      isSleeping: false,
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
      tokenCount: record.tokenCount ?? 0,
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

    const savedTokenCount = entity.ghostData?.savedTokenCount ?? entity.tokenCount ?? 0;

    entity.isGhost = false;
    entity.isConnected = true;
    entity.isDormant = false;
    entity.isSleeping = false;
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
    entity.lastHeartbeat = monoNow();
    entity.lastUpdate = Date.now();
    entity.angle = normalizeAngle(entity.angle ?? angleFromDirection(entity.direction ?? "down"));
    entity.direction = directionFromAngle(entity.angle);
    entity.chatMessage = "";
    entity.chatExpiresAt = 0;
    entity.emote = "";
    entity.emoteExpiresAt = 0;
    entity.rateLimits = createPlayerRateLimits();
    entity.recentChatInputs = [];
    entity.ghostData = null;
    entity.totalVisits = (entity.totalVisits ?? 0) + 1;
    entity.tokenCount = savedTokenCount;
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
    entity.isSleeping = false;
    entity.ghostData = {
      originalPlayerId: entity.id,
      createdAt: new Date().toISOString(),
      personality,
      savedTokenCount: entity.tokenCount ?? 0,
      lastSpoke: 0,
      wanderTarget: null,
      nextSpeechAt: monoNow() + 8000 + Math.floor(Math.random() * 10_000),
      nextDecisionAt: monoNow() + 2500 + Math.floor(Math.random() * 4000),
      nextStepAt: monoNow() + 500,
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

  getGhostPlayers() {
    return Array.from(this.players.values()).filter((entity) => entity.isGhost);
  }

  getTimedOutPlayers(timeoutMs = 30_000) {
    const currentTime = monoNow();
    return Array.from(this.players.values()).filter((entity) => (
      !entity.isGhost &&
      entity.isConnected &&
      currentTime - entity.lastHeartbeat > timeoutMs
    ));
  }

  findReconnectCandidate(identityKey) {
    return Array.from(this.players.values()).find((entity) => (
      entity.identityKey === identityKey &&
      (!entity.isConnected || entity.isGhost)
    )) ?? null;
  }

  moveEntity(id, nextX, nextY, facing = 0) {
    const entity = this.players.get(id);
    if (!entity) {
      return { ok: false, reason: "missing_player" };
    }

    const angle = typeof facing === "number"
      ? normalizeAngle(facing)
      : angleFromDirection(facing);

    if (!hasMovementClearance(nextX, nextY, PLAYER_RADIUS)) {
      return { ok: false, reason: "blocked" };
    }

    const nearbyIds = this.grid.getNeighborPlayerIds(nextX, nextY);
    for (const otherId of nearbyIds) {
      if (otherId === id) {
        continue;
      }

      const other = this.players.get(otherId);
      if (other && !other.isSleeping && Math.hypot(other.x - nextX, other.y - nextY) < PLAYER_RADIUS * 2) {
        return { ok: false, reason: "occupied" };
      }
    }

    entity.x = roundPosition(nextX);
    entity.y = roundPosition(nextY);
    entity.angle = angle;
    entity.direction = directionFromAngle(angle);
    entity.lastUpdate = Date.now();
    this.grid.addOrUpdatePlayer(id, entity.x, entity.y);
    this.dirtyPlayers.add(id);
    return { ok: true, player: entity };
  }

  setHeartbeat(id) {
    const entity = this.players.get(id);
    if (!entity || entity.isGhost) {
      return;
    }
    entity.lastHeartbeat = monoNow();
  }

  setChat(id, message, durationMs = 5000) {
    const entity = this.players.get(id);
    if (!entity) {
      return null;
    }

    entity.chatMessage = message;
    entity.chatExpiresAt = Date.now() + durationMs;
    entity.lastUpdate = Date.now();
    this.dirtyPlayers.add(id);
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
    this.dirtyPlayers.add(id);
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
        this.dirtyPlayers.add(entity.id);
      }
      if (entity.emoteExpiresAt && entity.emoteExpiresAt <= now) {
        entity.emote = "";
        entity.emoteExpiresAt = 0;
        this.dirtyPlayers.add(entity.id);
      }
    }
  }

  isOccupiedTile(x, y, ignoreId = null) {
    const nearbyIds = this.grid.getNeighborPlayerIds(x + 0.5, y + 0.5);
    for (const entityId of nearbyIds) {
      const entity = this.players.get(entityId);
      if (
        entity &&
        !entity.isSleeping &&
        entity.id !== ignoreId &&
        Math.floor(entity.x) === x &&
        Math.floor(entity.y) === y
      ) {
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
      angle: entity.angle ?? 0,
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
      isSleeping: Boolean(entity.isSleeping),
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

  buildLiveEntity({ id, playerIndex, ws, session, x, y, angle = 0 }) {
    const normalizedAngle = normalizeAngle(angle);
    return {
      id,
      playerIndex,
      name: session.name,
      x,
      y,
      renderX: x,
      renderY: y,
      angle: normalizedAngle,
      direction: directionFromAngle(normalizedAngle),
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
      isSleeping: false,
      disconnectPending: false,
      disconnectReason: null,
      disconnectedAt: null,
      identityKey: session.identityKey,
      ws,
      lastHeartbeat: monoNow(),
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

function findSafeSpawn(players) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const x = SPAWN_POINT.x + Math.floor(Math.random() * SPAWN_RADIUS * 2) - SPAWN_RADIUS;
    const y = SPAWN_POINT.y + Math.floor(Math.random() * SPAWN_RADIUS * 2) - SPAWN_RADIUS;
    if (isWalkable(x, y) && !isOccupied(x, y, players)) {
      return { x: x + 0.5, y: y + 0.5 };
    }
  }

  return { x: SPAWN_POINT.x + 0.5, y: SPAWN_POINT.y + 0.5 };
}

function isOccupied(x, y, players) {
  for (const entity of players.values()) {
    if (!entity.isSleeping && Math.floor(entity.x) === x && Math.floor(entity.y) === y) {
      return true;
    }
  }
  return false;
}

function hasMovementClearance(x, y, radius) {
  const corners = [
    [x - radius, y - radius],
    [x + radius, y - radius],
    [x - radius, y + radius],
    [x + radius, y + radius]
  ];

  return corners.every(([cornerX, cornerY]) => isWalkable(cornerX, cornerY));
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

function roundPosition(value) {
  return Math.round(value * 1000) / 1000;
}
