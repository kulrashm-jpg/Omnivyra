/**
 * MONEY unread-error sites (2026-11-12): admin billing forensics, pricing
 * admin, and the customer billing summary. A failed read is never answered
 * with a confident empty/zero:
 *  - company-wallet: not "0 open holds";
 *  - idempotency/list: not "no heartbeat" (reads as a dead job, invites a
 *    manual recovery of a live one);
 *  - idempotency/trace: not "no middleware history";
 *  - ledger by correlationId: not "no matching billing_operations";
 *  - pricing/recommendations: not "no pending proposals" / "no analysis yet";
 *  - pricing/update: not a misleading 400 UNKNOWN_ACTION_KEY;
 *  - pricing/apply: a failed supersede leaves OLDER proposals pending - applying
 *    one later would roll the price back - so the admin is warned;
 *  - company/billing/summary: not "nothing consumed / no holds"; and the
 *    customer never sees the database message.
 */
export {};
const ORG = 'a0000000-0000-4000-8000-00000000000a';

type Res = { data?: unknown; error: { message: string } | null; count?: number };
let mockScript: Record<string, (n: number) => Res> = {};
const mockCalls: Record<string, number> = {};
const mockLogs: string[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/logger', () => ({
  logger: { error: (e: string) => mockLogs.push(e), warn: () => undefined, info: () => undefined },
}));
jest.mock('../../services/requestAccessService', () => ({
  requireAuthenticatedInternalUser: async () => ({ id: 'admin' }),
  requireAdminRateLimit: async () => true,
  assertOrgAccess: async () => true,
}));
jest.mock('../../services/billing/financeRbacService', () => ({ isFinanceAuditor: async () => true }));
// pricing/update is gated by requireCapability(BILLING_PLAN_MANAGE, step-up) since
// the image-credits unit (branch E). The gate itself is pinned by its own suites;
// this file tests the money error paths BEHIND it, so it admits a platform admin.
jest.mock('../../security/requireCapability', () => ({
  requireCapability: async () => ({ ok: true, principal: { userId: 'admin' } }),
}));
jest.mock('../../services/rbacService', () => ({ isPlatformSuperAdmin: async () => true, isSuperAdmin: async () => true }));
jest.mock('../../services/billing/payments/billingWalletService', () => ({ getBillingWalletSnapshot: async () => ({}) }));
jest.mock('../../services/billing/contracts/usageForecastingService', () => ({
  forecastUsage: async () => ({}), detectBurnRateAnomaly: async () => null,
}));
jest.mock('../../services/billing/contracts/invoiceProjectionEngine', () => ({ projectInvoice: async () => ({}) }));
jest.mock('../../services/billing/contracts/enterpriseContractResolver', () => ({ resolveActiveContract: async () => null }));
jest.mock('../../services/billing/billingFeatureFlags', () => ({ evaluateAllBillingFlags: async () => ({}) }));
jest.mock('../../services/billing/orgFinancialControlService', () => ({ checkFinancialControls: async () => ({ emergencyFreeze: false, billingLock: false }) }));
jest.mock('../../services/billing/payments/subscriptionProjectionService', () => ({ projectOrgSubscriptions: async () => [] }));
jest.mock('../../services/billing/idempotency/idempotencyRecoveryService', () => ({
  findStuckOperations: async () => [{ surface: 'job_execution_registry', id: 'j1' }],
}));
jest.mock('../../services/billing/exports/billingForensicsService', () => ({
  traceBillingOperation: async () => ({ billingOperations: [{ idempotency_key: 'k1' }] }),
}));
jest.mock('../../services/actionPricingApplyService', () => ({ applyActionPricingChange: async () => ({ id: 'price-row-2' }) }));
jest.mock('../../services/adminAuditService', () => ({ recordAdminAudit: async () => undefined }));
const mockOpsEvents: Array<{ alertKey?: string; alertReady?: boolean; severity?: string }> = [];
jest.mock('../../services/monetizationOpsService', () => ({
  recordMonetizationOperationalEvent: async (e: { alertKey?: string; alertReady?: boolean; severity?: string }) => { mockOpsEvents.push(e); },
}));
jest.mock('../../services/pricingService', () => ({
  refreshPricingCache: async () => undefined,
  getActionPricing: async () => { throw new Error('no override'); },
}));
jest.mock('../../services/usageLedgerService', () => ({ resolveActionKey: () => null }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select';
      const b: any = {};
      const result = () => {
        const k = table + ':' + op;
        mockCalls[k] = (mockCalls[k] ?? 0) + 1;
        return (mockScript[k] ?? (() => ({ data: null, error: null })))(mockCalls[k]);
      };
      for (const m of ['select', 'eq', 'in', 'is', 'neq', 'gte', 'order', 'limit', 'range']) b[m] = () => b;
      b.update = () => { op = 'update'; return b; };
      b.maybeSingle = async () => result();
      b.single = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import companyWallet from '../../../pages/api/admin/credits/company-wallet';
import idemList from '../../../pages/api/admin/credits/idempotency/list';
import idemTrace from '../../../pages/api/admin/credits/idempotency/trace';
import ledger from '../../../pages/api/admin/credits/ledger';
import pricingApply from '../../../pages/api/admin/pricing/apply';
import pricingRecs from '../../../pages/api/admin/pricing/recommendations';
import pricingUpdate from '../../../pages/api/admin/pricing/update';
import billingSummary from '../../../pages/api/company/billing/summary';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = () => r;
  return r;
}
async function call(h: (req: any, res: any) => unknown, method: string, query: Record<string, string> = {}, body: unknown = {}) {
  const res = mockRes();
  await h({ method, query, body, headers: {} }, res);
  return res;
}
const DOWN = () => ({ data: null, error: { message: 'secret_db_detail' } });

beforeEach(() => {
  mockScript = {};
  for (const k of Object.keys(mockCalls)) delete mockCalls[k];
  mockLogs.length = 0;
});

describe('admin credits forensics', () => {
  it('company-wallet: reservation-health read error -> 5xx, never "0 open holds"', async () => {
    mockScript['v_reservation_health:select'] = DOWN;
    const res = await call(companyWallet, 'GET', { orgId: ORG });
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toMatch(/"openHolds":0/);
  });

  it('idempotency/list: heartbeat read error -> 5xx, never "no heartbeat"', async () => {
    mockScript['job_execution_registry:select'] = DOWN;
    const res = await call(idemList, 'GET');
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  it('idempotency/trace: history read error -> 500, never an empty history', async () => {
    mockScript['api_idempotency_keys:select'] = DOWN;
    const res = await call(idemTrace, 'POST', {}, { idempotencyKey: 'k1' });
    expect(res.statusCode).toBe(500);
  });

  it('ledger by correlationId: billing_operations read error -> 503, never "no matching billing_operations"', async () => {
    mockScript['billing_operations:select'] = DOWN;
    const res = await call(ledger, 'GET', { orgId: ORG, correlationId: 'c1' });
    expect(res.statusCode).toBe(503);
  });
});

describe('pricing admin', () => {
  const PENDING = { id: 'q1', action_key: 'blog_generation', model_name: null, current_multiplier: 1, proposed_multiplier: 1.2, margin_percent: 10, reason: 'r', status: 'pending', source_week: null };

  it('apply: supersede fails -> still 200 (the price IS written); warned in the response AND raised as an alert-ready ops event (05: no UI reads the response)', async () => {
    mockOpsEvents.length = 0;
    mockScript['pricing_adjustment_queue:select'] = () => ({ data: PENDING, error: null });
    mockScript['pricing_adjustment_queue:update'] = (n) => (n === 2 ? DOWN() : { data: null, error: null });
    const res = await call(pricingApply, 'POST', {}, { adjustment_id: 'q1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.warnings?.[0]).toMatch(/roll the price back/);
    expect(mockLogs).toContain('admin_pricing_apply_supersede_failed');
    expect(mockOpsEvents).toEqual([expect.objectContaining({ alertKey: 'pricing_stale_proposals_pending', alertReady: true, severity: 'ERROR' })]);
  });

  // MUTANT SURVIVOR (2026-11-12): pricing_adjustment_queue is updated TWICE
  // (call 1 = mark this proposal applied, call 2 = supersede older ones); the
  // mark failure is now failed on its own and asserted by its own warning.
  it('apply: MARK-applied update fails (call 1) -> 200 with ITS warning, no supersede alert', async () => {
    mockOpsEvents.length = 0;
    mockScript['pricing_adjustment_queue:select'] = () => ({ data: PENDING, error: null });
    mockScript['pricing_adjustment_queue:update'] = (n) => (n === 1 ? DOWN() : { data: null, error: null });
    const res = await call(pricingApply, 'POST', {}, { adjustment_id: 'q1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.warnings).toEqual(['this proposal could not be marked applied']);
    expect(mockOpsEvents).toEqual([]);
  });

  it('apply control: a clean apply carries no warnings', async () => {
    mockScript['pricing_adjustment_queue:select'] = () => ({ data: PENDING, error: null });
    const res = await call(pricingApply, 'POST', {}, { adjustment_id: 'q1' });
    expect(res.statusCode).toBe(200);
    expect(res.body.warnings).toBeUndefined();
  });

  it('recommendations: week read error -> 500, never "no analysis has run yet"', async () => {
    mockScript['pricing_intelligence:select'] = DOWN;
    const res = await call(pricingRecs, 'GET');
    expect(res.statusCode).toBe(500);
    expect(res.body.note).toBeUndefined();
  });

  it('recommendations: pending-queue read error -> 500, never "no pending proposals"', async () => {
    mockScript['pricing_intelligence:select'] = () => ({ data: [{ week_start: '2026-11-02' }], error: null });
    mockScript['pricing_adjustment_queue:select'] = DOWN;
    const res = await call(pricingRecs, 'GET', { week: '2026-11-02' });
    expect(res.statusCode).toBe(500);
  });

  it('update: catalog read error -> 503, never a misleading 400 UNKNOWN_ACTION_KEY', async () => {
    mockScript['credit_cost_config:select'] = DOWN;
    const res = await call(pricingUpdate, 'POST', {}, { target: 'action', action_key: 'blog_generation', cost_multiplier: 1.2 });
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('CATALOG_UNAVAILABLE');
  });
});

describe('company/billing/summary (customer-facing)', () => {
  it.each(['v_reservation_health', 'credit_transactions'])('%s read error -> 500, no DB message to the customer', async (table) => {
    mockScript[table + ':select'] = DOWN;
    const res = await call(billingSummary, 'GET', { companyId: ORG });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret_db_detail');
    expect(mockLogs).toContain('company_billing_summary_failed');
  });

  // MUTANT SURVIVOR (2026-11-12): credit_transactions is read TWICE (call 1 =
  // recent events, call 2 = this period's consumption). Each fails on its own.
  it.each([
    ['recent events (call 1)', 1],
    ['period consumption (call 2)', 2],
  ])('credit_transactions %s read error ALONE -> 500, never a confident zero', async (_l, nth) => {
    mockScript['credit_transactions:select'] = (n) => (n === nth ? DOWN() : { data: [], error: null });
    const res = await call(billingSummary, 'GET', { companyId: ORG });
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret_db_detail');
  });
});
