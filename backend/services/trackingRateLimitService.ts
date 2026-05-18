type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function checkInMemoryRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterMs: current.resetAt - now };
  }
  current.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function isLikelyBot(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return /bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|headless/i.test(userAgent);
}
