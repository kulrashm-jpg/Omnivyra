import IORedis from 'ioredis';
import type { RedisOptions } from 'ioredis';
import { createInstrumentedClient, type RedisFeature } from '../../lib/redis/instrumentation';
import { isRedisUrlTLS } from '../../lib/redis/sanitizer';
import {
  circuitBreakerRetryStrategy,
  isNonRecoverableRedisError,
  reconnectOnError,
} from '../../lib/redis/retryPolicy';

type Feature = RedisFeature | string;

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 1_500;
const AUTH_FAILURE_LIMIT = 2;

let sharedClient: IORedis | null = null;
let authFailures = 0;
const instrumentedClients = new Map<string, IORedis>();

function parseRedisUrl(url: string): RedisOptions {
  const match = url.match(/rediss?:\/\/\S+/);
  if (match) url = match[0];

  try {
    const parsed = new URL(url);
    const needsTls = isRedisUrlTLS(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password: parsed.password || undefined,
      tls: needsTls ? {} : undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

function createStandaloneClient(): IORedis {
  const base = parseRedisUrl(process.env.REDIS_URL || DEFAULT_REDIS_URL);
  const client = new IORedis({
    ...base,
    enableReadyCheck: false,
    maxRetriesPerRequest: 1,
    connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
    commandTimeout: DEFAULT_COMMAND_TIMEOUT_MS,
    lazyConnect: true,
    retryStrategy: circuitBreakerRetryStrategy,
    reconnectOnError,
  });

  client.on('connect', () => {
    authFailures = 0;
  });

  client.on('error', (err) => {
    if (!isNonRecoverableRedisError(err)) return;
    authFailures += 1;
    if (authFailures >= AUTH_FAILURE_LIMIT) {
      console.error('[redis][standalone] non-recoverable auth/config error; disconnecting shared standalone client');
      client.disconnect(false);
    }
  });

  client.connect().catch(() => {
    // Callers all fail open; suppress connect noise on optional Redis paths.
  });

  return client;
}

export function getSharedStandaloneRedisClient(): IORedis {
  if (sharedClient && sharedClient.status !== 'end') return sharedClient;

  if (sharedClient?.status === 'end') {
    try {
      sharedClient.disconnect(false);
    } catch {
      // Ignore stale disconnect errors.
    }
  }

  sharedClient = createStandaloneClient();
  instrumentedClients.clear();
  return sharedClient;
}

export function getInstrumentedStandaloneRedisClient(feature: Feature): IORedis {
  const key = String(feature);
  const existing = instrumentedClients.get(key);
  if (existing && sharedClient && sharedClient.status !== 'end') return existing;

  const instrumented = createInstrumentedClient(getSharedStandaloneRedisClient(), key) as IORedis;
  instrumentedClients.set(key, instrumented);
  return instrumented;
}

export function isSharedStandaloneRedisAvailable(): boolean {
  return sharedClient?.status === 'ready';
}

export function shutdownSharedStandaloneRedisClient(): void {
  if (!sharedClient) return;
  sharedClient.quit().catch(() => {});
  sharedClient = null;
  instrumentedClients.clear();
  authFailures = 0;
}
