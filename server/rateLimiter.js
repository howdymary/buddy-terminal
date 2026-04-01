export class SlidingWindowRateLimiter {
  constructor(limit, intervalMs, cooldownMs = 0) {
    this.limit = limit;
    this.intervalMs = intervalMs;
    this.cooldownMs = cooldownMs;
    this.events = [];
    this.cooldownUntil = 0;
  }

  allow(now = Date.now()) {
    if (now < this.cooldownUntil) {
      return {
        ok: false,
        cooldownRemainingMs: this.cooldownUntil - now
      };
    }

    this.events = this.events.filter((timestamp) => now - timestamp < this.intervalMs);
    if (this.events.length >= this.limit) {
      if (this.cooldownMs > 0) {
        this.cooldownUntil = now + this.cooldownMs;
        this.events = [];
      }

      return {
        ok: false,
        cooldownRemainingMs: this.cooldownUntil > now ? this.cooldownUntil - now : 0
      };
    }

    this.events.push(now);
    return { ok: true, cooldownRemainingMs: 0 };
  }
}

export function createPlayerRateLimits() {
  return {
    moves: new SlidingWindowRateLimiter(20, 1000),
    chat: new SlidingWindowRateLimiter(5, 10_000, 30_000),
    emote: new SlidingWindowRateLimiter(3, 5000, 10_000)
  };
}
