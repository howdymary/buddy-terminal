const TOKEN_SIZE = 18;

export class TokenRenderer {
  constructor() {
    this.collectionBursts = [];
  }

  recordCollection({ x, y, label = "+1" }) {
    this.collectionBursts.push({
      x,
      y,
      label,
      startedAt: performance.now()
    });
  }

  draw(ctx, tokens, camera, tilePixels) {
    const now = performance.now();
    for (const token of tokens.values()) {
      this.drawToken(ctx, token, camera, tilePixels, now);
    }

    this.collectionBursts = this.collectionBursts.filter((burst) => now - burst.startedAt < 700);
    for (const burst of this.collectionBursts) {
      this.drawBurst(ctx, burst, camera, tilePixels, now);
    }
  }

  drawToken(ctx, token, camera, tilePixels, now) {
    const bob = Math.sin(now / 240 + token.x * 0.7 + token.y * 0.35) * 3;
    const sparkle = (Math.sin(now / 350 + token.x) + 1) / 2;
    const cx = token.x * tilePixels - camera.x + tilePixels / 2;
    const cy = token.y * tilePixels - camera.y + tilePixels / 2 + bob;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.fillStyle = "rgba(20, 20, 19, 0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 10, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#d97757";
    ctx.beginPath();
    ctx.arc(0, 0, TOKEN_SIZE / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#f3ba95";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, TOKEN_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#faf9f5";
    ctx.fillRect(-2, -5, 4, 10);
    ctx.fillRect(-4, -1, 8, 2);

    ctx.globalAlpha = 0.35 + sparkle * 0.4;
    ctx.fillStyle = "#f6d7aa";
    ctx.fillRect(-9, -10, 3, 3);
    ctx.fillRect(7, -7, 2, 2);
    ctx.fillRect(5, 5, 3, 3);
    ctx.restore();
  }

  drawBurst(ctx, burst, camera, tilePixels, now) {
    const age = now - burst.startedAt;
    const progress = Math.min(age / 700, 1);
    const cx = burst.x * tilePixels - camera.x + tilePixels / 2;
    const cy = burst.y * tilePixels - camera.y + tilePixels / 2 - progress * 22;

    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.fillStyle = "#faf9f5";
    ctx.font = "10px 'Press Start 2P', monospace";
    ctx.fillText(burst.label, cx - 10, cy);
    ctx.fillStyle = "#f1c6a6";
    ctx.fillRect(cx - 12, cy + 6, 4, 4);
    ctx.fillRect(cx + 10, cy + 2, 4, 4);
    ctx.fillRect(cx - 2, cy - 8, 4, 4);
    ctx.restore();
  }
}
