/**
 * e9 ruling 2026-11-13: bulk credit-hold release (orphan reaper + durable reservation reconciler) is default-OFF for
 * EVERY caller until 20270217000053 + an in-flight-aware resolver; and the reconcile cron authorises with CRON_SECRET
 * only (INTERNAL_METRICS_SECRET is a read credential, and `||` used to 401 the Vercel cron's own Bearer CRON_SECRET).
 */
const released: string[] = [];
jest.mock('../../services/creditExecutionService', () => ({
  confirmCreditReservation: jest.fn(async () => { released.push('confirm'); return { status: 'confirmed' }; }),
  releaseCreditReservation: jest.fn(async () => { released.push('release'); return { status: 'released' }; }),
}));
jest.mock('../../services/monetizationOpsService', () => ({ recordMonetizationOperationalEvent: jest.fn(async () => undefined) }));
const dbCalls: string[] = [];
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (t: string) => {
    dbCalls.push(t);
    const q: any = {};
    for (const m of ['select', 'eq', 'lt', 'gt', 'in', 'order', 'limit', 'update', 'gte']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: null, error: null });
    q.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
    return q;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { dbCalls.push('supabase'); throw new Error('no db'); } } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
const runJob = jest.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => ({ status: 'completed', result: await fn(), ctx: { executionId: 'x' } }));
jest.mock('../../services/jobRunner', () => ({ runJob: (c: unknown, f: () => Promise<unknown>) => runJob(c, f) }));
const superAdmin = { legacy: false, platform: false };
jest.mock('@/backend/services/superAdminSession', () => ({ getLegacySuperAdminSession: () => (superAdmin.legacy ? {} : null) }));
jest.mock('../../services/supabaseAuthService', () => ({ getSupabaseUserFromRequest: async () => ({ user: superAdmin.platform ? { id: 'sa' } : null, error: null }) }));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => superAdmin.platform }));

import { reapOrphanHolds } from '../../services/creditOrphanHoldReaper';
import { reconcileDurableMonetizationReservations } from '../../services/monetizationReservationReconciliationService';
import { HoldReleaseDisabledError } from '../../services/billing/holdReleaseGate';
import reapRoute from '../../../pages/api/cron/credit-orphan-hold-reap';
import reconcileRoute from '../../../pages/api/cron/monetization-reservation-reconcile';

function res() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
const call = async (h: unknown, headers: Record<string, string> = {}) => {
  const r = res();
  await (h as any)({ method: 'POST', query: {}, headers }, r);
  return r;
};

const CRON = 'cron-secret-value-for-tests-only';
const METRICS = 'metrics-secret-value-for-tests-only';
const ENV = ['CREDIT_HOLD_REAP_ENABLED', 'CRON_SECRET', 'INTERNAL_METRICS_SECRET'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.CRON_SECRET = CRON;
  released.length = 0; dbCalls.length = 0; runJob.mockClear();
  superAdmin.legacy = false; superAdmin.platform = false;
});
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('gate OFF (default): every caller is refused, nothing released, no DB touched', () => {
  it('services throw HoldReleaseDisabledError before any read', async () => {
    await expect(reapOrphanHolds({ minAgeSeconds: 0 })).rejects.toBeInstanceOf(HoldReleaseDisabledError);
    await expect(reconcileDurableMonetizationReservations({ minAgeSeconds: 0 })).rejects.toBeInstanceOf(HoldReleaseDisabledError);
    expect(dbCalls).toEqual([]);
    expect(released).toEqual([]);
  });

  it.each([
    ['cron secret', () => ({ authorization: `Bearer ${CRON}` })],
    ['legacy super-admin session', () => { superAdmin.legacy = true; return {}; }],
    ['platform super admin', () => { superAdmin.platform = true; return {}; }],
  ])('reap route, caller = %s -> 409 HOLD_RELEASE_DISABLED with the reason, job never runs', async (_n, setup) => {
    const r = await call(reapRoute, setup());
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'HOLD_RELEASE_DISABLED' });
    expect(r.body.reason).toMatch(/20270217000053/);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('reconcile route with the cron secret -> 409, job never runs', async () => {
    const r = await call(reconcileRoute, { authorization: `Bearer ${CRON}` });
    expect(r.statusCode).toBe(409);
    expect(runJob).not.toHaveBeenCalled();
  });
});

describe('reconcile cron authorisation: CRON_SECRET only', () => {
  beforeEach(() => { process.env.CREDIT_HOLD_REAP_ENABLED = 'true'; });

  it('INTERNAL_METRICS_SECRET no longer authorises a hold-releasing run', async () => {
    process.env.INTERNAL_METRICS_SECRET = METRICS;
    const r = await call(reconcileRoute, { authorization: `Bearer ${METRICS}` });
    expect(r.statusCode).toBe(401);
    expect(runJob).not.toHaveBeenCalled();
  });

  it('with INTERNAL_METRICS_SECRET SET, the cron Bearer CRON_SECRET is still accepted (the old `||` gave 401)', async () => {
    process.env.INTERNAL_METRICS_SECRET = METRICS;
    const r = await call(reconcileRoute, { authorization: `Bearer ${CRON}` });
    expect(r.statusCode).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);
  });
});

describe('gate ON: positive control - the release paths run', () => {
  beforeEach(() => { process.env.CREDIT_HOLD_REAP_ENABLED = 'true'; });
  it('reap route with the cron secret -> 200 and the job runs', async () => {
    const r = await call(reapRoute, { authorization: `Bearer ${CRON}` });
    expect(r.statusCode).toBe(200);
    expect(runJob).toHaveBeenCalledTimes(1);
  });
  it('the reconciler service runs (reads the hold table)', async () => {
    await reconcileDurableMonetizationReservations({ minAgeSeconds: 0 });
    expect(dbCalls).toContain('credit_transactions');
  });
});
