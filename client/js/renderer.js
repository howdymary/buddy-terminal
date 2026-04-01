import { AuraRenderer } from "./auraRenderer.js";
import { drawChatBubble } from "./chatBubble.js";
import { GhostRenderer } from "./ghostRenderer.js";
import { drawSpriteFrame } from "./spriteGen.js";
import { TokenRenderer } from "./tokenRenderer.js";

const TILE_RENDER_SIZE = 48;

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

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function rarityBadge(meta) {
  if (!meta) {
    return "";
  }
  return `${"★".repeat(meta.rarityStars || 1)} ${meta.rarityLabel || "Common"} ${capitalize(meta.species || "Buddy")}`;
}

function capitalize(value) {
  return String(value || "")
    .split(" ")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.auraRenderer = new AuraRenderer();
    this.ghostRenderer = new GhostRenderer();
    this.tokenRenderer = new TokenRenderer();
    this.resize();
  }

  get tilePixels() {
    return TILE_RENDER_SIZE;
  }

  resize() {
    const width = Math.floor(window.innerWidth);
    const height = Math.floor(window.innerHeight);
    this.canvas.width = width * this.pixelRatio;
    this.canvas.height = height * this.pixelRatio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  recordTokenCollection(payload) {
    this.tokenRenderer.recordCollection(payload);
  }

  render({
    map,
    camera,
    players,
    tokens,
    tombstones,
    localPlayerId,
    tutorialBubble,
    hoveredPlayerId,
    hoveredTombstoneId,
    auraEnabled
  }) {
    const ctx = this.ctx;
    const width = this.canvas.width / this.pixelRatio;
    const height = this.canvas.height / this.pixelRatio;
    ctx.clearRect(0, 0, width, height);

    this.drawSkyBackdrop(width, height);
    this.drawMap(map, camera, width, height);
    this.drawMemorialGarden(map, camera);
    this.tokenRenderer.draw(ctx, tokens, camera, TILE_RENDER_SIZE);
    this.drawTombstones(tombstones, players.get(localPlayerId), camera, hoveredTombstoneId);
    this.drawPlayers(players, localPlayerId, camera, hoveredPlayerId, auraEnabled);
    if (tutorialBubble?.visible) {
      this.drawTutorialBubble(map.sign, tutorialBubble, camera);
    }
  }

  drawSkyBackdrop(width, height) {
    const ctx = this.ctx;
    ctx.fillStyle = "#141413";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(232, 230, 220, 0.04)";
    for (let i = 0; i < width; i += 120) {
      ctx.fillRect(i, 0, 1, height);
    }
    ctx.fillStyle = "rgba(217, 119, 87, 0.10)";
    ctx.fillRect(0, 0, width, Math.min(132, height * 0.24));
    ctx.fillStyle = "rgba(106, 155, 204, 0.16)";
    for (let i = 0; i < width; i += 140) {
      ctx.fillRect(i + 30, 26 + ((i / 140) % 2) * 12, 36, 2);
    }
  }

  drawMap(map, camera, width, height) {
    const ctx = this.ctx;
    const startX = Math.max(Math.floor(camera.x / TILE_RENDER_SIZE) - 1, 0);
    const startY = Math.max(Math.floor(camera.y / TILE_RENDER_SIZE) - 1, 0);
    const endX = Math.min(Math.ceil((camera.x + width) / TILE_RENDER_SIZE) + 1, map.width);
    const endY = Math.min(Math.ceil((camera.y + height) / TILE_RENDER_SIZE) + 1, map.height);

    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const screenX = x * TILE_RENDER_SIZE - camera.x;
        const screenY = y * TILE_RENDER_SIZE - camera.y;
        this.drawTile(map.tiles[y][x], screenX, screenY);
      }
    }
  }

  drawMemorialGarden(map, camera) {
    if (!map?.graveyard) {
      return;
    }

    const ctx = this.ctx;
    const { x, y, width, height, label } = map.graveyard;
    const screenX = x * TILE_RENDER_SIZE - camera.x;
    const screenY = y * TILE_RENDER_SIZE - camera.y;
    const pixelWidth = width * TILE_RENDER_SIZE;
    const pixelHeight = height * TILE_RENDER_SIZE;

    ctx.save();
    ctx.fillStyle = "rgba(73, 99, 71, 0.22)";
    ctx.fillRect(screenX, screenY, pixelWidth, pixelHeight);

    ctx.strokeStyle = "rgba(218, 232, 214, 0.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(screenX + 6, screenY + 6, pixelWidth - 12, pixelHeight - 12);

    for (let offset = 14; offset < pixelWidth - 12; offset += 28) {
      ctx.fillStyle = "#d7dfc8";
      ctx.fillRect(screenX + offset, screenY + 10, 10, 6);
      ctx.fillRect(screenX + offset, screenY + pixelHeight - 16, 10, 6);
    }

    for (let column = 0; column < width; column += 1) {
      const flowerX = screenX + column * TILE_RENDER_SIZE + 12;
      const flowerY = screenY + pixelHeight - 18 + ((column % 2) * 3);
      ctx.fillStyle = "#f3d6a4";
      ctx.fillRect(flowerX, flowerY, 4, 4);
      ctx.fillStyle = "#d28aae";
      ctx.fillRect(flowerX + 6, flowerY + 3, 4, 4);
    }

    ctx.fillStyle = "rgba(18, 25, 20, 0.76)";
    roundRect(ctx, screenX + 10, screenY + 10, Math.max(118, label.length * 8 + 20), 22, 8, true);
    ctx.fillStyle = "#f5f0da";
    ctx.font = "9px 'Press Start 2P', monospace";
    ctx.fillText(label, screenX + 20, screenY + 24);
    ctx.restore();
  }

  drawTile(tileId, screenX, screenY) {
    const ctx = this.ctx;

    switch (tileId) {
      case 0:
        ctx.fillStyle = "#788c5d";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#87996f";
        ctx.fillRect(screenX + 5, screenY + 8, 8, 6);
        ctx.fillRect(screenX + 28, screenY + 22, 7, 6);
        break;
      case 1:
        ctx.fillStyle = "#b0aea5";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#cbc8bc";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, 5);
        ctx.fillStyle = "#9a988e";
        ctx.fillRect(screenX + 8, screenY, 4, TILE_RENDER_SIZE);
        break;
      case 2:
        ctx.fillStyle = "#788c5d";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#141413";
        ctx.fillRect(screenX + 12, screenY + 4, 24, 40);
        ctx.fillStyle = "#2d2b28";
        ctx.fillRect(screenX + 16, screenY + 8, 16, 32);
        ctx.fillStyle = "#6a9bcc";
        ctx.fillRect(screenX + 18, screenY + 12, 4, 4);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 26, screenY + 20, 4, 4);
        break;
      case 3:
        ctx.fillStyle = "#6a9bcc";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#3c5f86";
        ctx.beginPath();
        ctx.arc(screenX + 24, screenY + 24, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#faf9f5";
        ctx.fillRect(screenX + 22, screenY + 10, 4, 28);
        ctx.fillRect(screenX + 10, screenY + 22, 28, 4);
        ctx.fillRect(screenX + 14, screenY + 14, 6, 6);
        ctx.fillRect(screenX + 28, screenY + 28, 6, 6);
        break;
      case 4:
        ctx.fillStyle = "#e8e6dc";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#c9c7bf";
        for (let x = 0; x < TILE_RENDER_SIZE; x += 8) {
          ctx.fillRect(screenX + x, screenY, 3, TILE_RENDER_SIZE);
        }
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 14, screenY + 10, 20, 4);
        ctx.fillRect(screenX + 18, screenY + 18, 12, 12);
        break;
      case 5:
        ctx.fillStyle = "#788c5d";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#141413";
        ctx.fillRect(screenX + 11, screenY + 10, 26, 18);
        ctx.fillStyle = "#faf9f5";
        ctx.fillRect(screenX + 15, screenY + 14, 10, 3);
        ctx.fillRect(screenX + 15, screenY + 20, 6, 3);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 26, screenY + 20, 3, 3);
        break;
      case 6:
        ctx.fillStyle = "#788c5d";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 9, screenY + 17, 4, 4);
        ctx.fillRect(screenX + 24, screenY + 12, 4, 4);
        ctx.fillStyle = "#e8e6dc";
        ctx.fillRect(screenX + 14, screenY + 20, 3, 3);
        ctx.fillRect(screenX + 28, screenY + 18, 3, 3);
        break;
      case 7:
        ctx.fillStyle = "#b0aea5";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#e8e6dc";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, 5);
        ctx.fillStyle = "#141413";
        ctx.fillRect(screenX + 7, screenY + 10, 34, 22);
        ctx.fillStyle = "#6a9bcc";
        ctx.fillRect(screenX + 11, screenY + 14, 5, 5);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 21, screenY + 18, 5, 5);
        ctx.fillStyle = "#6a9bcc";
        ctx.fillRect(screenX + 31, screenY + 14, 5, 5);
        break;
      case 8:
        ctx.fillStyle = "#b0aea5";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 12, screenY + 6, 24, 34);
        ctx.fillStyle = "#f6c3af";
        ctx.fillRect(screenX + 17, screenY + 12, 14, 6);
        ctx.fillStyle = "#141413";
        ctx.fillRect(screenX + 23, screenY + 24, 3, 6);
        break;
      case 9:
        ctx.fillStyle = "#b0aea5";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#141413";
        ctx.fillRect(screenX + 6, screenY + 11, 36, 12);
        ctx.fillStyle = "#788c5d";
        ctx.fillRect(screenX + 10, screenY + 15, 8, 2);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 20, screenY + 15, 3, 3);
        ctx.fillStyle = "#141413";
        ctx.fillRect(screenX + 10, screenY + 23, 4, 10);
        ctx.fillRect(screenX + 30, screenY + 23, 4, 10);
        break;
      case 10:
        ctx.fillStyle = "#788c5d";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        ctx.fillStyle = "#b0aea5";
        ctx.fillRect(screenX + 21, screenY + 4, 6, 38);
        ctx.fillRect(screenX + 15, screenY + 20, 18, 4);
        ctx.fillStyle = "#d97757";
        ctx.fillRect(screenX + 20, screenY + 2, 8, 8);
        ctx.fillStyle = "#faf9f5";
        ctx.fillRect(screenX + 22, screenY + 4, 4, 4);
        break;
      default:
        ctx.fillStyle = "#000";
        ctx.fillRect(screenX, screenY, TILE_RENDER_SIZE, TILE_RENDER_SIZE);
        break;
    }
  }

  drawTombstones(tombstones, localPlayer, camera, hoveredTombstoneId) {
    if (!tombstones || tombstones.size === 0) {
      return;
    }

    const sorted = Array.from(tombstones.values()).sort((a, b) => a.y - b.y || a.x - b.x);

    for (const tombstone of sorted) {
      const tileX = tombstone.x * TILE_RENDER_SIZE - camera.x;
      const tileY = tombstone.y * TILE_RENDER_SIZE - camera.y;
      this.drawTombstoneSprite(tombstone, tileX, tileY);

      if (
        hoveredTombstoneId === tombstone.id &&
        (!localPlayer || manhattanDistance(localPlayer, tombstone) <= 3)
      ) {
        this.drawHoverTooltip(
          this.buildTombstoneTooltip(tombstone),
          tileX + TILE_RENDER_SIZE / 2,
          tileY - 8,
          tombstone.dominantColor || "#c9d1c6"
        );
      }
    }
  }

  drawTombstoneSprite(tombstone, tileX, tileY) {
    const ctx = this.ctx;
    const shimmer = Math.sin(performance.now() / 1000 + tileX * 0.02 + tileY * 0.02) * 0.08 + 0.92;
    const stoneX = tileX + 10;
    const stoneY = tileY + 8;

    ctx.save();
    ctx.globalAlpha = 0.94;

    ctx.fillStyle = "rgba(25, 34, 26, 0.22)";
    ctx.beginPath();
    ctx.ellipse(tileX + TILE_RENDER_SIZE / 2, tileY + TILE_RENDER_SIZE - 6, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#dde4db";
    ctx.fillRect(stoneX + 2, stoneY + 12, 24, 16);
    ctx.beginPath();
    ctx.arc(stoneX + 14, stoneY + 12, 12, Math.PI, 0, false);
    ctx.fill();

    ctx.strokeStyle = tombstone.dominantColor || "#a9c1b0";
    ctx.lineWidth = 2;
    ctx.strokeRect(stoneX + 2, stoneY + 12, 24, 16);
    ctx.beginPath();
    ctx.arc(stoneX + 14, stoneY + 12, 12, Math.PI, 0, false);
    ctx.stroke();

    ctx.fillStyle = `rgba(255,255,255,${0.12 * shimmer})`;
    ctx.fillRect(stoneX + 6, stoneY + 10, 4, 10);

    ctx.fillStyle = "#677368";
    const starLine = "★".repeat(Math.min(5, tombstone.rarityStars || 1));
    ctx.font = "7px 'Press Start 2P', monospace";
    ctx.fillText(starLine, stoneX + 4, stoneY + 22);
    ctx.fillRect(stoneX + 12, stoneY + 25, 4, 2);
    ctx.fillRect(stoneX + 18, stoneY + 20, 2, 8);
    ctx.fillRect(stoneX + 20, stoneY + 27, 2, 2);

    ctx.fillStyle = "#d59dbb";
    ctx.fillRect(tileX + 7, tileY + 34, 4, 4);
    ctx.fillStyle = "#f1df9b";
    ctx.fillRect(tileX + 34, tileY + 32, 4, 4);
    ctx.restore();
  }

  drawPlayers(players, localPlayerId, camera, hoveredPlayerId, auraEnabled) {
    const ctx = this.ctx;
    const localPlayer = players.get(localPlayerId);

    for (const player of players.values()) {
      const tileX = player.renderX * TILE_RENDER_SIZE - camera.x - TILE_RENDER_SIZE / 2;
      const tileY = player.renderY * TILE_RENDER_SIZE - camera.y - TILE_RENDER_SIZE;
      const spriteX = tileX;
      const spriteY = tileY - TILE_RENDER_SIZE / 2 + this.ghostRenderer.getBobOffset(player);
      const spriteSize = TILE_RENDER_SIZE * 1.5;
      const isNear = localPlayer && player.id !== localPlayer.id && manhattanDistance(localPlayer, player) <= 1;
      const frame = Math.floor(performance.now() / 180) % 2;

      if (isNear) {
        ctx.fillStyle = "rgba(242, 211, 106, 0.16)";
        ctx.beginPath();
        ctx.arc(tileX + TILE_RENDER_SIZE / 2, tileY + TILE_RENDER_SIZE, TILE_RENDER_SIZE * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }

      this.auraRenderer.draw(ctx, player, spriteX, spriteY, spriteSize, auraEnabled);

      ctx.save();
      this.ghostRenderer.applyGhostSpriteState(ctx, player);
      if (player.spriteSheet) {
        drawSpriteFrame(ctx, player.spriteSheet.sheet, player.direction, frame, spriteX, spriteY, 1.5);
      } else {
        ctx.fillStyle = player.isLocal ? "#f2d36a" : "#f7f3de";
        ctx.fillRect(tileX + 8, tileY, 32, 48);
      }
      ctx.restore();

      if (player.isGhost) {
        this.ghostRenderer.drawGhostNameTag(ctx, player, tileX + TILE_RENDER_SIZE / 2, tileY + TILE_RENDER_SIZE + 18);
      } else {
        this.drawNameTag(player.name, tileX + TILE_RENDER_SIZE / 2, tileY + TILE_RENDER_SIZE + 18, player.id === localPlayerId);
      }

      drawChatBubble(ctx, {
        text: player.activeBubble?.text,
        centerX: tileX + TILE_RENDER_SIZE / 2,
        y: tileY - 22,
        expiresAt: player.activeBubble?.expiresAt,
        borderColor: player.buddyMeta?.dominantColor || "#dfe7d7",
        fillColor: player.isGhost
          ? "rgba(221, 244, 232, 0.82)"
          : player.hasRealBuddy
            ? "rgba(255,255,255,0.96)"
            : "rgba(250,248,240,0.95)"
      });

      if (
        hoveredPlayerId === player.id &&
        player.id !== localPlayerId &&
        player.buddyMeta &&
        (!localPlayer || manhattanDistance(localPlayer, player) <= 3)
      ) {
        const text = player.isGhost
          ? this.ghostRenderer.buildGhostTooltip(player)
          : rarityBadge(player.buddyMeta);
        this.drawHoverTooltip(text, tileX + TILE_RENDER_SIZE / 2, spriteY - 6, player.buddyMeta.dominantColor);
      }
    }
  }

  drawNameTag(name, centerX, y, isLocal) {
    const ctx = this.ctx;
    ctx.font = "10px 'Press Start 2P', monospace";
    const textWidth = ctx.measureText(name).width;
    const boxWidth = textWidth + 14;
    const boxX = centerX - boxWidth / 2;

    ctx.fillStyle = isLocal ? "rgba(242, 211, 106, 0.95)" : "rgba(255, 255, 255, 0.86)";
    if (isLocal) {
      ctx.fillStyle = "rgba(217, 119, 87, 0.95)";
    } else {
      ctx.fillStyle = "rgba(20, 20, 19, 0.82)";
    }
    roundRect(ctx, boxX, y, boxWidth, 18, 8, true);
    ctx.fillStyle = isLocal ? "#faf9f5" : "#faf9f5";
    ctx.fillText(name, boxX + 7, y + 12);
  }

  drawHoverTooltip(text, centerX, y, borderColor) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = "9px 'Press Start 2P', monospace";
    const width = ctx.measureText(text).width + 16;
    const x = centerX - width / 2;
    const boxY = y - 18;
    ctx.fillStyle = "rgba(12, 20, 15, 0.92)";
    ctx.strokeStyle = borderColor || "#d97757";
    ctx.lineWidth = 2;
    roundRect(ctx, x, boxY, width, 18, 8, true);
    ctx.stroke();
    ctx.fillStyle = "#f7f3de";
    ctx.fillText(text, x + 8, boxY + 12);
    ctx.restore();
  }

  buildTombstoneTooltip(tombstone) {
    const rarity = "★".repeat(tombstone.rarityStars || 1);
    return `Here rests ${tombstone.buddyName} - ${rarity} ${capitalize(tombstone.species || "Ghost")}`;
  }

  drawTutorialBubble(sign, tutorialBubble, camera) {
    const x = sign.x * TILE_RENDER_SIZE - camera.x + TILE_RENDER_SIZE / 2;
    const y = sign.y * TILE_RENDER_SIZE - camera.y - 20;
    drawChatBubble(this.ctx, {
      text: tutorialBubble.text,
      centerX: x,
      y,
      expiresAt: tutorialBubble.expiresAt,
      borderColor: "#f2d36a",
      fillColor: "rgba(250,249,245,0.97)"
    });
  }
}
