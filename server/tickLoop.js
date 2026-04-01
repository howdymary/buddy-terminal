import { performance } from "node:perf_hooks";

import { encodeBatch } from "./protocol.js";

const WS_BUFFER_LIMIT = 65_536;
const now = () => performance.now();

function sendJson(ws, payload) {
  if (!ws || ws.readyState !== 1) {
    return;
  }

  if (ws.bufferedAmount > WS_BUFFER_LIMIT) {
    return;
  }

  ws.send(JSON.stringify(payload));
}

export function startTickLoop({
  gameState,
  ghostManager,
  tokenSpawner,
  onTimeoutPlayers,
  onGhostChat,
  onGhostEmote,
  onGhostSleep,
  onGhostWakeAmbient,
  onGhostEvicted,
  onTokensSpawned
}) {
  const tickRate = 20;
  let currentTick = 0;

  const interval = setInterval(() => {
    const currentTime = now();
    gameState.clearExpiredSpeech();

    const timedOutPlayers = gameState.getTimedOutPlayers();
    if (timedOutPlayers.length > 0 && onTimeoutPlayers) {
      onTimeoutPlayers(timedOutPlayers);
    }

    ghostManager?.updateGhosts({
      now: currentTime,
      onGhostChat,
      onGhostEmote,
      onGhostSleep,
      onGhostWakeAmbient,
      onGhostEvicted
    });

    tokenSpawner?.tick(currentTime, {
      onTokensSpawned
    });

    const dirtyPlayers = gameState.consumeDirtyPlayers();
    if (dirtyPlayers.length > 0) {
      for (const recipient of gameState.getLiveRecipients()) {
        const visibleIds = gameState.grid.getNeighborPlayerIds(recipient.x, recipient.y);
        const batchedMoves = dirtyPlayers
          .filter((entity) => visibleIds.has(entity.id))
          .map((entity) => ({
            playerIndex: entity.playerIndex,
            x: entity.x,
            y: entity.y,
            direction: entity.direction
          }));

        if (
          batchedMoves.length > 0 &&
          recipient.ws.readyState === 1 &&
          recipient.ws.bufferedAmount <= WS_BUFFER_LIMIT
        ) {
          recipient.ws.send(encodeBatch(batchedMoves));
        }
      }
    }

    if (currentTick % tickRate === 0) {
      for (const player of gameState.getLiveRecipients()) {
        sendJson(player.ws, {
          type: "presence",
          onlineCount: gameState.getOnlineCount(),
          tick: currentTick
        });
      }
    }

    currentTick += 1;
  }, 1000 / tickRate);

  return () => clearInterval(interval);
}
