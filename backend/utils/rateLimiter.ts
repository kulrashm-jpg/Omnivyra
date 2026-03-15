/**
 * Rate limiter for platform API requests.
 * Tracks requests per minute per platform.
 */

const LIMITS: Record<string, number> = {
  linkedin: 60,
  twitter: 75,
  x: 75,
  discord: 120,
  slack: 120,
  reddit: 60,
  github: 60,
  default: 60,
};

const windowMs = 60 * 1000;
const counts = new Map<string, { count: number; resetAt: number }>();

function getKey(platform: string): string {
  return String(platform || 'default').toLowerCase();
}

export function getLimitForPlatform(platform: string): number {
  const key = getKey(platform);
  return LIMITS[key] ?? LIMITS.default;
}

export async function checkRateLimit(platform: string): Promise<boolean> {
  const key = getKey(platform);
  const limit = getLimitForPlatform(platform);
  const now = Date.now();
  let entry = counts.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    counts.set(key, entry);
  }

  if (entry.count >= limit) {
    return false;
  }
  entry.count += 1;
  return true;
}

export async function withRateLimit<T>(
  platform: string,
  fn: () => Promise<T>
): Promise<T> {
  const ok = await checkRateLimit(platform);
  if (!ok) {
    throw new Error(`Rate limit exceeded for ${platform}`);
  }
  return fn();
}
