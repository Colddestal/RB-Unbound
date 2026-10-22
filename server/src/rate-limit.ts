export type LimitRule = {
  capacity: number;
  refillPerSecond: number;
};

type Bucket = {
  tokens: number;
  updatedAt: number;
};

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  allow(key: string, rule: LimitRule, now = Date.now()): boolean {
    const existing = this.buckets.get(key) ?? { tokens: rule.capacity, updatedAt: now };
    const elapsedSeconds = Math.max(0, now - existing.updatedAt) / 1000;
    const tokens = Math.min(rule.capacity, existing.tokens + elapsedSeconds * rule.refillPerSecond);

    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return false;
    }

    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  clearPrefix(prefix: string): void {
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) this.buckets.delete(key);
    }
  }
}

export function approximatePayloadBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
