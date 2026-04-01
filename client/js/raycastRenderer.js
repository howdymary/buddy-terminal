import { Minimap } from "./minimap.js";

const FOV = Math.PI / 3;
const MAX_DEPTH = 24;
const WALKABLE_TILES = new Set([0, 1, 6, 9]);
const RARITY_COLORS = {
  common: "rgba(176, 174, 165, 0.0)",
  uncommon: "rgba(120, 140, 93, 0.32)",
  rare: "rgba(106, 155, 204, 0.4)",
  epic: "rgba(150, 100, 200, 0.48)",
  legendary: "rgba(217, 175, 87, 0.56)"
};

export class RaycastRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    this.minimap = new Minimap();
    this.tokenBursts = [];
    this.textures = buildWallTextures();
    this.tokenTexture = buildTokenTexture();
    this.tombstoneTexture = buildTombstoneTexture();
    this.resize();
  }

  resize() {
    const viewportWidth = Math.floor(window.innerWidth);
    const viewportHeight = Math.floor(window.innerHeight);
    const targetWidth = viewportWidth <= 768 ? 360 : Math.min(720, viewportWidth);
    const targetHeight = Math.max(220, Math.round(targetWidth * (viewportHeight / viewportWidth)));

    this.width = targetWidth;
    this.height = targetHeight;
    this.canvas.width = targetWidth;
    this.canvas.height = targetHeight;
    this.canvas.style.width = `${viewportWidth}px`;
    this.canvas.style.height = `${viewportHeight}px`;
    this.ctx.imageSmoothingEnabled = false;
  }

  recordTokenCollection(payload) {
    this.tokenBursts.push({
      ...payload,
      startedAt: performance.now()
    });
  }

  render({
    map,
    localPlayer,
    players,
    tokens,
    tombstones,
    tutorialBubble,
    auraEnabled = true
  }) {
    if (!map?.tiles || !localPlayer) {
      return;
    }

    const ctx = this.ctx;
    this.now = performance.now();
    ctx.clearRect(0, 0, this.width, this.height);

    this.drawSkyAndFloor(localPlayer, map);
    const camera = buildCamera(localPlayer.angle);
    const zBuffer = new Float32Array(this.width);
    this.drawWalls(map.tiles, localPlayer, camera, zBuffer);
    this.drawWorldSprites(localPlayer, camera, players, tokens, tombstones, zBuffer, auraEnabled);
    this.drawTokenBursts(localPlayer, camera, zBuffer);
    this.drawCrosshair();
    this.minimap.draw(ctx, this.width, localPlayer, players, tokens, map);
    this.drawTutorialBubble(tutorialBubble);
    this.drawScreenFx();
  }

  drawSkyAndFloor(player, map) {
    const ctx = this.ctx;
    const horizon = this.height / 2;

    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#141413");
    sky.addColorStop(1, "#2a3a4a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, horizon);

    ctx.fillStyle = "rgba(250, 249, 245, 0.08)";
    for (let i = 0; i < 18; i += 1) {
      const x = ((i * 97) + Math.floor(this.now / 40)) % this.width;
      const y = 14 + ((i * 29) % Math.max(18, horizon - 28));
      ctx.fillRect(x, y, 1, 1);
    }

    ctx.fillStyle = "rgba(17, 20, 22, 0.82)";
    const skylineBase = horizon - 18;
    for (let i = 0; i < 9; i += 1) {
      const offset = ((i * 83) - Math.floor(player.angle * 48)) % (this.width + 90);
      const x = ((offset + this.width + 90) % (this.width + 90)) - 40;
      const w = 26 + (i % 3) * 12;
      const h = 30 + (i % 4) * 14;
      ctx.fillRect(x, skylineBase - h, w, h);
      ctx.fillStyle = "rgba(217, 119, 87, 0.32)";
      ctx.fillRect(x + w - 4, skylineBase - h + 8, 2, 2);
      ctx.fillStyle = "rgba(17, 20, 22, 0.82)";
    }
    ctx.fillStyle = "rgba(245, 173, 120, 0.12)";
    ctx.fillRect(0, horizon - 6, this.width, 8);

    const floorBase = floorColorForTile(map.tiles[Math.floor(player.y)]?.[Math.floor(player.x)] ?? 1);
    const floor = ctx.createLinearGradient(0, horizon, 0, this.height);
    floor.addColorStop(0, mixColor(floorBase, "#6a7f62", 0.45));
    floor.addColorStop(1, mixColor(floorBase, "#2d3426", 0.6));
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, this.width, this.height - horizon);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
    ctx.lineWidth = 1;
    for (let y = horizon + 18; y < this.height; y += 22) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
      ctx.stroke();
    }
  }

  drawWalls(tileMap, player, camera, zBuffer) {
    const ctx = this.ctx;

    for (let col = 0; col < this.width; col += 1) {
      const cameraX = (2 * col / this.width) - 1;
      const rayDirX = camera.dirX + camera.planeX * cameraX;
      const rayDirY = camera.dirY + camera.planeY * cameraX;

      let mapX = Math.floor(player.x);
      let mapY = Math.floor(player.y);

      const deltaDistX = rayDirX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirX);
      const deltaDistY = rayDirY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / rayDirY);

      let sideDistX;
      let sideDistY;
      let stepX;
      let stepY;

      if (rayDirX < 0) {
        stepX = -1;
        sideDistX = (player.x - mapX) * deltaDistX;
      } else {
        stepX = 1;
        sideDistX = (mapX + 1 - player.x) * deltaDistX;
      }

      if (rayDirY < 0) {
        stepY = -1;
        sideDistY = (player.y - mapY) * deltaDistY;
      } else {
        stepY = 1;
        sideDistY = (mapY + 1 - player.y) * deltaDistY;
      }

      let hitTile = 0;
      let side = 0;
      let depthGuard = 0;

      while (depthGuard < 64) {
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }

        if (
          mapY < 0 ||
          mapX < 0 ||
          mapY >= tileMap.length ||
          mapX >= tileMap[0].length
        ) {
          break;
        }

        const tile = tileMap[mapY][mapX];
        if (!WALKABLE_TILES.has(tile)) {
          hitTile = tile;
          break;
        }
        depthGuard += 1;
      }

      if (!hitTile) {
        zBuffer[col] = MAX_DEPTH;
        continue;
      }

      const rawDistance = side === 0
        ? (mapX - player.x + (1 - stepX) / 2) / rayDirX
        : (mapY - player.y + (1 - stepY) / 2) / rayDirY;
      const distance = Math.max(0.12, Math.min(Math.abs(rawDistance), MAX_DEPTH));
      zBuffer[col] = distance;

      const lineHeight = Math.min(this.height * 1.4, this.height / distance);
      const drawStart = Math.round((this.height - lineHeight) / 2);
      let wallX = side === 0
        ? player.y + distance * rayDirY
        : player.x + distance * rayDirX;
      wallX -= Math.floor(wallX);
      const texture = this.textures.get(hitTile);
      const texX = texture ? Math.floor(wallX * texture.width) % texture.width : 0;

      if (texture) {
        ctx.drawImage(texture, texX, 0, 1, texture.height, col, drawStart, 1, lineHeight);
      } else {
        ctx.fillStyle = "#b0aea5";
        ctx.fillRect(col, drawStart, 1, lineHeight);
      }

      if (side === 1) {
        ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
        ctx.fillRect(col, drawStart, 1, lineHeight);
      }

      const fogAlpha = clamp((distance - 3.5) / 16, 0, 0.58);
      if (fogAlpha > 0) {
        ctx.fillStyle = `rgba(14, 15, 16, ${fogAlpha})`;
        ctx.fillRect(col, drawStart, 1, lineHeight);
      }
    }
  }

  drawWorldSprites(localPlayer, camera, players, tokens, tombstones, zBuffer, auraEnabled) {
    const sprites = [];

    for (const entity of players.values()) {
      if (entity.id === localPlayer.id || entity.isSleeping) {
        continue;
      }

      const texture = getEntityTexture(entity);
      if (!texture) {
        continue;
      }

      sprites.push({
        kind: "entity",
        id: entity.id,
        x: entity.renderX ?? entity.x,
        y: entity.renderY ?? entity.y,
        texture,
        spriteSheet: entity.spriteSheet,
        label: entity.isGhost ? `NPC · ${entity.buddyMeta?.buddyName || entity.name}` : entity.name,
        rarity: entity.buddyMeta?.rarity ?? "common",
        isGhost: Boolean(entity.isGhost),
        bubble: entity.activeBubble?.expiresAt > performance.now() ? entity.activeBubble : null,
        visibility: getGhostVisibility(entity),
        direction: entity.direction,
        isMoving: (
          Math.abs((entity.targetX ?? entity.x) - (entity.prevRenderX ?? entity.x)) > 0.03 ||
          Math.abs((entity.targetY ?? entity.y) - (entity.prevRenderY ?? entity.y)) > 0.03
        )
      });
    }

    for (const token of tokens.values()) {
      sprites.push({
        kind: "token",
        id: token.id,
        x: token.x + 0.5,
        y: token.y + 0.5,
        texture: this.tokenTexture,
        bob: Math.sin(performance.now() / 300 + token.x * 0.7) * 0.08 + 0.28,
        scale: 0.45
      });
    }

    for (const tombstone of tombstones.values()) {
      sprites.push({
        kind: "tombstone",
        id: tombstone.id,
        x: tombstone.x,
        y: tombstone.y,
        texture: this.tombstoneTexture,
        label: tombstone.buddyName,
        scale: 0.7
      });
    }

    sprites.sort((left, right) => (
      distanceSquared(right.x, right.y, localPlayer.x, localPlayer.y) -
      distanceSquared(left.x, left.y, localPlayer.x, localPlayer.y)
    ));

    for (const sprite of sprites) {
      this.drawBillboard(localPlayer, camera, sprite, zBuffer, auraEnabled);
    }
  }

  drawBillboard(localPlayer, camera, sprite, zBuffer, auraEnabled) {
    const ctx = this.ctx;
    const spriteX = sprite.x - localPlayer.x;
    const spriteY = sprite.y - localPlayer.y;

    const invDet = 1 / (camera.planeX * camera.dirY - camera.dirX * camera.planeY);
    const transformX = invDet * (camera.dirY * spriteX - camera.dirX * spriteY);
    const transformY = invDet * (-camera.planeY * spriteX + camera.planeX * spriteY);

    if (transformY <= 0.15 || transformY > MAX_DEPTH) {
      return;
    }

    const screenX = Math.round((this.width / 2) * (1 + transformX / transformY));
    const scale = sprite.scale ?? 0.9;
    const spriteHeight = Math.min(this.height * 1.4, Math.abs(this.height / transformY) * scale);
    const spriteWidth = spriteHeight;
    const verticalOffset = (sprite.bob ?? 0) * spriteHeight;
    const drawStartY = Math.round((this.height - spriteHeight) / 2 + (this.height * 0.12) - verticalOffset);
    const drawEndY = drawStartY + spriteHeight;
    const drawStartX = Math.round(screenX - spriteWidth / 2);
    const drawEndX = drawStartX + spriteWidth;

    if (drawEndX < 0 || drawStartX >= this.width) {
      return;
    }

    const visible = clampRange(drawStartX, drawEndX, 0, this.width);
    if (visible.start >= visible.end) {
      return;
    }

    const textureSource = resolveTextureSource(sprite, this.now);

    if (sprite.kind === "entity" && auraEnabled && sprite.rarity !== "common" && !sprite.isGhost) {
      const auraColor = RARITY_COLORS[sprite.rarity] || "transparent";
      ctx.save();
      ctx.fillStyle = auraColor;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(screenX, drawStartY + spriteHeight * 0.55, spriteWidth * 0.55, spriteHeight * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = sprite.kind === "token"
      ? "rgba(20, 20, 19, 0.18)"
      : "rgba(10, 10, 10, 0.24)";
    ctx.beginPath();
    ctx.ellipse(
      screenX,
      drawStartY + spriteHeight - Math.max(4, spriteHeight * 0.04),
      spriteWidth * 0.2,
      Math.max(3, spriteHeight * 0.05),
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.restore();

    if (sprite.isGhost) {
      ctx.save();
      ctx.globalAlpha = 0.55 * (sprite.visibility ?? 1);
    }

    for (let stripe = visible.start; stripe < visible.end; stripe += 1) {
      if (transformY >= zBuffer[stripe]) {
        continue;
      }

      const texX = Math.floor(((stripe - drawStartX) / spriteWidth) * textureSource.sw);
      ctx.drawImage(
        textureSource.image,
        textureSource.sx + clamp(texX, 0, textureSource.sw - 1),
        textureSource.sy,
        1,
        textureSource.sh,
        stripe,
        drawStartY,
        1,
        drawEndY - drawStartY
      );
    }

    if (sprite.isGhost) {
      ctx.restore();
    }

    if (sprite.label && transformY < 8) {
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = transformY < 4 ? '10px "Press Start 2P"' : '7px "Press Start 2P"';
      ctx.fillStyle = "rgba(20, 20, 19, 0.8)";
      ctx.fillText(sprite.label, screenX + 1, drawStartY - 7);
      ctx.fillStyle = sprite.isGhost ? "#b0aea5" : "#faf9f5";
      ctx.fillText(sprite.label, screenX, drawStartY - 8);
      ctx.restore();
    }

    if (sprite.bubble?.text && transformY < 10) {
      this.drawChatBubble(screenX, drawStartY - 24, sprite.bubble.text, sprite.isGhost);
    }
  }

  drawChatBubble(screenX, screenY, message, isGhost) {
    const ctx = this.ctx;
    const text = String(message || "").slice(0, 40);
    ctx.save();
    ctx.font = '6px "Press Start 2P"';
    const textWidth = ctx.measureText(text).width;
    const bubbleWidth = Math.min(220, textWidth + 12);
    const bubbleHeight = 18;
    const x = clamp(screenX - bubbleWidth / 2, 6, this.width - bubbleWidth - 6);
    const y = Math.max(6, screenY - bubbleHeight);

    roundRect(ctx, x, y, bubbleWidth, bubbleHeight, 4);
    ctx.fillStyle = isGhost ? "rgba(30, 30, 30, 0.85)" : "rgba(250, 249, 245, 0.94)";
    ctx.fill();

    ctx.fillStyle = isGhost ? "#b0aea5" : "#141413";
    ctx.textAlign = "center";
    ctx.fillText(text, x + bubbleWidth / 2, y + 12);
    ctx.restore();
  }

  drawTokenBursts(localPlayer, camera, zBuffer) {
    const now = performance.now();
    this.tokenBursts = this.tokenBursts.filter((burst) => now - burst.startedAt < 700);
    for (const burst of this.tokenBursts) {
      const projected = projectPoint(localPlayer, camera, burst.x + 0.5, burst.y + 0.5, this.width, this.height);
      if (!projected || projected.distance >= zBuffer[Math.round(clamp(projected.screenX, 0, this.width - 1))]) {
        continue;
      }
      const progress = (now - burst.startedAt) / 700;
      this.ctx.save();
      this.ctx.globalAlpha = 1 - progress;
      this.ctx.fillStyle = "#faf9f5";
      this.ctx.font = '10px "Press Start 2P"';
      this.ctx.fillText(burst.label || "+1", projected.screenX - 10, projected.screenY - progress * 20);
      this.ctx.restore();
    }
  }

  drawCrosshair() {
    const ctx = this.ctx;
    const cx = this.width / 2;
    const cy = this.height / 2 + 10;
    ctx.save();
    ctx.strokeStyle = "rgba(250, 249, 245, 0.38)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + 6);
    ctx.stroke();
    ctx.fillStyle = "rgba(217, 119, 87, 0.75)";
    ctx.fillRect(cx - 1, cy - 1, 2, 2);
    ctx.restore();
  }

  drawTutorialBubble(tutorialBubble) {
    if (!tutorialBubble?.visible || performance.now() > tutorialBubble.expiresAt) {
      return;
    }

    const ctx = this.ctx;
    const text = String(tutorialBubble.text || "").slice(0, 90);
    ctx.save();
    ctx.font = '8px "Press Start 2P"';
    const width = Math.min(this.width - 32, ctx.measureText(text).width + 24);
    const x = 16;
    const y = this.height - 74;
    roundRect(ctx, x, y, width, 42, 8);
    ctx.fillStyle = "rgba(20, 20, 19, 0.92)";
    ctx.fill();
    ctx.fillStyle = "#faf9f5";
    ctx.fillText(text, x + 12, y + 24);
    ctx.restore();
  }

  drawScreenFx() {
    const ctx = this.ctx;
    ctx.save();
    for (let y = 0; y < this.height; y += 3) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.018)";
      ctx.fillRect(0, y, this.width, 1);
    }

    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.width * 0.15,
      this.width / 2,
      this.height / 2,
      this.width * 0.72
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.34)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.restore();
  }
}

