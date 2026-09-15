/**
 * SEC-C2 (STEP 3AH-91) — a non-production process cannot consume or produce
 * on the production BullMQ keyspace; production keeps `bull` byte-for-byte.
 *
 * Pins:
 *   1. Every production shape (Railway worker, Vercel web, production-mode
 *      process with no markers, the migration flag) resolves exactly as before.
 *   2. Developer / test / script processes resolve to an env-scoped prefix
 *      unless OMNIVYRA_ALLOW_SHARED_QUEUES=1 is set.
 *   3. The real getQueuePrefix() and the Queue/Worker factories in
 *      bullmqClient pass that prefix to BullMQ (bullmq is faked to capture it).
 *   4. The consumer seatbelt refuses an unmarked production-mode process that
 *      targets a remote Redis, and never refuses a deployed runtime.
 *   5. The consumer bootstraps call the seatbelt before any consumer exists.
 */
import fs from 'fs';
import path from 'path';

import {
  resolveQueueNamespace,
  assertQueueConsumerRuntimeAllowed,
  isLocalRedisTarget,
  QueueIsolationError,
} from '../../queue/queueNamespace';

const RAILWAY_PROD = {
  NODE_ENV: 'production',
  RAILWAY_ENVIRONMENT: 'production',
  RAILWAY_ENVIRONMENT_NAME: 'production',
  RAILWAY_GIT_COMMIT_SHA: 'f44b13875a8ce60da575197c516fa75bca946d4b',
  REDIS_URL: 'rediss://default:pw@right-treefrog-90757.upstash.io:6379',
};
const VERCEL_PROD = { NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', REDIS_URL: RAILWAY_PROD.REDIS_URL };
const LAPTOP_DEV = { NODE_ENV: 'development', REDIS_URL: RAILWAY_PROD.REDIS_URL };
const LAPTOP_TSNODE_WORKER = { REDIS_URL: RAILWAY_PROD.REDIS_URL }; // start-all spawns ts-node with NODE_ENV unset

describe('resolveQueueNamespace — production unchanged', () => {
  it.each([
    ['Railway production worker', RAILWAY_PROD],
    ['Vercel production web', VERCEL_PROD],
    ['production-mode process with no platform markers (producers stay on bull)', { NODE_ENV: 'production', REDIS_URL: RAILWAY_PROD.REDIS_URL }],
    ['Vercel preview (NODE_ENV=production)', { NODE_ENV: 'production', VERCEL_ENV: 'preview' }],
  ])('%s → shared "bull"', (_label, env) => {
    expect(resolveQueueNamespace(env)).toEqual({ prefix: 'bull', shared: true, reason: 'production-runtime' });
  });

  it('the migration flag still yields the env-scoped production prefix', () => {
    expect(resolveQueueNamespace({ ...RAILWAY_PROD, OMNIVYRA_QUEUE_PREFIX_ENABLED: 'true' }).prefix).toBe('omnivyra:production:');
    expect(resolveQueueNamespace({ ...VERCEL_PROD, OMNIVYRA_QUEUE_PREFIX_ENABLED: 'true' }).prefix).toBe('omnivyra:production:');
  });
});

describe('resolveQueueNamespace — non-production is isolated (fail closed)', () => {
  it.each([
    ['next dev on a laptop with the production REDIS_URL', LAPTOP_DEV, 'omnivyra:local:'],
    ['ts-node worker/cron spawned by dev:full (NODE_ENV unset)', LAPTOP_TSNODE_WORKER, 'omnivyra:local:'],
    ['jest', { NODE_ENV: 'test' }, 'omnivyra:test:'],
    ['vercel dev', { NODE_ENV: 'development', VERCEL_ENV: 'development' }, 'omnivyra:development:'],
  ])('%s → %s', (_label, env, prefix) => {
    const ns = resolveQueueNamespace(env);
    expect(ns.prefix).toBe(prefix);
    expect(ns.shared).toBe(false);
    expect(ns.prefix).not.toBe('bull');
  });

  it('only the explicit opt-in lets a non-production process share the production keyspace', () => {
    expect(resolveQueueNamespace({ ...LAPTOP_DEV, OMNIVYRA_ALLOW_SHARED_QUEUES: '1' }))
      .toEqual({ prefix: 'bull', shared: true, reason: 'explicit-opt-in' });
    expect(resolveQueueNamespace({ ...LAPTOP_DEV, OMNIVYRA_ALLOW_SHARED_QUEUES: '0' }).shared).toBe(false);
    expect(resolveQueueNamespace({ ...LAPTOP_DEV, OMNIVYRA_ALLOW_SHARED_QUEUES: '' }).shared).toBe(false);
  });
});

describe('isLocalRedisTarget', () => {
  it.each([
    [undefined, true], ['', true],
    ['redis://localhost:6379', true], ['redis://127.0.0.1:6379', true], ['redis://[::1]:6379', true],
    ['redis://redis:6379', true], // docker-compose service name
    ['redis://host.docker.internal:6379', true],
    ['rediss://default:pw@right-treefrog-90757.upstash.io:6379', false],
    ['redis://10.0.0.5:6379', false],
    ['redis-cli --tls -u rediss://default:pw@x.upstash.io:6379', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isLocalRedisTarget(url as string | undefined)).toBe(expected);
  });
});

describe('assertQueueConsumerRuntimeAllowed — consumer seatbelt', () => {
  it('never refuses a deployed runtime', () => {
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', RAILWAY_PROD)).not.toThrow();
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', VERCEL_PROD)).not.toThrow();
  });

  it('never refuses an isolated (non-production) process or a local/compose Redis', () => {
    expect(() => assertQueueConsumerRuntimeAllowed('workers', LAPTOP_DEV)).not.toThrow();
    expect(() => assertQueueConsumerRuntimeAllowed('workers', LAPTOP_TSNODE_WORKER)).not.toThrow();
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', { NODE_ENV: 'production', REDIS_URL: 'redis://redis:6379' })).not.toThrow();
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', { NODE_ENV: 'production' })).not.toThrow();
  });

  it('refuses an unmarked production-mode process on a remote Redis (docker worker on .env.local)', () => {
    const env = { NODE_ENV: 'production', REDIS_URL: RAILWAY_PROD.REDIS_URL };
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', env)).toThrow(QueueIsolationError);
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', env)).toThrow(/OMNIVYRA_ALLOW_SHARED_QUEUES=1/);
  });

  it('the refusal message never echoes the Redis URL (credentials)', () => {
    try {
      assertQueueConsumerRuntimeAllowed('worker-main', { NODE_ENV: 'production', REDIS_URL: 'rediss://default:SuperSecretPw@x.upstash.io:6379' });
      throw new Error('expected refusal');
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('SuperSecretPw');
      expect(String((err as Error).message)).not.toContain('upstash');
    }
  });

  it('the explicit opt-in overrides the refusal', () => {
    expect(() => assertQueueConsumerRuntimeAllowed('worker-main', {
      NODE_ENV: 'production', REDIS_URL: RAILWAY_PROD.REDIS_URL, OMNIVYRA_ALLOW_SHARED_QUEUES: '1',
    })).not.toThrow();
  });
});

// ── 3. the real factories hand BullMQ the resolved prefix ───────────────────

type Captured = { kind: 'Queue' | 'Worker'; name: string; prefix: unknown };

function withBullmqClient(
  env: Record<string, string | undefined>,
  body: (mod: typeof import('../../queue/bullmqClient')) => void,
): Captured[] {
  const captured: Captured[] = [];
  const saved: Record<string, string | undefined> = {};
  const keys = ['NODE_ENV', 'OMNIVYRA_QUEUE_PREFIX_ENABLED', 'OMNIVYRA_ALLOW_SHARED_QUEUES', 'VERCEL', 'VERCEL_ENV', 'RAILWAY_ENVIRONMENT'];
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  let mod!: typeof import('../../queue/bullmqClient');
  try {
    jest.isolateModules(() => {
      jest.doMock('bullmq', () => {
        class FakeQueue {
          name: string;
          constructor(name: string, opts: { prefix?: unknown }) { this.name = name; captured.push({ kind: 'Queue', name, prefix: opts?.prefix }); }
          on() { return this; }
          add() { return Promise.resolve(null); }
          addBulk() { return Promise.resolve([]); }
        }
        class FakeWorker {
          constructor(name: string, _p: unknown, opts: { prefix?: unknown }) { captured.push({ kind: 'Worker', name, prefix: opts?.prefix }); }
          on() { return this; }
        }
        return { Queue: FakeQueue, Worker: FakeWorker };
      });
      jest.doMock('ioredis', () => {
        return class FakeRedis { on() { return this; } connect() { return Promise.resolve(); } disconnect() {} quit() { return Promise.resolve(); } };
      });
      // The real config module wraps process.env in a non-configurable,
      // write-refusing proxy when loaded under NODE_ENV=production, which
      // would poison every later env write in this worker. A static config
      // is all bullmqClient needs.
      jest.doMock('@/config', () => ({
        config: new Proxy({ REDIS_URL: 'redis://localhost:6379' } as Record<string, unknown>, {
          get: (t, k: string) => t[k],
        }),
      }));
      jest.doMock('../../queue/queueInstrumentation', () => ({
        instrumentQueue: jest.fn(), instrumentWorker: jest.fn(), startQueueReportFlush: jest.fn(),
      }));
      jest.doMock('../../../lib/redis/instrumentation', () => ({
        getMetricsReport: () => ({ opsPerMin: 0 }), createInstrumentedClient: (c: unknown) => c, startInstrumentation: jest.fn(),
      }));
      jest.doMock('../../../lib/redis/usageProtection', () => ({
        startUsageProtection: () => Promise.resolve(), isQueueAllowed: () => true, getQueueFanOutMultiplier: () => 1,
        storeOverflow: () => false, registerOverflowDrain: jest.fn(),
      }));
      jest.doMock('../../../lib/instrumentation/metricsPersistence', () => ({ startMetricsPersistence: jest.fn() }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('../../queue/bullmqClient');
    });
    // The prefix is resolved lazily, so exercise the module while the
    // environment under test is still in place.
    body(mod);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  return captured;
}

describe('bullmqClient factories use the isolated prefix outside production', () => {
  it('a developer process builds its publish Queue and Worker on omnivyra:local:, never bull', () => {
    let prefix = '';
    const captured = withBullmqClient({ NODE_ENV: 'development' }, (mod) => {
      prefix = mod.getQueuePrefix();
      mod.getQueue();
      mod.getWorker('publish', async () => undefined);
      mod.createQueue('content-blog');
    });
    expect(prefix).toBe('omnivyra:local:');
    const prefixes = captured.map((c) => c.prefix);
    expect(prefixes.length).toBeGreaterThanOrEqual(3);
    expect(new Set(prefixes)).toEqual(new Set(['omnivyra:local:']));
  });

  it('a production process keeps the shared bull keyspace for producers and consumers', () => {
    let prefix = '';
    const captured = withBullmqClient({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT: 'production' }, (mod) => {
      prefix = mod.getQueuePrefix();
      mod.getQueue();
      mod.getWorker('publish', async () => undefined);
    });
    expect(prefix).toBe('bull');
    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(new Set(captured.map((c) => c.prefix))).toEqual(new Set(['bull']));
  });
});

// ── 5. bootstraps call the seatbelt before building consumers ───────────────

describe('consumer bootstraps run the seatbelt first', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const src = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

  it('worker main.ts refuses before its import-time workers are constructed', () => {
    const main = src('backend/workers/main.ts');
    const guard = main.indexOf("assertQueueConsumerRuntimeAllowed('worker-main')");
    expect(guard).toBeGreaterThan(-1);
    const firstWorker = Math.min(
      ...[main.indexOf("getWorker('publish'"), main.indexOf('new Worker(')].filter((i) => i > -1),
    );
    expect(guard).toBeLessThan(firstWorker);
    // …and before the BullMQ client module is even loaded.
    expect(guard).toBeLessThan(main.indexOf("from '../queue/bullmqClient'"));
  });

  it('the shared Redis preflight used by the dev worker bootstrap and the scheduler runs it', () => {
    const client = src('backend/queue/bullmqClient.ts');
    const fn = client.slice(client.indexOf('export async function verifyRedisReadyForBackgroundRuntime'));
    expect(fn.slice(0, fn.indexOf('const probe'))).toContain('assertQueueConsumerRuntimeAllowed(context)');
  });
});
