import { performance } from "node:perf_hooks";

const now = () => performance.now();

export class SlidingWindowRateLimiter {
  constructor(limit, intervalMs, cooldownMs = 0) {
    this.limit = limit;
    this.intervalMs = intervalMs;
    this.cooldownMs = cooldownMs;
    this.events = [];
    this.cooldownUntil = 0;
  }

  allow(currentTime = now()) {
    if (currentTime < this.cooldownUntil) {
      return {
        ok: false,
        cooldownRemainingMs: this.cooldownUntil - currentTime
      };
    }

    this.events = this.events.filter((timestamp) => currentTime - timestamp < this.intervalMs);
    if (this.events.length >= this.limit) {
      if (this.cooldownMs > 0) {
        this.cooldownUntil = currentTime + this.cooldownMs;
        this.events = [];
      }

      return {
        ok: false,
        cooldownRemainingMs: this.cooldownUntil > currentTime ? this.cooldownUntil - currentTime : 0
      };
    }

    this.events.push(currentTime);
    return { ok: true, cooldownRemainingMs: 0 };
  }
}

export function createPlayerRateLimits() {
  return {
    moves: new SlidingWindowRateLimiter(60, 1000),
    chat: new SlidingWindowRateLimiter(5, 10_000, 30_000),
    emote: new SlidingWindowRateLimiter(3, 5000, 10_000)
  };
}
