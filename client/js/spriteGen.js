export const SPRITE_SIZE = 32;
export const DIRECTIONS = ["down", "left", "right", "up"];

const PALETTE = [
  [22, 30, 24, 0],
  [22, 30, 24, 255],
  [46, 65, 52, 255],
  [74, 102, 78, 255],
  [108, 145, 115, 255],
  [145, 186, 147, 255],
  [191, 216, 180, 255],
  [239, 243, 220, 255],
  [112, 78, 54, 255],
  [155, 108, 77, 255],
  [201, 152, 103, 255],
  [240, 205, 144, 255],
  [88, 120, 171, 255],
  [132, 170, 212, 255],
  [179, 98, 117, 255],
  [227, 157, 179, 255]
];

export async function loadImageFromFile(file) {
  const dataUrl = await readFileAsDataUrl(file);
  return loadImage(dataUrl);
}

export function loadImageFromUrl(url) {
  return loadImage(url);
}

export function buildSpriteSheetFromImage(image) {
  const baseCanvas = rasterizeToPixelCanvas(image);
  const spriteSheet = document.createElement("canvas");
  spriteSheet.width = SPRITE_SIZE * DIRECTIONS.length * 2;
  spriteSheet.height = SPRITE_SIZE;
  const ctx = spriteSheet.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  DIRECTIONS.forEach((direction, directionIndex) => {
    for (let frame = 0; frame < 2; frame += 1) {
      drawDirectionFrame(ctx, baseCanvas, direction, frame, (directionIndex * 2 + frame) * SPRITE_SIZE, 0);
    }
  });

  return {
    sheet: spriteSheet,
    base: baseCanvas
  };
}

export async function buildSpriteSheetFromFile(file) {
  const image = await loadImageFromFile(file);
  return buildSpriteSheetFromImage(image);
}

export async function buildSpriteSheetFromUrl(url) {
  const image = await loadImageFromUrl(url);
  return buildSpriteSheetFromImage(image);
}

export async function loadSpriteSheetAsset(url) {
  const image = await loadImageFromUrl(url);
  return {
    sheet: image,
    base: image
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function rasterizeToPixelCanvas(image) {
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = SPRITE_SIZE;
  sourceCanvas.height = SPRITE_SIZE;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceCtx.imageSmoothingEnabled = false;
  sourceCtx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  sourceCtx.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);

  const imageData = sourceCtx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const pixels = imageData.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha < 24) {
      pixels[i + 3] = 0;
      continue;
    }

    const nearest = nearestPaletteColor(pixels[i], pixels[i + 1], pixels[i + 2], alpha);
    pixels[i] = nearest[0];
    pixels[i + 1] = nearest[1];
    pixels[i + 2] = nearest[2];
    pixels[i + 3] = nearest[3];
  }

  sourceCtx.putImageData(imageData, 0, 0);

  return sourceCanvas;
}

function nearestPaletteColor(r, g, b, a) {
  let best = PALETTE[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const color of PALETTE) {
    const distance =
      (color[0] - r) ** 2 +
      (color[1] - g) ** 2 +
      (color[2] - b) ** 2 +
      (color[3] - a) ** 2;

    if (distance < bestDistance) {
      best = color;
      bestDistance = distance;
    }
  }

  return best;
}

function drawDirectionFrame(ctx, baseCanvas, direction, frame, dx, dy) {
  ctx.save();

  const bounceY = frame === 0 ? 0 : -1;
  const swingX = frame === 0 ? -1 : 1;

  ctx.fillStyle = "rgba(0, 0, 0, 0.16)";
  ctx.fillRect(dx + 8, dy + 26, 16, 4);

  if (direction === "right") {
    ctx.translate(dx + SPRITE_SIZE, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(baseCanvas, swingX, bounceY);
  } else {
    ctx.translate(dx, dy);
    ctx.drawImage(baseCanvas, direction === "left" ? swingX : 0, bounceY);
  }

  if (direction === "up") {
    ctx.fillStyle = "rgba(9, 17, 13, 0.22)";
    ctx.fillRect(dx + 9, dy + 2, 14, 8);
  }

  if (direction === "down") {
    ctx.fillStyle = "rgba(239, 243, 220, 0.18)";
    ctx.fillRect(dx + 10, dy + 19, 12, 7);
  }

  ctx.restore();
}

export function drawSpriteFrame(ctx, spriteSheet, direction, frame, x, y, scale = 1) {
  const directionIndex = DIRECTIONS.indexOf(direction);
  const sheetIndex = Math.max(directionIndex, 0) * 2 + (frame % 2);
  ctx.drawImage(
    spriteSheet,
    sheetIndex * SPRITE_SIZE,
    0,
    SPRITE_SIZE,
    SPRITE_SIZE,
    x,
    y,
    SPRITE_SIZE * scale,
    SPRITE_SIZE * scale
  );
}
