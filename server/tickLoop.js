import { encodeBatch } from "./protocol.js";

function sendJson(ws, payload) {
  if (ws.readyState !== 1) {
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
  onGhostEvicted,
  onTokensSpawned
}) {
  const tickRate = 20;
  let currentTick = 0;

  const interval = setInterval(() => {
    gameState.clearExpiredSpeech();

    const timedOutPlayers = gameState.getTimedOutPlayers();
    if (timedOutPlayers.length > 0 && onTimeoutPlayers) {
      onTimeoutPlayers(timedOutPlayers);
    }

    ghostManager?.updateGhosts({
      onGhostChat,
      onGhostEmote,
      onGhostEvicted
    });

    tokenSpawner?.tick(Date.now(), {
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

        if (batchedMoves.length > 0 && recipient.ws.readyState === 1) {
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
