/**
 * WS-3 quota: a Redis outage changes performance, never correctness.
 *
 * The shared client is the BullMQ one: maxRetriesPerRequest null, an offline
 * queue, and a reconnect strategy that never gives up. With Redis down, a
 * command is queued and never rejected. Before quota.ts checked the client's
 * status, such a command hung reserveQuota, and with it every outreach
 * dispatch, until Redis came back (the pi_email_send_path_041a real-schema
 * suite timed out on exactly this).
 *
 * These cases pin that, while the client is not connected, no command is
 * issued, every quota operation settles on the database answer, and the
 * limits still refuse. The hanging double makes any issued command fail the
 * test by timeout, so "settles" is proven, not assumed.
 */

type Rows = Array<Record<string, unknown>>;

const db: { attempts: Rows; leadTasks: Rows } = { attempts: [], leadTasks: [] };

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    const rows = () => (table === 'outreach_attempts' ? db.attempts : db.leadTasks);
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.gte = () => q;
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return q;
  },
}));

const never = () => new Promise<never>(() => undefined);
const calls: string[] = [];
let client: Record<string, unknown> = {};

jest.mock('../../queue/bullmqClient', () => ({
  getSharedRedisClient: () => client,
}));

import {
  __resetQuotaRedisForTests,
  reconcileQuota,
  releaseQuota,
  reserveQuota,
} from '../../services/leadOutreachExecution/quota';

const hanging = (status: string | undefined): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  if (status !== undefined) c.status = status;
  for (const m of ['incrby', 'decrby', 'expire', 'set', 'get']) {
    c[m] = (...a: unknown[]) => {
      calls.push(`${m}:${String(a[0])}`);
      return never();
    };
  }
  return c;
};

const AT = '2026-11-10T12:00:00.000Z';
const input = (over: Partial<Parameters<typeof reserveQuota>[0]> = {}) => ({
  companyId: 'co-1', leadId: 'lead-1', at: AT, dailyLimitTenant: 5, dailyLimitLead: 2, ...over,
});

beforeEach(() => {
  __resetQuotaRedisForTests();
  calls.length = 0;
  db.attempts = [];
  db.leadTasks = [];
});

describe('quota with Redis unavailable', () => {
  it.each(['connecting', 'reconnecting', 'close', 'end', 'wait'])(
    'status %s: nothing is issued, the database answers, the reservation is granted',
    async (status) => {
      client = hanging(status);
      const r = await reserveQuota(input());
      expect(r).toMatchObject({ granted: true, layer: 'db', reserved: false, tenantCount: 1, leadCount: 1 });
      expect(calls).toEqual([]);
    },
  );

  it('still refuses at the lead limit from the database alone', async () => {
    client = hanging('reconnecting');
    db.leadTasks = [{ id: 't-1' }, { id: 't-2' }];
    db.attempts = [{ id: 'a-1', task_id: 't-1' }, { id: 'a-2', task_id: 't-2' }];
    const r = await reserveQuota(input());
    expect(r.granted).toBe(false);
    expect(r.layer).toBe('db');
    expect(r.reason).toMatch(/lead limit of 2/);
    expect(calls).toEqual([]);
  });

  it('still refuses at the tenant limit from the database alone', async () => {
    client = hanging('connecting');
    db.attempts = Array.from({ length: 5 }, (_, i) => ({ id: `a-${i}`, task_id: `x-${i}` }));
    const r = await reserveQuota(input());
    expect(r).toMatchObject({ granted: false, layer: 'db' });
    expect(r.reason).toMatch(/tenant limit of 5/);
  });

  it('reconcile and release settle without issuing anything and report the database layer', async () => {
    client = hanging('reconnecting');
    db.attempts = [{ id: 'a-1', task_id: 't-1' }];
    db.leadTasks = [{ id: 't-1' }];
    const rec = await reconcileQuota('co-1', 'lead-1', AT);
    expect(rec).toMatchObject({ reconciled: false, layer: 'db', tenantCount: 1, leadCount: 1, drift: 0 });
    await expect(releaseQuota('co-1', 'lead-1', { granted: true, layer: 'redis', reserved: true, tenantCount: 1, leadCount: 1, reason: '' })).resolves.toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('a healthy client is still used (the bound does not disable the fast path)', async () => {
    const store = new Map<string, number>();
    client = {
      status: 'ready',
      incrby: async (k: string, n: number) => { const v = (store.get(k) ?? 0) + n; store.set(k, v); return v; },
      decrby: async (k: string, n: number) => { const v = (store.get(k) ?? 0) - n; store.set(k, v); return v; },
      expire: async () => 1,
      set: async (k: string, v: string) => { store.set(k, Number(v)); return 'OK'; },
      get: async (k: string) => (store.has(k) ? String(store.get(k)) : null),
    };
    const r = await reserveQuota(input());
    expect(r).toMatchObject({ granted: true, layer: 'redis', reserved: true });
    expect(store.get('ws3:quota:tenant:co-1')).toBe(1);

    // A double without a status field is used as before (the sibling suites' in-memory doubles).
    __resetQuotaRedisForTests();
    const { status: _s, ...noStatus } = client;
    client = noStatus;
    const r2 = await reserveQuota(input());
    expect(r2).toMatchObject({ granted: true, layer: 'redis', reserved: true });
    expect(store.get('ws3:quota:tenant:co-1')).toBe(2);
  });
});