function buildCamera(angle) {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  const planeScale = Math.tan(FOV / 2);
  return {
    dirX,
    dirY,
    planeX: -dirY * planeScale,
    planeY: dirX * planeScale
  };
}

function projectPoint(player, camera, worldX, worldY, width, height) {
  const relX = worldX - player.x;
  const relY = worldY - player.y;
  const invDet = 1 / (camera.planeX * camera.dirY - camera.dirX * camera.planeY);
  const transformX = invDet * (camera.dirY * relX - camera.dirX * relY);
  const transformY = invDet * (-camera.planeY * relX + camera.planeX * relY);
  if (transformY <= 0.15) {
    return null;
  }
  return {
    screenX: (width / 2) * (1 + transformX / transformY),
    screenY: height / 2,
    distance: transformY
  };
}

function buildWallTextures() {
  const textures = new Map();
  textures.set(2, createTexture((ctx) => {
    ctx.fillStyle = "#1e2123";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#0f1113";
    for (let row = 0; row < 5; row += 1) {
      ctx.fillRect(8, 6 + row * 11, 48, 7);
    }
    ctx.fillStyle = "#6a9bcc";
    ctx.fillRect(14, 10, 4, 4);
    ctx.fillRect(34, 23, 4, 4);
    ctx.fillStyle = "#d97757";
    ctx.fillRect(26, 34, 4, 4);
    ctx.fillRect(44, 49, 4, 4);
  }));
  textures.set(3, createTexture((ctx) => {
    ctx.fillStyle = "#42566c";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#6a9bcc";
    ctx.beginPath();
    ctx.arc(32, 34, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d8e6f6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 34, 9, 0, Math.PI * 2);
    ctx.stroke();
  }));
  textures.set(4, createTexture((ctx) => {
    ctx.fillStyle = "#cfd0c8";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(217, 119, 87, 0.55)";
    ctx.lineWidth = 2;
    for (let y = 8; y < 60; y += 12) {
      for (let x = (y / 12) % 2 ? 8 : 14; x < 56; x += 12) {
        ctx.strokeRect(x, y, 8, 8);
      }
    }
  }));
  textures.set(5, createTexture((ctx) => {
    ctx.fillStyle = "#1b1a18";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#8fc78d";
    ctx.fillRect(8, 14, 36, 4);
    ctx.fillRect(8, 24, 24, 4);
    ctx.fillRect(8, 34, 30, 4);
    ctx.fillStyle = "#d97757";
    ctx.fillRect(10, 46, 12, 4);
  }));
  textures.set(7, createTexture((ctx) => {
    ctx.fillStyle = "#92928e";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#b6b7b0";
    for (let y = 6; y < 60; y += 10) {
      ctx.fillRect(0, y, 64, 2);
    }
    ctx.fillStyle = "#5b6368";
    ctx.fillRect(18, 18, 28, 18);
    ctx.fillStyle = "#d97757";
    ctx.fillRect(50, 10, 6, 6);
  }));
  textures.set(8, createTexture((ctx) => {
    ctx.fillStyle = "#cf734f";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#f0c2a4";
    ctx.fillRect(8, 6, 48, 52);
    ctx.fillStyle = "#cf734f";
    ctx.fillRect(12, 10, 40, 44);
    ctx.fillStyle = "#141413";
    ctx.fillRect(42, 28, 8, 10);
    ctx.fillRect(18, 18, 10, 8);
  }));
  textures.set(10, createTexture((ctx) => {
    ctx.fillStyle = "#56606b";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "#a6b0bc";
    ctx.lineWidth = 2;
    for (let y = 0; y < 64; y += 10) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(64, y + 10);
      ctx.stroke();
    }
    ctx.fillStyle = "#d97757";
    ctx.beginPath();
    ctx.arc(52, 10, 5, 0, Math.PI * 2);
    ctx.fill();
  }));
  return textures;
}

