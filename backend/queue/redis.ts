import IORedis from 'ioredis';
import { REDIS_URL } from '../config/env';

function parseUrl(url: string) {
  // Strip any accidental redis-cli command prefix (e.g. "redis-cli --tls -u redis://...")
  const match = url.match(/rediss?:\/\/\S+/);
  if (match) url = match[0];
  try {
    const u = new URL(url);
    const needsTls = u.hostname.includes('upstash.io') || u.protocol === 'rediss:';
    return {
      host:     u.hostname,
      port:     parseInt(u.port || '6379'),
      password: u.password || undefined,
      tls:      needsTls ? {} : undefined,
    };
  } catch {
    throw new Error('REDIS_URL_INVALID');
  }
}

const cfg = parseUrl(REDIS_URL);

export const redis = new IORedis({
  host:             cfg.host,
  port:             cfg.port,
  password:         cfg.password,
  tls:              cfg.tls,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});

// Suppress unhandled error events (e.g. Upstash rate-limit errors).
// BullMQ handles connection errors internally; without this listener Node.js
// would throw an uncaught exception for every rejected Redis command.
redis.on('error', (err: Error) => {
  console.warn('[redis] error:', err.message);
});
