function hexToRgb(hex) {
  const normalized = (hex || "#79c4a0").replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;
  const parsed = Number.parseInt(value, 16);
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255
  };
}

function alpha(color, amount) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${amount})`;
}

function hashId(id = "") {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

export class AuraRenderer {
  draw(ctx, player, x, y, size, enabled = true) {
    if (!enabled || !player?.hasRealBuddy || !player?.buddyMeta) {
      return;
    }

    const rarity = player.buddyMeta.rarity ?? "common";
    if (rarity === "common") {
      return;
    }

    const now = performance.now();
    const centerX = x + size / 2;
    const centerY = y + size * 0.74;
    const baseColor = hexToRgb(player.buddyMeta.dominantColor);

    switch (rarity) {
      case "uncommon":
        this.drawPulse(ctx, centerX, centerY, baseColor, now, 26, 0.22);
        break;
      case "rare":
        this.drawPulse(ctx, centerX, centerY, baseColor, now, 28, 0.18);
        this.drawRareRing(ctx, centerX, centerY, baseColor, now);
        break;
      case "epic":
        this.drawPulse(ctx, centerX, centerY, { r: 165, g: 108, b: 255 }, now, 30, 0.2);
        this.drawParticles(ctx, player.id, centerX, y + size * 0.1, { r: 174, g: 132, b: 255 }, now, 6);
        break;
      case "legendary":
        this.drawPulse(ctx, centerX, centerY, { r: 255, g: 212, b: 92 }, now, 32, 0.24);
        this.drawRareRing(ctx, centerX, centerY, { r: 255, g: 212, b: 92 }, now * 1.2);
        this.drawParticles(ctx, player.id, centerX, y + size * 0.08, { r: 255, g: 226, b: 126 }, now, 8);
        this.drawRainbowOutline(ctx, x + 2, y + 4, size - 4, size - 8, now);
        break;
      default:
        break;
    }
  }

  drawPulse(ctx, centerX, centerY, color, now, radius, baseAlpha) {
    const pulse = 1 + Math.sin(now / 450) * 0.08;
    ctx.save();
    const gradient = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, radius * pulse);
    gradient.addColorStop(0, alpha(color, baseAlpha));
    gradient.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawRareRing(ctx, centerX, centerY, color, now) {
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(now / 2200);
    ctx.strokeStyle = alpha(color, 0.5);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 18, 10, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawParticles(ctx, id, centerX, startY, color, now, count) {
    const seed = hashId(id);
    ctx.save();
    for (let index = 0; index < count; index += 1) {
      const phase = (seed % 17) * 0.1 + index * 0.75;
      const drift = Math.sin(now / 450 + phase) * 10;
      const rise = ((now / 28) + index * 9 + seed) % 34;
      const alphaValue = 0.16 + ((index % 3) * 0.08);
      ctx.fillStyle = alpha(color, alphaValue);
      ctx.fillRect(centerX - 8 + drift, startY - rise, 3, 3);
    }
    ctx.restore();
  }

  drawRainbowOutline(ctx, x, y, width, height, now) {
    const hue = Math.floor((now / 20) % 360);
    ctx.save();
    ctx.strokeStyle = `hsla(${hue}, 80%, 70%, 0.6)`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
  }
}
