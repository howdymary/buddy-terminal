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
    return Math.sin(now / 1000 + player.playerIndex * 0.35) * 2;
  }

  applyGhostSpriteState(ctx, player) {
    if (!player.isGhost) {
      return;
    }
    ctx.globalAlpha *= player.isDormant ? 0.42 : 0.7;
  }

  drawGhostNameTag(ctx, player, centerX, y) {
    const label = `👻 ${player.buddyMeta?.buddyName || player.name}`;
    ctx.font = "10px 'Press Start 2P', monospace";
    const width = ctx.measureText(label).width + 16;
    const x = centerX - width / 2;
    ctx.fillStyle = "rgba(189, 232, 214, 0.88)";
    roundRect(ctx, x, y, width, 18, 8, true);
    ctx.fillStyle = "#173126";
    ctx.fillText(label, x + 8, y + 12);
  }

  buildGhostTooltip(player) {
    const rarity = "★".repeat(player.buddyMeta?.rarityStars || 1);
    const label = player.buddyMeta?.rarityLabel || "Common";
    const species = player.buddyMeta?.species || "Ghost";
    return `👻 ${player.buddyMeta?.buddyName || player.name} - sleeping - ${rarity} ${label} ${capitalize(species)}`;
  }
}

function capitalize(value) {
  return String(value || "")
    .split(" ")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}