function buildTokenTexture() {
  return createTexture((ctx) => {
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = "#d97757";
    ctx.beginPath();
    ctx.arc(32, 32, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f5d0a8";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(32, 32, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#faf9f5";
    ctx.fillRect(30, 18, 4, 28);
    ctx.fillRect(22, 30, 20, 4);
  });
}

function buildTombstoneTexture() {
  return createTexture((ctx) => {
    ctx.fillStyle = "#78756e";
    ctx.beginPath();
    ctx.arc(32, 20, 16, Math.PI, 0);
    ctx.lineTo(48, 56);
    ctx.lineTo(16, 56);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#d9d7cf";
    ctx.fillRect(24, 26, 16, 4);
    ctx.fillRect(28, 36, 8, 4);
  });
}

function createTexture(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return canvas;
}

function getEntityTexture(entity) {
  if (entity.spriteSheet?.base) {
    return entity.spriteSheet.base;
  }
  if (entity.spriteSheet?.sheet) {
    return entity.spriteSheet.sheet;
  }
  return null;
}

function resolveTextureSource(sprite, now) {
  const defaultSource = {
    image: sprite.texture,
    sx: 0,
    sy: 0,
    sw: sprite.texture.width,
    sh: sprite.texture.height
  };

  const sheet = sprite.spriteSheet?.sheet;
  if (!sheet || sheet.width < 64 || sheet.height < 32) {
    return defaultSource;
  }

  const directionIndex = directionToIndex(sprite.direction);
  const movingFrame = sprite.kind === "entity" && sprite.isMoving ? (Math.floor(now / 180) % 2) : 0;
  return {
    image: sheet,
    sx: (directionIndex * 2 + movingFrame) * 32,
    sy: 0,
    sw: 32,
    sh: 32
  };
}

function getGhostVisibility(entity) {
  if (!entity.isGhost) {
    return 1;
  }
  if (!entity.ghostTransition) {
    return entity.isSleeping ? 0 : 1;
  }
  const progress = Math.min((performance.now() - entity.ghostTransition.startedAt) / entity.ghostTransition.durationMs, 1);
  return entity.ghostTransition.from + ((entity.ghostTransition.to - entity.ghostTransition.from) * progress);
}

function floorColorForTile(tile) {
  switch (tile) {
    case 0:
      return "#5f7351";
    case 1:
      return "#7d7a70";
    case 6:
      return "#758258";
    case 9:
      return "#625846";
    default:
      return "#56614a";
  }
}

function mixColor(a, b, weight) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  const mixed = [0, 1, 2].map((index) => Math.round(left[index] * (1 - weight) + right[index] * weight));
  return `rgb(${mixed[0]} ${mixed[1]} ${mixed[2]})`;
}

function hexToRgb(color) {
  const hex = color.replace("#", "");
  const normalized = hex.length === 3
    ? hex.split("").map((value) => value + value).join("")
    : hex;
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function roundRect(ctx, x, y, width, height, radius) {
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
  ctx.closePath();
}

function distanceSquared(x1, y1, x2, y2) {
  return ((x1 - x2) ** 2) + ((y1 - y2) ** 2);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function clampRange(start, end, min, max) {
  return {
    start: Math.max(min, start),
    end: Math.min(max, end)
  };
}

function directionToIndex(direction) {
  switch (direction) {
    case "left":
      return 1;
    case "right":
      return 2;
    case "up":
      return 3;
    case "down":
    default:
      return 0;
  }
}
