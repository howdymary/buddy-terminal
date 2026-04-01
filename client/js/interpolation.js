export function applyRemoteMovement(player, x, y, angle, timestamp = performance.now()) {
  player.prevRenderX = player.renderX ?? player.x ?? x;
  player.prevRenderY = player.renderY ?? player.y ?? y;
  player.prevRenderAngle = player.renderAngle ?? player.angle ?? angle ?? 0;
  player.targetX = x;
  player.targetY = y;
  player.targetAngle = angle ?? player.angle ?? 0;
  player.x = x;
  player.y = y;
  player.angle = angle ?? player.angle ?? 0;
  player.direction = directionFromAngle(player.angle);
  player.lastNetworkAt = timestamp;
}

export function stepRemotePlayers(players, tickIntervalMs = 50) {
  const now = performance.now();

  for (const player of players.values()) {
    if (player.isLocal) {
      player.renderX = player.x;
      player.renderY = player.y;
      player.renderAngle = player.angle ?? 0;
      continue;
    }

    const lastAt = player.lastNetworkAt ?? now;
    const t = Math.min((now - lastAt) / tickIntervalMs, 1);
    player.renderX = lerp(player.prevRenderX ?? player.x, player.targetX ?? player.x, t);
    player.renderY = lerp(player.prevRenderY ?? player.y, player.targetY ?? player.y, t);
    player.renderAngle = lerpAngle(
      player.prevRenderAngle ?? player.angle ?? 0,
      player.targetAngle ?? player.angle ?? 0,
      t
    );
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpAngle(from, to, t) {
  const fullTurn = Math.PI * 2;
  let delta = ((to - from + Math.PI) % fullTurn) - Math.PI;
  if (delta < -Math.PI) {
    delta += fullTurn;
  }
  return from + (delta * t);
}

function directionFromAngle(angle = 0) {
  const normalized = ((angle % (Math.PI * 2)) + (Math.PI * 2)) % (Math.PI * 2);
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
