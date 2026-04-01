import sharp from "sharp";

export async function generateBuddySpriteSheet({ sourceBuffer, cropRegion, dominantColor }) {
  const source = sharp(sourceBuffer, { animated: false }).rotate();
  const metadata = await source.metadata();
  const safeCrop = clampCropRegion(cropRegion, metadata.width ?? 32, metadata.height ?? 32);

  const baseSprite = await source
    .extract(safeCrop)
    .resize(32, 32, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: sharp.kernel.nearest
    })
    .png({
      palette: true,
      colors: 16,
      compressionLevel: 9
    })
    .toBuffer();

  const glow = hexToRgb(dominantColor ?? "#79c4a0");
  const frames = await Promise.all([
    createFrame(baseSprite, "down", 0, glow),
    createFrame(baseSprite, "down", 1, glow),
    createFrame(baseSprite, "left", 0, glow),
    createFrame(baseSprite, "left", 1, glow),
    createFrame(baseSprite, "right", 0, glow),
    createFrame(baseSprite, "right", 1, glow),
    createFrame(baseSprite, "up", 0, glow),
    createFrame(baseSprite, "up", 1, glow)
  ]);

  const sheet = sharp({
    create: {
      width: 32 * 8,
      height: 32,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  });

  const composites = frames.map((buffer, index) => ({
    input: buffer,
    left: index * 32,
    top: 0
  }));

  const spriteSheet = await sheet
    .composite(composites)
    .png({
      palette: true,
      colors: 16,
      compressionLevel: 9
    })
    .toBuffer();

  return {
    spriteSheet,
    preview: baseSprite
  };
}

async function createFrame(baseSprite, direction, frame, glow) {
  let sprite = sharp(baseSprite, { animated: false });

  if (direction === "right") {
    sprite = sprite.flop();
  }

  const overlays = [];
  const offsetX = direction === "left"
    ? (frame === 0 ? 0 : 1)
    : direction === "right"
      ? (frame === 0 ? 1 : 0)
      : 0;
  const offsetY = frame === 0 ? 0 : 1;
  const spriteBuffer = await sprite.png().toBuffer();

  if (direction === "up") {
    overlays.push({
      input: Buffer.from(
        `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
          <rect x="7" y="2" width="18" height="9" rx="4" fill="rgba(9,17,13,0.22)" />
        </svg>`
      )
    });
  }

  if (direction === "down") {
    overlays.push({
      input: Buffer.from(
        `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
          <rect x="9" y="19" width="14" height="7" rx="3" fill="rgba(239,243,220,0.14)" />
        </svg>`
      )
    });
  }

  overlays.push({
    input: Buffer.from(
      `<svg width="32" height="32" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="16" cy="28" rx="8" ry="2" fill="rgba(${glow.r}, ${glow.g}, ${glow.b}, 0.18)" />
      </svg>`
    )
  });

  return sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      ...overlays,
      {
        input: spriteBuffer,
        left: offsetX,
        top: offsetY
      }
    ])
    .png()
    .toBuffer();
}

function hexToRgb(hex) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized;

  const int = Number.parseInt(value, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function clampCropRegion(cropRegion, width, height) {
  const left = Math.max(0, Math.min(Math.floor(cropRegion?.left ?? 0), Math.max(0, width - 1)));
  const top = Math.max(0, Math.min(Math.floor(cropRegion?.top ?? 0), Math.max(0, height - 1)));
  const clampedWidth = Math.max(1, Math.min(Math.floor(cropRegion?.width ?? width), width - left));
  const clampedHeight = Math.max(1, Math.min(Math.floor(cropRegion?.height ?? height), height - top));

  return {
    left,
    top,
    width: clampedWidth,
    height: clampedHeight
  };
}
