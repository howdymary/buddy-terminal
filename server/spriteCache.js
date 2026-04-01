import crypto from "node:crypto";

export class SpriteCache {
  constructor() {
    this.sprites = new Map();
  }

  register(buffer, mimeType = "image/png", extra = {}, forcedHash = null) {
    const hash = forcedHash ?? crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    this.sprites.set(hash, {
      buffer,
      mimeType,
      createdAt: Date.now(),
      ...extra
    });
    return hash;
  }

  get(hash) {
    return this.sprites.get(hash) ?? null;
  }
}
