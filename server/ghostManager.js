import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import { sanitizeChatMessage } from "./chatFilter.js";
import { getGhostChatInterval, maybeReactToNearbyChat, updateGhostEntity } from "./ghostAI.js";
import { getGhostPersonality } from "./phrasePools.js";

const DISCONNECT_GRACE_MS = 10_000;
const TOMBSTONE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const ACTIVE_GHOST_LIMIT = 200;
const GHOST_HARD_CAP = 500;
const GHOST_SAVE_INTERVAL_MS = 5000;
const GHOST_DENSITY_UPDATE_MS = 10_000;
const GHOST_DENSITY = {
  targetPopulation: 15,
  minGhosts: 2,
  maxGhosts: 30,
  rampDownSpeed: 2,
  rampUpSpeed: 3
};
const now = () => performance.now();

/**
 * Ghost capacity model:
 * - ACTIVE_GHOST_LIMIT (200): Max ghosts loaded into memory at startup.
 *   Oldest ghosts beyond this are left in DB (dormant on disk).
 * - GHOST_HARD_CAP (500): Max total ghost records in DB (non-evicted).
 *   Beyond this, oldest are permanently evicted (tombstoned).
 * - MAX_PLAYERS (500): Max live WebSocket connections.
 *   Ghosts + live players can coexist (ghosts don't count toward player cap).
 */

export class GhostManager {
  constructor({ db, gameState, spriteCache, chatLog }) {
    this.db = db;
    this.gameState = gameState;
    this.spriteCache = spriteCache;
    this.chatLog = chatLog;
    this.pendingTransitions = new Map();
    this.dirtyGhostIds = new Set();
    this.lastGhostSaveAt = now();
    this.lastDensityUpdateAt = -GHOST_DENSITY_UPDATE_MS;
  }

  hydrate() {
    this.db.hydrateSprites(this.spriteCache);
    const ghosts = this.db.loadGhosts(ACTIVE_GHOST_LIMIT);
    ghosts.forEach((ghost) => {
      const restored = this.gameState.restoreGhost(ghost);
      updateGhostEntity(restored, this.gameState, now());
      this.markGhostDirty(restored.id);
    });
  }

  wakeOrAdmitPlayer({ ws, session, broadcastJsonToAll, onTombstonesRemoved }) {
    let player = this.gameState.findReconnectCandidate(session.identityKey);

    if (!player) {
      const record = this.db.findGhostByIdentityKey(session.identityKey);
      if (record) {
        this.gameState.restoreGhost(record);
        player = this.gameState.findReconnectCandidate(session.identityKey);
      }
    }

    if (player) {
      this.cancelPendingTransition(player.id);
      this.db.markGhostVisited(session.identityKey);
      const removedTombstoneIds = this.db.removeTombstonesForGhost(player.id);
      if (removedTombstoneIds.length > 0) {
        onTombstonesRemoved?.(removedTombstoneIds);
      }
      const awakened = this.gameState.wakeEntity(player.id, ws, session);
      broadcastJsonToAll({
        type: "ghost_wake",
        ghostId: awakened.id,
        playerId: awakened.id
      });
      return awakened;
    }

    return this.gameState.addPlayer({ ws, session });
  }

  scheduleTransition(playerId, { onGhostSpawn, onGhostEvicted }) {
    this.cancelPendingTransition(playerId);
    const player = this.gameState.getPlayer(playerId);
    if (!player || player.isGhost) {
      return;
    }

    const entry = {
      timer: null,
      claimed: false
    };

    entry.timer = setTimeout(() => {
      if (entry.claimed) {
        return;
      }

      const current = this.gameState.getPlayer(playerId);
      if (!current || current.isConnected || current.isGhost === true) {
        return;
      }

      const ghost = this.gameState.convertToGhost(
        playerId,
        getGhostPersonality(current.buddyMeta?.stats ?? {})
      );
      if (!ghost) {
        return;
      }

      this.db.upsertGhost(ghost);
      const evictedIds = this.db.enforceGhostCap(GHOST_HARD_CAP);
      evictedIds.forEach((id) => {
        const eviction = this.evictGhostEntity(id);
        onGhostEvicted?.(eviction);
      });

      if (this.gameState.getPlayer(ghost.id)) {
        onGhostSpawn?.(ghost);
      }
      this.pendingTransitions.delete(playerId);
    }, DISCONNECT_GRACE_MS);

    this.pendingTransitions.set(playerId, entry);
  }

  cancelPendingTransition(playerId) {
    const entry = this.pendingTransitions.get(playerId);
    if (entry) {
      entry.claimed = true;
      clearTimeout(entry.timer);
      this.pendingTransitions.delete(playerId);
    }
  }

