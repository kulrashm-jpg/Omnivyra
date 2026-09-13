/**
 * INTERNAL_METRICS_SECRET — no committed default.
 *
 * The schema used to default this to a string committed in the repository,
 * which made it a public credential for /api/internal/metrics and the
 * x-cron-secret cron routes wherever the variable was left unset or copied
 * from env.example. Pins:
 *   1. The schema supplies no default (unset stays unset).
 *   2. No tracked runtime/config file carries the old public value.
 *   3. The metrics route refuses requests in production when the secret is unset.
 */
import fs from 'fs';
import path from 'path';

import { envSchema } from '../../../config/env.schema';

const REPO_ROOT = path.resolve(__dirname, '../../..');
// Assembled so this file does not itself contain the old value.
const OLD_PUBLIC_DEFAULT = ['omnivyra', 'internal', 'metrics', 'secret', '12345'].join('_');

describe('INTERNAL_METRICS_SECRET has no committed default', () => {
  it('the schema leaves it undefined when unset', () => {
    expect(envSchema.shape.INTERNAL_METRICS_SECRET.parse(undefined)).toBeUndefined();
  });

  it('the schema still rejects an empty value', () => {
    expect(() => envSchema.shape.INTERNAL_METRICS_SECRET.parse('')).toThrow();
  });

  it.each(['config/env.schema.ts', 'env.example', 'pages/api/internal/metrics.ts'])(
    '%s does not carry the old public value',
    (rel) => {
      expect(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')).not.toContain(OLD_PUBLIC_DEFAULT);
    },
  );
});

describe('/api/internal/metrics fails closed in production', () => {
  const ORIGINAL = { secret: process.env.INTERNAL_METRICS_SECRET, nodeEnv: process.env.NODE_ENV };

  afterEach(() => {
    if (ORIGINAL.secret === undefined) delete process.env.INTERNAL_METRICS_SECRET;
    else process.env.INTERNAL_METRICS_SECRET = ORIGINAL.secret;
    (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL.nodeEnv;
    jest.resetModules();
  });

  const loadHandler = (secret: string | undefined, nodeEnv: string) => {
    if (secret === undefined) delete process.env.INTERNAL_METRICS_SECRET;
    else process.env.INTERNAL_METRICS_SECRET = secret;
    (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
    let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../backend/queue/bullmqClient', () => {
        const q = { getJobCounts: jest.fn().mockResolvedValue({}) };
        return { getQueue: () => q, getEngagementPollingQueue: () => q, getPostingQueue: () => q, getAiHeavyQueue: () => q };
      });
      jest.doMock('../../../backend/services/metricsCollector', () => ({
        getMetricsSnapshot: jest.fn().mockResolvedValue({}),
        resetMetrics: jest.fn(),
      }));
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/internal/metrics').default;
    });
    return handler;
  };

  const call = async (handler: (req: unknown, res: unknown) => Promise<unknown>, headers: Record<string, string> = {}) => {
    let status = 0;
    const res = { status: (s: number) => { status = s; return res; }, json: () => res, setHeader: () => res };
    await handler({ method: 'GET', headers, query: {} }, res);
    return status;
  };

  it('refuses an unauthenticated request in production when the secret is unset', async () => {
    expect(await call(loadHandler(undefined, 'production'))).toBe(401);
  });

  it('refuses a wrong secret and accepts the configured one', async () => {
    const handler = loadHandler('test-metrics-secret-abc', 'production');
    expect(await call(handler, { 'x-metrics-secret': 'wrong' })).toBe(401);
    expect(await call(handler, { 'x-metrics-secret': 'test-metrics-secret-abc' })).not.toBe(401);
  });
});
