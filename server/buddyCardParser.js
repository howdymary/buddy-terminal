import sharp from "sharp";

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

export async function parseBuddyCard(buffer) {
  const image = sharp(buffer, { animated: false }).rotate();
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < 100 || height < 100) {
    throw new Error("That doesn't look like a /buddy screenshot. Try taking a full screenshot of your buddy card!");
  }

  const stats = await image.stats();
  const isDarkCard = stats.channels.slice(0, 3).every((channel) => channel.mean < 120);
  const looksCardLike = isDarkCard && height >= width * 0.9;
  const cropRegion = await detectAsciiRegion(image, { width, height, looksCardLike });
  const dominantColor = await extractDominantColor(image, cropRegion);
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

  const scanWidth = Math.max(48, Math.floor(width * 0.82));
  const left = Math.floor((width - scanWidth) / 2);
  const top = Math.floor(height * 0.12);
  const scanHeight = Math.floor(height * 0.36);

  const grayscale = await image
    .extract({ left, top, width: scanWidth, height: scanHeight })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let bestStart = 0;
  let bestEnd = scanHeight - 1;
  let currentStart = 0;
  let inDenseRun = false;
  let bestScore = -1;

  for (let row = 0; row < scanHeight; row += 1) {
    let brightPixels = 0;
    for (let col = 0; col < scanWidth; col += 1) {
      const value = grayscale.data[row * scanWidth + col];
      if (value > 72) {
        brightPixels += 1;
      }
    }

    const density = brightPixels / scanWidth;
    const isDense = density > 0.1;

    if (isDense && !inDenseRun) {
      currentStart = row;
      inDenseRun = true;
    }

    if ((!isDense || row === scanHeight - 1) && inDenseRun) {
      const end = isDense && row === scanHeight - 1 ? row : row - 1;
      const score = end - currentStart;
      if (score > bestScore) {
        bestScore = score;
        bestStart = currentStart;
        bestEnd = end;
      }
      inDenseRun = false;
    }
  }

  const paddedTop = Math.max(top + bestStart - 8, 0);
  const paddedHeight = Math.min(bestEnd - bestStart + 24, height - paddedTop);
  return {
    left: Math.max(left - 6, 0),
    top: paddedTop,
    width: Math.min(scanWidth + 12, width - Math.max(left - 6, 0)),
    height: Math.max(32, paddedHeight)
  };
}

async function extractDominantColor(image, cropRegion) {
  const { data } = await image
    .extract(cropRegion)
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
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    const result = await worker.recognize(buffer, {}, { blocks: false });
    await worker.terminate();
    return result.data?.text ?? "";
  } catch (error) {
    console.warn("buddy OCR unavailable, falling back to common metadata", error.message);
    return "";
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

  const candidate = lines.find((line) => {
    const lower = line.toLowerCase();
    return (
      lower.length >= 3 &&
      lower.length <= 18 &&
      !lower.includes("debugging") &&
      !lower.includes("patience") &&
      !lower.includes("chaos") &&
      !lower.includes("wisdom") &&
      !lower.includes("snark") &&
      !lower.includes("legendary") &&
      !lower.includes("epic") &&
      !lower.includes("rare") &&
      !lower.includes("common") &&
      !SPECIES.some((species) => lower.includes(species))
    );
  });

  if (candidate) {
    return candidate.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 18);
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
    stats[key] = match ? clamp(Number.parseInt(match[1], 10), 0, 99) : fallbackStat(key);
  }
  return stats;
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
