/**
 * Phase 9A — super-admin economics API tests.
 *
 * Verifies authz (super-admin only), param handling, the activity filter, and
 * that each endpoint only READS via the existing accounting services (no
 * mutation surface is touched).
 */

const auth = { requireAuthenticatedInternalUser: jest.fn() };
jest.mock('../../services/requestAccessService', () => auth);
const rbac = { isPlatformSuperAdmin: jest.fn(), isSuperAdmin: jest.fn() };
jest.mock('../../services/rbacService', () => rbac);
const svc = {
  getActivityEconomicLedger: jest.fn(),
  getProfitabilityReport: jest.fn(),
  getPlatformCostAccounting: jest.fn(),
};
jest.mock('../../services/billing/economicAccountingService', () => svc);
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));

import activityLedger from '../../../pages/api/super-admin/economics/activity-ledger';
import profitability from '../../../pages/api/super-admin/economics/profitability';
import platformCosts from '../../../pages/api/super-admin/economics/platform-costs';

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
  auth.requireAuthenticatedInternalUser.mockResolvedValue({ id: 'sa' });
  rbac.isPlatformSuperAdmin.mockResolvedValue(true);
  rbac.isSuperAdmin.mockResolvedValue(false);
  svc.getActivityEconomicLedger.mockResolvedValue([
    { activity: 'blog_generation', organizationId: 'o', providerCostUsd: 1 },
    { activity: 'content_basic', organizationId: 'o', providerCostUsd: 2 },
  ]);
  svc.getProfitabilityReport.mockResolvedValue({ byProvider: [{ key: 'openai' }], byActivity: [], byOrganization: [] });
  svc.getPlatformCostAccounting.mockResolvedValue({ totalPlatformCostUsd: 0.05, events: 1, byProvider: [{ key: 'gemini' }], byActivity: [{ key: 'ai_visibility_probe' }] });
});

describe('authorization (TASK 4 — super-admin only)', () => {
  it('rejects non-GET', async () => {
    const res = await run(activityLedger, {}, 'POST');
    expect(res.statusCode).toBe(405);
  });

  it('403 when not super-admin (no company/finance access)', async () => {
    rbac.isPlatformSuperAdmin.mockResolvedValue(false);
    rbac.isSuperAdmin.mockResolvedValue(false);
    const res = await run(activityLedger, { from: '2026-01-01' });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ error: 'SUPER_ADMIN_REQUIRED' });
    expect(svc.getActivityEconomicLedger).not.toHaveBeenCalled(); // never reads on deny
  });

  it('allows app super-admin via isSuperAdmin fallback', async () => {
    rbac.isPlatformSuperAdmin.mockResolvedValue(false);
    rbac.isSuperAdmin.mockResolvedValue(true);
    const res = await run(activityLedger, { from: '2026-01-01' });
    expect(res.statusCode).toBe(200);
  });
});

describe('GET activity-ledger (TASK 1)', () => {
  it('400 when from missing', async () => {
    const res = await run(activityLedger, {});
    expect(res.statusCode).toBe(400);
    expect(svc.getActivityEconomicLedger).not.toHaveBeenCalled();
  });

  it('maps from/to/organizationId to the service window and returns rows', async () => {
    const res = await run(activityLedger, { from: '2026-01-01', to: '2026-02-01', organizationId: 'o' });
    expect(res.statusCode).toBe(200);
    expect(svc.getActivityEconomicLedger).toHaveBeenCalledWith(
      expect.objectContaining({ since: '2026-01-01', until: '2026-02-01', organizationId: 'o' }),
    );
    expect(res.body.count).toBe(2);
    expect(res.body.rows).toHaveLength(2);
  });

  it('applies the activity filter (post-filter)', async () => {
    const res = await run(activityLedger, { from: '2026-01-01', activity: 'blog_generation' });
    expect(res.statusCode).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].activity).toBe('blog_generation');
    expect(res.body.activity).toBe('blog_generation');
  });
});

describe('GET profitability (TASK 2)', () => {
  it('returns provider/activity/organization profitability', async () => {
    const res = await run(profitability, { from: '2026-01-01', to: '2026-02-01' });
    expect(res.statusCode).toBe(200);
    expect(svc.getProfitabilityReport).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-01-01', until: '2026-02-01' }));
    expect(res.body).toMatchObject({ byProvider: [{ key: 'openai' }], byActivity: [], byOrganization: [] });
  });
});

describe('GET platform-costs (TASK 3)', () => {
  it('returns platform-only costs (no org scoping)', async () => {
    const res = await run(platformCosts, { from: '2026-01-01' });
    expect(res.statusCode).toBe(200);
    expect(svc.getPlatformCostAccounting).toHaveBeenCalledWith(expect.objectContaining({ since: '2026-01-01' }));
    const passed = svc.getPlatformCostAccounting.mock.calls[0][0];
    expect(passed.organizationId).toBeUndefined(); // platform-global, never org-scoped
    expect(res.body).toMatchObject({ totalPlatformCostUsd: 0.05, byProvider: [{ key: 'gemini' }] });
  });
});

describe('read-only (TASK 5)', () => {
  it('endpoints only invoke read services; no mutation surface', async () => {
    await run(activityLedger, { from: '2026-01-01' });
    await run(profitability, { from: '2026-01-01' });
    await run(platformCosts, { from: '2026-01-01' });
    // Only the three read services were used.
    expect(svc.getActivityEconomicLedger).toHaveBeenCalledTimes(1);
    expect(svc.getProfitabilityReport).toHaveBeenCalledTimes(1);
    expect(svc.getPlatformCostAccounting).toHaveBeenCalledTimes(1);
  });
});
