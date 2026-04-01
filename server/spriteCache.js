import crypto from "node:crypto";

const MAX_CACHE_SIZE = 200;

export class SpriteCache {
  constructor() {
    this.sprites = new Map();
  }

  register(buffer, mimeType = "image/png", extra = {}, forcedHash = null) {
    const hash = forcedHash ?? crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    if (this.sprites.has(hash)) {
      this.sprites.delete(hash);
    } else if (this.sprites.size >= MAX_CACHE_SIZE) {
      const oldestKey = this.sprites.keys().next().value;
      if (oldestKey) {
        this.sprites.delete(oldestKey);
      }
    }

    this.sprites.set(hash, {
      buffer,
      mimeType,
      createdAt: Date.now(),
      ...extra
    });
    return hash;
  }

  get(hash) {
    const entry = this.sprites.get(hash) ?? null;
    if (!entry) {
      return null;
    }

    this.sprites.delete(hash);
    this.sprites.set(hash, entry);
    return entry;
  }
}
