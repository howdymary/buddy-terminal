export class ClientSpriteCache {
  constructor() {
    this.cache = new Map();
  }

  prime(key, spriteSheet) {
    this.cache.set(key, Promise.resolve(spriteSheet));
  }

  getOrCreate(key, loader) {
    if (!this.cache.has(key)) {
      this.cache.set(key, loader());
    }

    return this.cache.get(key);
  }
}
