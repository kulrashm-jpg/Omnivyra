/**
 * Platform Rate Limit Service
 *
 * In-memory rate limit protection per platform.
 * Throws RateLimitExceededError when limit exceeded.
 */

export class RateLimitExceededError extends Error {
  constructor(
    public readonly platformKey: string,
    public readonly limit: number,
    public readonly windowMinutes: number
  ) {
    super(`Rate limit exceeded for ${platformKey}: ${limit} calls per ${windowMinutes} min`);
    this.name = 'RateLimitExceededError';
  }
}

type LimitConfig = {
  limit: number;
  windowMinutes: number;
};

const RATE_LIMITS: Record<string, LimitConfig> = {
  linkedin: { limit: 100, windowMinutes: 1 },
  twitter: { limit: 900, windowMinutes: 15 },
  youtube: { limit: 10000, windowMinutes: 1 }, // quota-based; use generous default
  reddit: { limit: 60, windowMinutes: 1 },
  facebook: { limit: 200, windowMinutes: 1 },
  instagram: { limit: 200, windowMinutes: 1 },
  tiktok: { limit: 100, windowMinutes: 1 },
  whatsapp: { limit: 80, windowMinutes: 1 },
  pinterest: { limit: 200, windowMinutes: 1 },
  quora: { limit: 60, windowMinutes: 1 },
  slack: { limit: 100, windowMinutes: 1 },
  discord: { limit: 50, windowMinutes: 1 },
  github: { limit: 5000, windowMinutes: 1 },
  stackoverflow: { limit: 300, windowMinutes: 1 },
  producthunt: { limit: 60, windowMinutes: 1 },
  hackernews: { limit: 30, windowMinutes: 1 },
};

type WindowState = {
  windowStart: number;
  requestCount: number;
};

const rateLimitMap = new Map<string, WindowState>();

/**
 * Check rate limit for a platform. Increments counter and throws if exceeded.
 */
export function checkRateLimit(platformKey: string): void {
  const key = (platformKey || '').toString().trim().toLowerCase();
  if (!key) return;

  const config = RATE_LIMITS[key] ?? { limit: 100, windowMinutes: 1 };
  const now = Date.now();
  const windowMs = config.windowMinutes * 60 * 1000;

  let state = rateLimitMap.get(key);
  if (!state || now - state.windowStart >= windowMs) {
    state = { windowStart: now, requestCount: 0 };
    rateLimitMap.set(key, state);
  }

  state.requestCount += 1;
  if (state.requestCount > config.limit) {
    throw new RateLimitExceededError(key, config.limit, config.windowMinutes);
  }
}
