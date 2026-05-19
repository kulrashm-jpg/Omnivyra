import IORedis from 'ioredis';
import { isRedisUrlTLS } from '../../lib/redis/sanitizer';

function parseUrl(url: string) {
  // Strip any accidental redis-cli command prefix (e.g. "redis-cli --tls -u redis://...")
  const match = url.match(/rediss?:\/\/\S+/);
  if (match) url = match[0];
  try {
    const u = new URL(url);
    // TLS decision is centralized in sanitizer.isRedisUrlTLS (single authority)
    const needsTls = isRedisUrlTLS(url);
    return {
      host:     u.hostname,
      port:     parseInt(u.port || '6379'),
      password: u.password || undefined,
      tls:      needsTls ? {} : undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379, password: undefined, tls: undefined };
  }
}

const cfg = parseUrl(process.env.REDIS_URL || 'redis://localhost:6379');

export const redis = new IORedis({
  host:             cfg.host,
  port:             cfg.port,
  password:         cfg.password,
  tls:              cfg.tls,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
  // Lazy: do not open a socket at module-import time.
  lazyConnect:      true,
  // Bounded connect/command behavior (non-blocking standalone client).
  connectTimeout:   10_000,
  commandTimeout:   10_000,
});

// Suppress unhandled error events (e.g. Upstash rate-limit errors).
// BullMQ handles connection errors internally; without this listener Node.js
// would throw an uncaught exception for every rejected Redis command.
redis.on('error', (err: Error) => {
  console.warn('[redis] error:', err.message);
});
