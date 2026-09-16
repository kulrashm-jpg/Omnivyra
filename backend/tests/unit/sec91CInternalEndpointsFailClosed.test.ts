/**
 * SEC-C1 (STEP 3AH-91) — internal endpoints fail closed in EVERY environment.
 *
 * /api/internal/process-reminders and /api/internal/metrics authenticated only
 * when their secret was configured and fell open outside production
 * (`if (secret) { check } else if (NODE_ENV === 'production') reject`). The
 * route gate's R4 deliberately accepts that shape (the else branch rejects),
 * but a developer process uses the production database and Redis
 * (.env.local) and `next dev` listens on every interface — so "open in
 * development" meant anyone on the same network could email real users
 * (process-reminders) or read production queue depths (metrics).
 *
 * Pins: with the secret unset the endpoint refuses in development, test and
 * production alike and never touches its sink; with the secret set, a wrong
 * or absent credential is refused and the right one is accepted.
 */
export {};

type Res = { statusCode: number; body: unknown; status(n: number): Res; json(b: unknown): Res; setHeader(): Res };
function mockRes(): Res {
  const res: Res = {
    statusCode: 0,
    body: undefined,
    status(n) { res.statusCode = n; return res; },
    json(b) { res.body = b; return res; },
    setHeader() { return res; },
  };
  return res;
}

const ORIGINAL = {
  cron: process.env.CRON_SECRET,
  metrics: process.env.INTERNAL_METRICS_SECRET,
  nodeEnv: process.env.NODE_ENV,
};
afterEach(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  };
  restore('CRON_SECRET', ORIGINAL.cron);
  restore('INTERNAL_METRICS_SECRET', ORIGINAL.metrics);
  restore('NODE_ENV', ORIGINAL.nodeEnv);
  jest.resetModules();
});

function setEnv(k: string, v: string | undefined) {
  if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
  else (process.env as Record<string, string | undefined>)[k] = v;
}

describe('/api/internal/process-reminders', () => {
  const from = jest.fn();
  const sendDomainVerificationReminder = jest.fn();

  const load = (secret: string | undefined, nodeEnv: string) => {
    setEnv('CRON_SECRET', secret);
    setEnv('NODE_ENV', nodeEnv);
    from.mockReset();
    // A due-batch read that yields nothing, then a cleanup delete.
    const chain: Record<string, jest.Mock> = {};
    for (const m of ['select', 'eq', 'lte', 'order', 'limit', 'delete', 'lt', 'update', 'in']) {
      chain[m] = jest.fn(() => chain);
    }
    (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    from.mockImplementation(() => chain);
    let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      jest.doMock('../../../backend/db/supabaseClient', () => ({ supabase: { from, auth: { admin: {} } } }));
      jest.doMock('../../../backend/services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
      jest.doMock('../../../backend/services/domainReminderService', () => ({ sendDomainVerificationReminder }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/internal/process-reminders').default;
    });
    return handler;
  };
  const call = async (handler: (req: unknown, res: unknown) => Promise<unknown>, headers: Record<string, unknown> = {}) => {
    const res = mockRes();
    await handler({ method: 'POST', headers, query: {} }, res);
    return res.statusCode;
  };

  it.each(['development', 'test', 'production'])(
    'refuses an unauthenticated request with CRON_SECRET unset (NODE_ENV=%s) and never reads the queue',
    async (nodeEnv) => {
      expect(await call(load(undefined, nodeEnv))).toBe(401);
      expect(from).not.toHaveBeenCalled();
      expect(sendDomainVerificationReminder).not.toHaveBeenCalled();
    },
  );

  it('with CRON_SECRET set: wrong / absent bearer → 401, exact bearer → runs', async () => {
    const handler = load('reminders-secret-7', 'development');
    expect(await call(handler, { authorization: 'Bearer reminders-secret-8' })).toBe(401);
    expect(await call(handler, { authorization: 'reminders-secret-7' })).toBe(401);
    expect(await call(handler, {})).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(await call(handler, { authorization: 'Bearer reminders-secret-7' })).toBe(200);
    expect(from).toHaveBeenCalledWith('domain_reminders');
  });
});

describe('/api/internal/metrics', () => {
  const getJobCounts = jest.fn().mockResolvedValue({ waiting: 0 });
  const load = (secret: string | undefined, nodeEnv: string) => {
    setEnv('INTERNAL_METRICS_SECRET', secret);
    setEnv('NODE_ENV', nodeEnv);
    getJobCounts.mockClear();
    let handler: (req: unknown, res: unknown) => Promise<unknown> = async () => undefined;
    jest.isolateModules(() => {
      jest.doMock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
      jest.doMock('../../../backend/queue/bullmqClient', () => {
        const q = { getJobCounts };
        return { getQueue: () => q, getEngagementPollingQueue: () => q, getPostingQueue: () => q, getAiHeavyQueue: () => q };
      });
      jest.doMock('../../../backend/services/metricsCollector', () => ({
        getMetricsSnapshot: jest.fn().mockResolvedValue({}),
        resetMetrics: jest.fn(),
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      handler = require('../../../pages/api/internal/metrics').default;
    });
    return handler;
  };
  const call = async (handler: (req: unknown, res: unknown) => Promise<unknown>, headers: Record<string, unknown> = {}) => {
    const res = mockRes();
    await handler({ method: 'GET', headers, query: {} }, res);
    return res.statusCode;
  };

  it.each(['development', 'test', 'production'])(
    'refuses with INTERNAL_METRICS_SECRET unset (NODE_ENV=%s) and never reads the queues',
    async (nodeEnv) => {
      expect(await call(load(undefined, nodeEnv))).toBe(401);
      expect(getJobCounts).not.toHaveBeenCalled();
    },
  );

  it('with the secret set: wrong / array header → 401, exact → 200', async () => {
    const handler = load('metrics-secret-3', 'development');
    expect(await call(handler, { 'x-metrics-secret': 'metrics-secret-4' })).toBe(401);
    expect(await call(handler, { 'x-metrics-secret': ['metrics-secret-3'] })).toBe(401);
    expect(getJobCounts).not.toHaveBeenCalled();
    expect(await call(handler, { 'x-metrics-secret': 'metrics-secret-3' })).toBe(200);
    expect(getJobCounts).toHaveBeenCalled();
  });
});
