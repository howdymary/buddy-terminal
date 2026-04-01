import sharp from "sharp";

const MAGIC_BYTES = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  gif: Buffer.from([0x47, 0x49, 0x46])
};

const SPECIES = [
  "ghost",
  "ferret",
  "dragon",
  "penguin",
  "fox",
  "otter",
  "moth",
  "salamander",
  "badger",
  "cat",
  "owl",
  "slime"
];

const RARITIES = [
  { key: "legendary", stars: 5, label: "Legendary" },
  { key: "epic", stars: 4, label: "Epic" },
  { key: "rare", stars: 3, label: "Rare" },
  { key: "uncommon", stars: 2, label: "Uncommon" },
  { key: "common", stars: 1, label: "Common" }
];

const STAT_KEYS = ["debugging", "patience", "chaos", "wisdom", "snark"];
const MAX_CONCURRENT_OCR = 2;
const DEFAULT_BUDDY_COLOR = "#79c4a0";

let activeOcrCount = 0;

export async function parseBuddyCard(buffer) {
  if (!validateMagicBytes(buffer)) {
    throw new Error("Only valid PNG, JPG, or GIF uploads are supported.");
  }

  const image = sharp(buffer, { animated: false }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width > 4096 || height > 4096) {
    throw new Error("Image dimensions exceed 4096×4096 limit");
  }

  if (width < 100 || height < 100) {
    throw new Error("That doesn't look like a /buddy screenshot. Try taking a full screenshot of your buddy card!");
  }

  const stats = await image.stats();
  const isDarkCard = stats.channels.slice(0, 3).every((channel) => channel.mean < 120);
  const looksCardLike = isDarkCard && height >= width * 0.9;
  const fallbackCrop = fallbackCropRegion({ width, height, looksCardLike });

  let cropRegion = fallbackCrop;
  try {
    cropRegion = await detectAsciiRegion(image.clone(), { width, height, looksCardLike });
  } catch (error) {
    console.warn("ASCII region detection failed, using fallback crop:", error.message);
  }

  let dominantColor = DEFAULT_BUDDY_COLOR;
  try {
    dominantColor = await extractDominantColor(image.clone(), cropRegion, { width, height });
  } catch (error) {
    console.warn("Dominant color extraction failed, retrying with fallback crop:", error.message);
    try {
      dominantColor = await extractDominantColor(image.clone(), fallbackCrop, { width, height });
      cropRegion = fallbackCrop;
    } catch {
      dominantColor = DEFAULT_BUDDY_COLOR;
    }
  }

  const ocrText = looksCardLike ? await extractText(buffer) : "";
  const buddyMeta = inferBuddyMeta(ocrText, dominantColor, looksCardLike);

  return {
    looksCardLike,
    cropRegion,
    buddyMeta
  };
}