  updateGhosts({
    now: currentTime = now(),
    onGhostChat,
    onGhostEmote,
    onGhostEvicted,
    onGhostSleep,
    onGhostWakeAmbient
  }) {
    if (currentTime - this.lastDensityUpdateAt >= GHOST_DENSITY_UPDATE_MS) {
      this.rebalanceGhostDensity(currentTime, {
        onGhostSleep,
        onGhostWakeAmbient
      });
      this.lastDensityUpdateAt = currentTime;
    }

    const ghosts = this.gameState.getGhostPlayers();
    const activeGhostCount = ghosts.filter((entity) => !entity.isSleeping).length;

    for (const ghost of ghosts) {
      const { moved, chatted, becameDormant } = updateGhostEntity(ghost, this.gameState, currentTime);
      if (moved || chatted || becameDormant) {
        this.markGhostDirty(ghost.id);
      }

      if (chatted) {
        this.gameState.setChat(ghost.id, chatted, 6000);
        const entry = this.chatLog.record({
          kind: "ghost_chat",
          playerId: ghost.id,
          playerName: ghost.buddyMeta?.buddyName || ghost.name,
          message: chatted,
          dominantColor: ghost.buddyMeta?.dominantColor ?? "#79c4a0",
          rarity: ghost.buddyMeta?.rarity ?? "common"
        });
        onGhostChat?.(ghost, chatted, entry);
      }
    }

    if (currentTime - this.lastGhostSaveAt > GHOST_SAVE_INTERVAL_MS) {
      const dirtyGhosts = Array.from(this.dirtyGhostIds)
        .map((id) => this.gameState.getPlayer(id))
        .filter((ghost) => ghost?.isGhost);
      if (dirtyGhosts.length > 0) {
        this.db.batchUpsertGhosts(dirtyGhosts);
      }
      this.dirtyGhostIds.clear();
      this.lastGhostSaveAt = currentTime;
    }

    const evictedIds = this.db.enforceGhostCap(GHOST_HARD_CAP);
    evictedIds.forEach((id) => {
      const eviction = this.evictGhostEntity(id);
      onGhostEvicted?.(eviction);
    });

    return activeGhostCount;
  }

  reactToNearbyChat(sourcePlayer, { onGhostChat, onGhostEmote }) {
    const ghosts = this.gameState.getVisiblePlayersFor(sourcePlayer).filter((entity) => entity.isGhost);
    for (const ghost of ghosts) {
      const reaction = maybeReactToNearbyChat(ghost, sourcePlayer);
      if (!reaction) {
        continue;
      }

      if (reaction.type === "chat") {
        const sanitized = sanitizeChatMessage(reaction.value);
        const safeMessage = sanitized.ok ? sanitized.cleaned : "hey there! 👋";
        this.gameState.setChat(ghost.id, safeMessage, 6000);
        const entry = this.chatLog.record({
          kind: "ghost_chat",
          playerId: ghost.id,
          playerName: ghost.buddyMeta?.buddyName || ghost.name,
          message: safeMessage,
          dominantColor: ghost.buddyMeta?.dominantColor ?? "#79c4a0",
          rarity: ghost.buddyMeta?.rarity ?? "common"
        });
        onGhostChat?.(ghost, safeMessage, entry);
      } else if (reaction.type === "emote") {
        this.gameState.setEmote(ghost.id, reaction.value, 4500);
        const entry = this.chatLog.record({
          kind: "ghost_emote",
          playerId: ghost.id,
          playerName: ghost.buddyMeta?.buddyName || ghost.name,
          message: reaction.value,
          dominantColor: ghost.buddyMeta?.dominantColor ?? "#79c4a0",
          rarity: ghost.buddyMeta?.rarity ?? "common"
        });
        onGhostEmote?.(ghost, reaction.value, entry);
      }

      this.markGhostDirty(ghost.id);
    }
  }

  evictGhostEntity(id) {
    const ghost = this.gameState.getPlayer(id);
    let tombstone = null;

    if (ghost?.isGhost) {
      tombstone = this.buildTombstone(ghost);
      this.db.saveTombstone(tombstone);
    }

    this.gameState.removeEntity(id);
    return { id, tombstone };
  }

  buildTombstone(ghost) {
    const buddyName = ghost.buddyMeta?.buddyName || ghost.name || "Terminal Friend";
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TOMBSTONE_LIFETIME_MS).toISOString();
    const rarityLabel = ghost.buddyMeta?.rarityLabel || "Common";
    const species = ghost.buddyMeta?.species || "terminal friend";

