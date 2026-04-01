export function applyRemoteMovement(player, x, y, direction, timestamp = performance.now()) {
  player.prevRenderX = player.renderX ?? player.x ?? x;
  player.prevRenderY = player.renderY ?? player.y ?? y;
  player.targetX = x;
  player.targetY = y;
  player.x = x;
  player.y = y;
  player.direction = direction;
  player.lastNetworkAt = timestamp;
}

export function stepRemotePlayers(players, tickIntervalMs = 50) {
  const now = performance.now();

  for (const player of players.values()) {
    if (player.isLocal) {
      player.renderX = player.x;
      player.renderY = player.y;
      continue;
    }

    const lastAt = player.lastNetworkAt ?? now;
    const t = Math.min((now - lastAt) / tickIntervalMs, 1);
    player.renderX = lerp(player.prevRenderX ?? player.x, player.targetX ?? player.x, t);
    player.renderY = lerp(player.prevRenderY ?? player.y, player.targetY ?? player.y, t);
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
