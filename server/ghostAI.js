import { performance } from "node:perf_hooks";

import { sanitizeChatMessage } from "./chatFilter.js";
import { MAP_HEIGHT, MAP_WIDTH, SPAWN_POINT, isWalkable } from "./collisionMap.js";
import { findPath } from "./pathfinding.js";
import { pickGhostPhrase } from "./phrasePools.js";

const MAP_CENTER = {
  x: Math.floor(MAP_WIDTH / 2),
  y: Math.floor(MAP_HEIGHT / 2)
};

const now = () => performance.now();

export function updateGhostEntity(ghost, gameState, currentTime = now()) {
  if (!ghost.isGhost) {
    return { moved: false, chatted: null, becameDormant: false };
  }

  if (ghost.isSleeping) {
    return { moved: false, chatted: null, becameDormant: false };
  }

  const nearestLive = findNearestLivePlayer(ghost, gameState);
  const distanceToLive = nearestLive ? manhattan(ghost, nearestLive) : Number.POSITIVE_INFINITY;
  const isDormant = distanceToLive > 15;
  const becameDormant = ghost.isDormant !== isDormant;
  ghost.isDormant = isDormant;

  if (isDormant) {
    return { moved: false, chatted: null, becameDormant };
  }

  if (!ghost.ghostData?.wanderTarget || currentTime >= (ghost.ghostData.nextDecisionAt ?? 0)) {
    ghost.ghostData.wanderTarget = pickWanderTarget(ghost, nearestLive);
    ghost.ghostData.nextDecisionAt = currentTime + 5000 + Math.floor(Math.random() * 10_000);
  }

  let moved = false;
  const shouldStep = currentTime >= (ghost.ghostData.nextStepAt ?? 0);
  if (shouldStep && ghost.ghostData.wanderTarget) {
    const path = findPath(
      { x: Math.floor(ghost.x), y: Math.floor(ghost.y) },
      ghost.ghostData.wanderTarget,
      {
        isWalkable: (x, y) => isWalkable(x, y),
        isOccupied: (x, y) => gameState.isOccupiedTile(x, y, ghost.id)
      }
    );

    const next = path[0];
    if (next) {
      const direction = getDirection(ghost, next);
      const result = gameState.moveEntity(ghost.id, next.x + 0.5, next.y + 0.5, direction);
      moved = result.ok;
    }

    ghost.ghostData.nextStepAt = currentTime + 180;
  }

  let chatted = null;
  if (currentTime >= (ghost.ghostData.nextSpeechAt ?? 0)) {
    const phrase = pickGhostPhrase(ghost);
    const sanitized = sanitizeChatMessage(phrase);
    chatted = sanitized.ok ? sanitized.cleaned : phrase;
    ghost.ghostData.nextSpeechAt = currentTime + getGhostChatInterval(gameState.getGhostPlayers()
      .filter((entity) => entity.isGhost && !entity.isSleeping).length);
    ghost.ghostData.lastSpoke = currentTime;
  }

  return { moved, chatted, becameDormant };
}

export function maybeReactToNearbyChat(ghost, speaker, now = performance.now()) {
  if (!ghost.isGhost || ghost.isDormant || ghost.isSleeping) {
    return null;
  }

  if (manhattan(ghost, speaker) > 2) {
    return null;
  }

  const cooldown = ghost.ghostData?.reactCooldownUntil ?? 0;
  if (now < cooldown) {
    return null;
  }

  if (Math.random() < 0.2) {
    ghost.ghostData.reactCooldownUntil = now + 30_000;
    const emotes = ["✨", "👋"];
    return {
      type: "emote",
      value: emotes[Math.floor(Math.random() * emotes.length)]
    };
  }

  if (Math.random() < 0.15) {
    ghost.ghostData.reactCooldownUntil = now + 30_000;
    const sanitized = sanitizeChatMessage(`hey ${speaker.name}! 👋`);
    return {
      type: "chat",
      value: sanitized.ok ? sanitized.cleaned : "hey there! 👋"
    };
  }

  return null;
}

export function getGhostChatInterval(activeGhostCount) {
  if (activeGhostCount <= 3) {
    return 45_000 + Math.floor(Math.random() * 60_000);
  }

  if (activeGhostCount <= 10) {
    return 60_000 + Math.floor(Math.random() * 120_000);
  }

  return 120_000 + Math.floor(Math.random() * 180_000);
}

function pickWanderTarget(ghost, nearestLive) {
  const roll = Math.random();
  if (roll < 0.6) {
    return randomWalkableTileNear(ghost.x, ghost.y, 6);
  }
  if (roll < 0.9 && nearestLive) {
    return { x: Math.floor(nearestLive.x), y: Math.floor(nearestLive.y) };
  }
  return MAP_CENTER;
}

function randomWalkableTileNear(x, y, radius) {
  const originX = Math.floor(x);
  const originY = Math.floor(y);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = {
      x: clamp(originX + Math.floor((Math.random() * (radius * 2 + 1)) - radius), 1, MAP_WIDTH - 2),
      y: clamp(originY + Math.floor((Math.random() * (radius * 2 + 1)) - radius), 1, MAP_HEIGHT - 2)
    };
    if (isWalkable(candidate.x, candidate.y)) {
      return candidate;
    }
  }
  return SPAWN_POINT;
}

function findNearestLivePlayer(ghost, gameState) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entity of gameState.getLivePlayers()) {
    const distance = manhattan(ghost, entity);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entity;
    }
  }
  return best;
}

function getDirection(current, next) {
  if (next.x > current.x) return "right";
  if (next.x < current.x) return "left";
  if (next.y > current.y) return "down";
  return "up";
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
