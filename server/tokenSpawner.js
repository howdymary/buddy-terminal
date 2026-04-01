import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import { TILE_IDS, MAP_HEIGHT, MAP_WIDTH, isPathTile, mapTiles } from "./collisionMap.js";

const TOKEN_CONFIG = {
  minLineLength: 5,
  maxLineLength: 8,
  maxActiveLines: 6,
  respawnDelayMs: 30_000,
  maxSpawnAttempts: 40,
  initialLines: 3,
  collectRadius: 0.8
};

const CARDINALS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
];

export class TokenSpawner {
  constructor({ gameState }) {
    this.gameState = gameState;
    this.tokens = new Map();
    this.lines = new Map();
    this.pendingRespawns = [];
    this.spawnInitialLines();
  }

  get maxActiveLines() {
    const playerCount = this.gameState?.getOnlineCount?.() ?? 0;
    return Math.min(12, 6 + Math.floor(playerCount / 25));
  }

  spawnInitialLines() {
    let attempts = 0;
    while (this.lines.size < TOKEN_CONFIG.initialLines && attempts < TOKEN_CONFIG.maxSpawnAttempts * 2) {
      this.trySpawnLine();
      attempts += 1;
    }
  }

  tick(now, { onTokensSpawned } = {}) {
    const readyRespawns = [];
    const waiting = [];

    for (const entry of this.pendingRespawns) {
      if (entry.readyAt <= now) {
        readyRespawns.push(entry);
      } else {
        waiting.push(entry);
      }
    }

    this.pendingRespawns = waiting;

    for (const _respawn of readyRespawns) {
      if (this.lines.size >= this.maxActiveLines) {
        this.pendingRespawns.push(_respawn);
        continue;
      }

      const tokens = this.trySpawnLine();
      if (tokens.length > 0) {
        onTokensSpawned?.(tokens);
      }
    }
  }

  collectAtPosition(playerId, x, y) {
    const player = this.gameState?.getPlayer?.(playerId);
    if (!player || player.isGhost) {
      return null;
    }

    const token = this.findNearestToken(x, y, TOKEN_CONFIG.collectRadius);
    if (!token || token._collecting) {
      return null;
    }

    token._collecting = true;
    this.tokens.delete(token.id);
    player.tokenCount = (player.tokenCount ?? 0) + 1;

    const line = this.lines.get(token.lineId);
    let lineCleared = null;
    if (line) {
      line.tokenIds.delete(token.id);
      if (line.tokenIds.size === 0) {
        lineCleared = line.id;
        this.lines.delete(line.id);
        this.pendingRespawns.push({
          readyAt: performance.now() + TOKEN_CONFIG.respawnDelayMs
        });
      }
    }

    return {
      tokenId: token.id,
      playerId: player.id,
      x: token.x,
      y: token.y,
      lineId: token.lineId,
      newCount: player.tokenCount,
      lineCleared
    };
  }

  getSerializedTokens() {
    return Array.from(this.tokens.values(), (token) => ({
      id: token.id,
      x: token.x,
      y: token.y,
      lineId: token.lineId
    }));
  }

  trySpawnLine() {
    if (this.lines.size >= this.maxActiveLines) {
      return [];
    }

    const pathTiles = listPathTiles().filter((tile) => !this.findTokenAt(tile.x, tile.y));
    for (let attempt = 0; attempt < TOKEN_CONFIG.maxSpawnAttempts; attempt += 1) {
      const start = pathTiles[Math.floor(Math.random() * pathTiles.length)];
      if (!start) {
        break;
      }

      const direction = CARDINALS[Math.floor(Math.random() * CARDINALS.length)];
      const requestedLength = randomInt(TOKEN_CONFIG.minLineLength, TOKEN_CONFIG.maxLineLength);
      const placements = [];
      let cursorX = start.x;
      let cursorY = start.y;

      for (let step = 0; step < requestedLength; step += 1) {
        if (!isPathTile(cursorX, cursorY) || this.findTokenAt(cursorX, cursorY)) {
          break;
        }

        placements.push({ x: cursorX, y: cursorY });
        cursorX += direction.dx;
        cursorY += direction.dy;
      }

      if (placements.length < TOKEN_CONFIG.minLineLength) {
        continue;
      }

      const lineId = crypto.randomUUID();
      const tokenIds = new Set();
      const tokens = placements.map(({ x, y }) => {
        const id = crypto.randomUUID();
        tokenIds.add(id);
        const token = { id, x, y, lineId };
        this.tokens.set(id, token);
        return token;
      });

      this.lines.set(lineId, {
        id: lineId,
        tokenIds
      });

      return tokens.map((token) => ({
        id: token.id,
        x: token.x,
        y: token.y,
        lineId: token.lineId
      }));
    }

    return [];
  }

  findTokenAt(x, y) {
    for (const token of this.tokens.values()) {
      if (token.x === x && token.y === y) {
        return token;
      }
    }
    return null;
  }

  findNearestToken(x, y, maxDistance) {
    let best = null;
    let bestDistance = maxDistance;

    for (const token of this.tokens.values()) {
      const tokenCenterX = token.x + 0.5;
      const tokenCenterY = token.y + 0.5;
      const distance = Math.hypot(tokenCenterX - x, tokenCenterY - y);
      if (distance < bestDistance) {
        best = token;
        bestDistance = distance;
      }
    }

    return best;
  }
}

function listPathTiles() {
  const tiles = [];
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      if (mapTiles[y][x] === TILE_IDS.PATH) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}
