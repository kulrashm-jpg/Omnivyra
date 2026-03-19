import IORedis from 'ioredis';

function parseUrl(url: string) {
  try {
    const u = new URL(url);
    return { host: u.hostname, port: parseInt(u.port || '6379'), password: u.password || undefined };
  } catch {
    return { host: 'localhost', port: 6379, password: undefined };
  }
}

const cfg = parseUrl(process.env.REDIS_URL || 'redis://localhost:6379');

export const redis = new IORedis({
  host: cfg.host,
  port: cfg.port,
  password: cfg.password,
  enableReadyCheck: false,
  maxRetriesPerRequest: null,
});
