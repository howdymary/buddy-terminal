function roundRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  if (fill) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
}

export class GhostRenderer {
  getBobOffset(player, now = performance.now()) {
    if (!player.isGhost) {
      return 0;
    }
    const visibility = this.getVisibility(player, now);
    return Math.sin(now / 1000 + player.playerIndex * 0.35) * 2 * Math.max(0.3, visibility);
  }

  getVisibility(player, now = performance.now()) {
    if (!player?.isGhost) {
      return 1;
    }

    const transition = player.ghostTransition;
    if (!transition) {
      return player.isSleeping ? 0 : 1;
    }

    const durationMs = Math.max(1, transition.durationMs || 1);
    const progress = Math.min(1, Math.max(0, (now - transition.startedAt) / durationMs));
    const visibility = transition.from + ((transition.to - transition.from) * progress);
    if (progress >= 1) {
      player.ghostTransition = null;
    }
    return visibility;
  }

  applyGhostSpriteState(ctx, player, now = performance.now()) {
    if (!player.isGhost) {
      return;
    }
    const visibility = this.getVisibility(player, now);
    const baseAlpha = player.isSleeping ? 0.02 : player.isDormant ? 0.38 : 0.66;
    ctx.globalAlpha *= visibility * baseAlpha;
  }

  drawGhostNameTag(ctx, player, centerX, y, now = performance.now()) {
    const visibility = this.getVisibility(player, now);
    if (visibility < 0.24) {
      return;
    }

    const label = `NPC · ${player.buddyMeta?.buddyName || player.name}`;
    ctx.save();
    ctx.globalAlpha *= visibility;
    ctx.font = "7px 'Press Start 2P', monospace";
    const width = ctx.measureText(label).width + 12;
    const x = centerX - width / 2;
    ctx.fillStyle = "rgba(138, 145, 142, 0.78)";
    roundRect(ctx, x, y, width, 16, 7, true);
    ctx.fillStyle = "#141413";
    ctx.fillText(label, x + 6, y + 11);
    ctx.restore();
  }

  buildGhostTooltip(player) {
    const rarity = "★".repeat(player.buddyMeta?.rarityStars || 1);
    const label = player.buddyMeta?.rarityLabel || "Common";
    const species = player.buddyMeta?.species || "Ghost";
    const mode = player.isSleeping ? "sleeping" : player.isDormant ? "drifting" : "wandering";
    return `NPC · ${player.buddyMeta?.buddyName || player.name} - ${mode} - ${rarity} ${label} ${capitalize(species)}`;
  }
}

function capitalize(value) {
  return String(value || "")
    .split(" ")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