async function detectAsciiRegion(image, { width, height, looksCardLike }) {
  if (!looksCardLike) {
    return { left: 0, top: 0, width, height };
  }

  const focus = {
    left: Math.max(0, Math.floor(width * 0.05)),
    top: Math.max(0, Math.floor(height * 0.10)),
    width: Math.max(72, Math.floor(width * 0.41)),
    height: Math.max(72, Math.floor(height * 0.31))
  };
  focus.width = Math.min(focus.width, width - focus.left);
  focus.height = Math.min(focus.height, height - focus.top);

  const scan = await image
    .extract(focus)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let minX = focus.width;
  let maxX = 0;
  let minY = focus.height;
  let maxY = 0;
  let accentCount = 0;

  for (let y = 0; y < focus.height; y += 1) {
    for (let x = 0; x < focus.width; x += 1) {
      const index = (y * focus.width + x) * 3;
      const r = scan.data[index];
      const g = scan.data[index + 1];
      const b = scan.data[index + 2];
      if (!isAsciiForegroundPixel(r, g, b)) {
        continue;
      }

      accentCount += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (accentCount < 60 || maxX <= minX || maxY <= minY) {
    return fallbackCropRegion({ width, height, looksCardLike });
  }

  return clampCropRegion({
    left: focus.left + minX - 12,
    top: focus.top + minY - 12,
    width: (maxX - minX) + 25,
    height: (maxY - minY) + 25
  }, width, height);
}

async function extractDominantColor(image, cropRegion, { width, height }) {
  const safeCrop = clampCropRegion(cropRegion, width, height);
  const { data } = await image
    .extract(safeCrop)
    .removeAlpha()
    .resize(24, 24, { fit: "cover", kernel: sharp.kernel.nearest })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bestScore = -1;
  let bestColor = { r: 121, g: 196, b: 160 };

  for (let index = 0; index < data.length; index += 3) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    const score = saturation * 2 + brightness;

    if (brightness > 25 && score > bestScore) {
      bestScore = score;
      bestColor = { r, g, b };
    }
  }

  return `#${[bestColor.r, bestColor.g, bestColor.b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function extractText(buffer) {
  if (activeOcrCount >= MAX_CONCURRENT_OCR) {
    console.warn("OCR queue full, skipping");
    return "";
  }

  let worker = null;
  activeOcrCount += 1;

  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng");
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("OCR timeout")), 5000);
    });
    const result = await Promise.race([
      worker.recognize(buffer, {}, { blocks: false }),
      timeout
    ]);
    return result.data?.text ?? "";
  } catch (error) {
    console.warn("OCR failed or timed out:", error.message);
    return "";
  } finally {
    activeOcrCount -= 1;
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Ignore worker shutdown failures during OCR fallback.
      }
    }
  }
}

function inferBuddyMeta(ocrText, dominantColor, looksCardLike) {
  const text = (ocrText || "").replace(/\r/g, "");
  const normalized = text.toLowerCase();
  const rarity = inferRarity(normalized);
  const species = inferSpecies(normalized);
  const buddyName = inferName(text, normalized);
  const stats = inferStats(normalized);

  return {
    buddyName: buddyName ?? "Buddy",
    rarity: looksCardLike ? rarity.key : "common",
    rarityStars: looksCardLike ? rarity.stars : 1,
    rarityLabel: looksCardLike ? rarity.label : "Common",
    species: looksCardLike ? species : "terminal friend",
    dominantColor,
    stats
  };
}

function inferRarity(text) {
  const starCount = (text.match(/★/g) || []).length;
  if (starCount >= 5 || text.includes("legendary")) {
    return RARITIES[0];
  }
  if (starCount === 4 || text.includes("epic")) {
    return RARITIES[1];
  }
  if (starCount === 3 || /\brare\b/.test(text)) {
    return RARITIES[2];
  }
  if (starCount === 2 || text.includes("uncommon")) {
    return RARITIES[3];
  }
  return RARITIES[4];
}

function inferSpecies(text) {
  for (const species of SPECIES) {
    if (text.includes(species)) {
      return species;
    }
  }
  return "terminal friend";
}

function inferName(original, normalized) {
  const lines = original
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = lines
    .map((line) => {
      const lower = line.toLowerCase();
      const cleaned = line.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, " ").trim();
      const alphaCount = (cleaned.match(/[a-z]/gi) || []).length;
      if (
        cleaned.length < 3 ||
        cleaned.length > 18 ||
        alphaCount < 3 ||
        lower.includes("debugging") ||
        lower.includes("patience") ||
        lower.includes("chaos") ||
        lower.includes("wisdom") ||
        lower.includes("snark") ||
        lower.includes("legendary") ||
        lower.includes("epic") ||
        lower.includes("rare") ||
        lower.includes("common") ||
        SPECIES.some((species) => lower.includes(species))
      ) {
        return null;
      }

      const punctuationPenalty = /[^a-zA-Z0-9 _-]/.test(line) ? 6 : 0;
      const titleBonus = /^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/.test(cleaned) ? 6 : 0;
      const compactBonus = cleaned.includes(" ") ? 0 : 2;
      return {
        cleaned,
        score: alphaCount + titleBonus + compactBonus - punctuationPenalty
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  if (candidates[0]) {
    return candidates[0].cleaned.slice(0, 18);
  }

  if (normalized.includes("buddy")) {
    return "Buddy";
  }

  return null;
}

function inferStats(text) {
  const stats = {};
  for (const key of STAT_KEYS) {
    const match = text.match(new RegExp(`${key}\\D{0,12}(\\d{1,3})`, "i"));
    const parsedValue = match ? clamp(Number.parseInt(match[1], 10), 0, 99) : null;
    stats[key] = parsedValue != null && parsedValue >= 10 ? parsedValue : fallbackStat(key);
  }
  return stats;
}

function fallbackCropRegion({ width, height, looksCardLike }) {
  if (!looksCardLike) {
    return { left: 0, top: 0, width, height };
  }

  return clampCropRegion({
    left: Math.floor(width * 0.10),
    top: Math.floor(height * 0.12),
    width: Math.floor(width * 0.28),
    height: Math.floor(height * 0.22)
  }, width, height);
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

function isAsciiForegroundPixel(r, g, b) {
  const brightness = r + g + b;
  const saturation = Math.max(r, g, b) - Math.min(r, g, b);
  const greenDominance = g - Math.max(r, b);
  return brightness > 150 && (greenDominance > 8 || saturation > 28);
}

function validateMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  return (
    buffer.subarray(0, 4).equals(MAGIC_BYTES.png) ||
    buffer.subarray(0, 3).equals(MAGIC_BYTES.jpeg) ||
    buffer.subarray(0, 3).equals(MAGIC_BYTES.gif)
  );
}

function fallbackStat(key) {
  const defaults = {
    debugging: 42,
    patience: 51,
    chaos: 24,
    wisdom: 63,
    snark: 37
  };
  return defaults[key] ?? 40;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