    return {
      id: crypto.randomUUID(),
      ghostId: ghost.id,
      buddyName,
      rarity: ghost.buddyMeta?.rarity || "common",
      rarityStars: ghost.buddyMeta?.rarityStars || 1,
      species,
      dominantColor: ghost.buddyMeta?.dominantColor || "#9aa6a0",
      x: ghost.x,
      y: ghost.y,
      epitaph: `Here rests ${buddyName} • ${rarityLabel} ${capitalize(species)}`,
      createdAt,
      expiresAt
    };
  }

  markGhostDirty(id) {
    this.dirtyGhostIds.add(id);
  }

  rebalanceGhostDensity(currentTime, { onGhostSleep, onGhostWakeAmbient }) {
    const livePlayers = this.gameState.getLivePlayers();
    const ghosts = this.gameState.getGhostPlayers();
    const activeGhosts = ghosts.filter((ghost) => !ghost.isSleeping);
    const targetGhosts = clamp(
      GHOST_DENSITY.targetPopulation - livePlayers.length,
      GHOST_DENSITY.minGhosts,
      GHOST_DENSITY.maxGhosts
    );

    if (activeGhosts.length > targetGhosts) {
      const toSleep = Math.min(activeGhosts.length - targetGhosts, GHOST_DENSITY.rampDownSpeed);
      const ghostsToSleep = pickGhostsToSleep(activeGhosts, livePlayers, toSleep);
      ghostsToSleep.forEach((ghost) => this.sleepGhost(ghost, currentTime, onGhostSleep));
      return;
    }

    if (activeGhosts.length < targetGhosts) {
      const toWake = Math.min(targetGhosts - activeGhosts.length, GHOST_DENSITY.rampUpSpeed);
      const sleepingGhosts = ghosts.filter((ghost) => ghost.isSleeping);
      const ghostsToWake = pickGhostsToWake(sleepingGhosts, livePlayers, toWake);
      ghostsToWake.forEach((ghost) => this.wakeGhost(ghost, currentTime, activeGhosts.length, onGhostWakeAmbient));
    }
  }

  sleepGhost(ghost, currentTime, onGhostSleep) {
    if (!ghost || ghost.isSleeping) {
      return;
    }

    ghost.isSleeping = true;
    ghost.isDormant = true;
    ghost.chatMessage = "";
    ghost.chatExpiresAt = 0;
    ghost.emote = "";
    ghost.emoteExpiresAt = 0;
    ghost.lastUpdate = Date.now();
    ghost.ghostData.nextDecisionAt = currentTime + 10_000;
    ghost.ghostData.nextStepAt = currentTime + 10_000;
    ghost.ghostData.nextSpeechAt = currentTime + getGhostChatInterval(0);
    this.markGhostDirty(ghost.id);
    onGhostSleep?.(ghost, 3000);
  }

  wakeGhost(ghost, currentTime, activeGhostCount, onGhostWakeAmbient) {
    if (!ghost || !ghost.isSleeping) {
      return;
    }

    ghost.isSleeping = false;
    ghost.isDormant = false;
    ghost.lastUpdate = Date.now();
    ghost.ghostData.nextDecisionAt = currentTime + 800 + Math.floor(Math.random() * 1200);
    ghost.ghostData.nextStepAt = currentTime + 250;
    ghost.ghostData.nextSpeechAt = currentTime + getGhostChatInterval(Math.max(1, activeGhostCount + 1));
    this.markGhostDirty(ghost.id);
    onGhostWakeAmbient?.(ghost, 2000);
  }
}

function capitalize(value) {
  return String(value || "")
    .split(" ")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pickGhostsToSleep(activeGhosts, livePlayers, count) {
  return activeGhosts
    .slice()
    .sort((left, right) => nearestLiveDistance(right, livePlayers) - nearestLiveDistance(left, livePlayers))
    .slice(0, count);
}

function pickGhostsToWake(sleepingGhosts, livePlayers, count) {
  return sleepingGhosts
    .slice()
    .sort((left, right) => nearestLiveDistance(left, livePlayers) - nearestLiveDistance(right, livePlayers))
    .slice(0, count);
}

function nearestLiveDistance(ghost, livePlayers) {
  if (!livePlayers.length) {
    return 0;
  }

  let best = Number.POSITIVE_INFINITY;
  for (const player of livePlayers) {
    const distance = Math.abs(player.x - ghost.x) + Math.abs(player.y - ghost.y);
    if (distance < best) {
      best = distance;
    }
  }

  return best;
}
