const TILE_COLORS = {
  0: "#788c5d",
  1: "#b0aea5",
  2: "#4a4a4a",
  3: "#6a9bcc",
  4: "#e8e6dc",
  5: "#d97757",
  6: "#95a46d",
  7: "#808080",
  8: "#d97757",
  9: "#7f715f",
  10: "#8f8f8f"
};

export class Minimap {
  constructor(size = 120, radius = 8) {
    this.size = size;
    this.radius = radius;
    this.dotSize = 3;
  }

  draw(ctx, width, player, entities, tokens, tileMap) {
    if (!player || !tileMap?.tiles) {
      return;
    }

    const mx = width - this.size - 12;
    const my = 46;
    const cx = mx + this.size / 2;
    const cy = my + this.size / 2;
    const scale = this.size / (this.radius * 2);

    ctx.save();
    ctx.fillStyle = "rgba(20, 20, 19, 0.76)";
    ctx.beginPath();
    ctx.arc(cx, cy, this.size / 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#d97757";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, this.size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(-player.angle + Math.PI / 2);

    for (let dy = -this.radius; dy <= this.radius; dy += 1) {
      for (let dx = -this.radius; dx <= this.radius; dx += 1) {
        const tx = Math.floor(player.x + dx);
        const ty = Math.floor(player.y + dy);
        if (ty < 0 || tx < 0 || ty >= tileMap.tiles.length || tx >= tileMap.tiles[0].length) {
          continue;
        }

        const tile = tileMap.tiles[ty][tx];
        ctx.fillStyle = TILE_COLORS[tile] || "#141413";
        ctx.fillRect(dx * scale - scale / 2, dy * scale - scale / 2, scale + 1, scale + 1);
      }
    }

    for (const token of tokens.values()) {
      const dx = token.x + 0.5 - player.x;
      const dy = token.y + 0.5 - player.y;
      if (Math.abs(dx) > this.radius || Math.abs(dy) > this.radius) {
        continue;
      }
      ctx.fillStyle = "#d97757";
      ctx.beginPath();
      ctx.arc(dx * scale, dy * scale, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const entity of entities.values()) {
      if (entity.id === player.id || entity.isSleeping) {
        continue;
      }

      const dx = entity.x - player.x;
      const dy = entity.y - player.y;
      if (Math.abs(dx) > this.radius || Math.abs(dy) > this.radius) {
        continue;
      }

      ctx.fillStyle = entity.isGhost ? "rgba(176, 174, 165, 0.5)" : "#faf9f5";
      ctx.beginPath();
      ctx.arc(dx * scale, dy * scale, this.dotSize, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    ctx.fillStyle = "#d97757";
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx - 3, cy + 3);
    ctx.lineTo(cx + 3, cy + 3);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(217, 119, 87, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, cy - this.size / 2 + 6);
    ctx.stroke();

    ctx.restore();
  }
}
