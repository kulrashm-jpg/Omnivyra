import IORedis from 'ioredis';

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
});
