/**
 * Phase 9B — company economics endpoints (activity-economics + warnings).
 * Verifies company auth gating, param handling, range mapping, and that
 * warnings are read-only (canStartActivity), never blocking.
 */

const ctxMod = { enforceCompanyAccess: jest.fn() };
jest.mock('../../services/userContextService', () => ctxMod);
const catalog = { resolveActivityEconomics: jest.fn() };
jest.mock('../../services/activityEconomyCatalog', () => catalog);
const admission = { canStartActivity: jest.fn() };
jest.mock('../../services/billing/admissionControl', () => admission);
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import activityEconomics from '../../../pages/api/company/economics/activity-economics';
import warnings from '../../../pages/api/company/economics/warnings';

function mockRes(): any {
  const res: any = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  res.setHeader = (k: string, v: any) => { res.headers[k] = v; return res; };
  return res;
}
async function run(handler: any, query: Record<string, any>, method = 'GET') {
  const res = mockRes();
  await handler({ method, query } as any, res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  ctxMod.enforceCompanyAccess.mockResolvedValue({ userId: 'u', companyId: 'c' });
  catalog.resolveActivityEconomics.mockImplementation((a: string) => {
    if (a === 'content_basic') return { activity: a, activityClass: 'SHORT_GENERATION', entryConsumption: 2, minimumCredits: 3, maximumCredits: 15, reservationCredits: 13 };
    throw new Error('unknown');
  });
  admission.canStartActivity.mockImplementation(async ({ activity }: { activity: string }) =>
    activity === 'campaign_generation'
      ? { allowed: false, reason: 'insufficient_credits', availableCredits: 30, activeReservations: 0, effectiveCredits: 30, requiredCredits: 120, shortfall: 90 }
      : { allowed: true, reason: 'ok', availableCredits: 30, activeReservations: 0, effectiveCredits: 30, requiredCredits: 3, shortfall: 0 },
  );
});

describe('activity-economics (TASK 3)', () => {
  it('405 / 400 guards', async () => {
    expect((await run(activityEconomics, {}, 'POST')).statusCode).toBe(405);
    expect((await run(activityEconomics, { actions: 'content_basic' })).statusCode).toBe(400); // missing companyId
    expect((await run(activityEconomics, { companyId: 'c' })).statusCode).toBe(400); // missing actions
  });

  it('does not read when company access denied', async () => {
    ctxMod.enforceCompanyAccess.mockResolvedValue(undefined);
    const res = await run(activityEconomics, { companyId: 'c', actions: 'content_basic' });
    expect(catalog.resolveActivityEconomics).not.toHaveBeenCalled();
    expect(res.body).toBeUndefined();
  });

  it('maps catalog economics to starting/final; reports unknown', async () => {
    const res = await run(activityEconomics, { companyId: 'c', actions: 'content_basic,bad' });
    expect(res.statusCode).toBe(200);
    expect(res.body.economics).toHaveLength(1);
    expect(res.body.economics[0]).toMatchObject({
      activity: 'content_basic', minimumCredits: 3, maximumCredits: 15,
      estimatedStartingCost: 2, potentialFinalCost: 15, reservationCredits: 13,
    });
    expect(res.body.unknown).toEqual(['bad']);
  });
});

describe('warnings (TASK 5 — read-only, never blocks)', () => {
  it('405 / 400 guards', async () => {
    expect((await run(warnings, {}, 'POST')).statusCode).toBe(405);
    expect((await run(warnings, { companyId: 'c' })).statusCode).toBe(400);
  });

  it('surfaces would-block + shortfall + low-credit via canStartActivity', async () => {
    const res = await run(warnings, { companyId: 'c', actions: 'campaign_generation,content_basic' });
    expect(res.statusCode).toBe(200);
    expect(res.body.anyWouldBlock).toBe(true);
    expect(res.body.lowCredit).toBe(true); // effective 30 < threshold 100
    const blocked = res.body.warnings.find((w: any) => w.activity === 'campaign_generation');
    expect(blocked).toMatchObject({ wouldBlock: true, shortfall: 90, requiredCredits: 120 });
    const ok = res.body.warnings.find((w: any) => w.activity === 'content_basic');
    expect(ok.wouldBlock).toBe(false);
    // read-only evaluator only — canStartActivity used, nothing else
    expect(admission.canStartActivity).toHaveBeenCalledTimes(2);
  });
});
