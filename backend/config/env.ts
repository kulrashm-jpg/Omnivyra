import { normalizeRedisUrl } from '../../lib/redis/sanitizer';

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  throw new Error('REDIS_URL_MISSING');
}

export const REDIS_URL = normalizeRedisUrl(redisUrl);

export function extractHost(url: string): string {
  return new URL(url).hostname;
}

console.log('REDIS_RUNTIME_HOST:', extractHost(REDIS_URL));
