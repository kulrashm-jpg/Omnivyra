/**
 * C75 (BLOCKING money; owner ruling via e9; e1's 4 conditions): the multi-call daily routes bill token-actual through
 * executeWithEntryConsumption (collectViaCollector) via runEntryConsumptionForHttp.
 *   - POST /api/content/generate-day                (content_basic)
 *   - POST /api/campaigns/generate-ai-daily-plans   (content_basic; the slot scheduler call is inside, not charged alone)
 *
 * REAL: the routes, runEntryConsumptionForHttp, executeWithEntryConsumption (gate, stage keys, deferred entry, settle
 * plan, underfunded), resolveHttpAttemptRoot, the activity catalog, aiUsageCollector, aiGatewayBillingGuard,
 * getCreditEconomyExecutionMode. FAKED: the reservation primitives + ledger lookups (one ledger), the wallet, token
 * pricing, the per-org enforcement gate, and the heavy generation services (each makes TWO provider calls).
 */

// ---------------------------------------------------------------- ledger + wallet
type Phase = 'hold' | 'confirm' | 'release';
const ledger = new Map<string, Phase>();
const wallet = { balance: 0 };
const holdAmount = new Map<string, number>();
const charged: Array<{ key: string; credits: number }> = [];
function onlyKeys(kind: Phase) { return [...ledger.entries()].filter(([, p]) => p === kind).map(([k]) => k); }

jest.mock('../../repositories/creditExecutionRepository', () => ({
  findCreditTransaction: async (key: string) => (ledger.has(key) ? { id: key, execution_phase: ledger.get(key) } : null),
  callCreditPartialConfirm: async (cmd: any) => {
    const held = holdAmount.get(cmd.holdTxnId) ?? 0;
    const consumed = Math.min(held, Object.values(cmd.actualSplit as Record<string, number>).reduce((a, b) => a + b, 0));
    ledger.set(cmd.idempotencyKey, 'confirm');
    wallet.balance += held - consumed; // the remainder returns to the wallet
    charged.push({ key: cmd.idempotencyKey, credits: consumed });
    return { error: null, data: { id: cmd.idempotencyKey, total_consumed: consumed, total_released: held - consumed } };
  },
  callCreditReservation: async () => ({ error: null, transactionId: 'x' }),
  loadCreditHoldSplit: async () => ({ free: 0, incentive: 0, paid: 0 }),
}));
jest.mock('../../services/creditExecutionServiceContracts', () => {
  const actual = jest.requireActual('../../services/creditExecutionServiceContracts');
  return {
    ...actual,
    fireAlerts: () => undefined,
    reserveCreditsForWork: async (o: any) => {
      const { confirmKey, releaseKey, holdKey } = actual.getReservationKeys(o.idempotencyKey);
      if (ledger.has(confirmKey)) return { status: 'already_confirmed' };
      if (ledger.has(releaseKey)) return { status: 'already_released' };
      if (ledger.has(holdKey)) return { status: 'already_reserved', ...handle(o) };
      if (wallet.balance < o.amountOverride) return { status: 'insufficient_credits', available: wallet.balance, required: o.amountOverride };
      ledger.set(holdKey, 'hold');
      wallet.balance -= o.amountOverride;
      holdAmount.set(holdKey, o.amountOverride);
      return { status: 'reserved', ...handle(o) };
      function handle(x: any) {
        return { orgId: x.orgId, userId: x.userId, action: x.action, referenceType: x.referenceType, referenceId: x.referenceId,
          idempotencyKey: x.idempotencyKey, holdTransactionId: holdKey, creditsReserved: x.amountOverride, split: { free: 0, incentive: 0, paid: x.amountOverride } };
      }
    },
    confirmCreditReservation: async (h: any) => {
      const { confirmKey } = actual.getReservationKeys(h.idempotencyKey);
      ledger.set(confirmKey, 'confirm');
      charged.push({ key: confirmKey, credits: h.creditsReserved });
      return { status: 'confirmed' };
    },
    releaseCreditReservation: async (h: any) => {
      const { releaseKey } = actual.getReservationKeys(h.idempotencyKey);
      if (!ledger.has(releaseKey)) { ledger.set(releaseKey, 'release'); wallet.balance += h.creditsReserved; }
      return { status: 'released' };
    },
  };
});
jest.mock('../../services/creditPriorityService', () => ({
  getTotalAvailable: async () => wallet.balance,
  resolveDeduction: async () => ({ wallet: null, available: null, split: null }),
}));
// Token pricing: 1 credit per 100 tokens (the test only compares against this same function).
const creditsFor = (tokens: number) => Math.ceil(tokens / 100);
const recordCostAnomaly = jest.fn();
jest.mock('../../services/pricingService', () => ({
  resolveLlmCost: async (i: any) => ({ credits: creditsFor(i.inputTokens + i.outputTokens), total_cost_usd: 0, final_price_usd: 0 }),
  estimateLlmHoldCredits: async () => ({ credits: 0 }),
  recordCostAnomaly: (...a: unknown[]) => recordCostAnomaly(...a),
}));
jest.mock('../../services/usageTrackingService', () => ({ trackUsage: async () => undefined }));
jest.mock('../../services/creditAlertService', () => ({ checkCreditAlerts: async () => undefined }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: async () => undefined }));
jest.mock('../../services/creditDeductionService', () => ({ getCreditCost: async () => 0, getSmartModeDedupSeconds: async () => 0, wasRecentlyRun: async () => false }));
jest.mock('../../services/billing/creditEconomyObservability', () => ({ recordSettlementObservation: async () => undefined }));
jest.mock('../../services/billing/holdPolicySnapshot', () => ({ buildHoldPolicySnapshot: () => ({}), freezeHoldPolicySnapshot: (x: unknown) => x }));
jest.mock('../../services/billing/creditSafetyGate', () => ({ evaluateCreditSafetyGate: () => 'allow' }));
jest.mock('../../services/billing/billingPolicyResolver', () => ({ resolveBillingPolicy: async () => ({}) }));
jest.mock('../../services/creditExecutionServiceRuntimeCore', () => ({ executeWithCredits: async () => { throw new Error('not used'); } }));
jest.mock('../../services/creditExecutionService', () => ({
  isEntryConsumptionEnabled: () => String(process.env.PHASE2_ENTRY_CONSUMPTION ?? '').toLowerCase() === 'true',
  makeIdempotencyKey: (...a: any[]) => jest.requireActual('../../services/creditExecutionServiceContracts').makeIdempotencyKey(...a),
}));
const gateMode = { mode: 'enforce' as 'enforce' | 'off' | 'shadow' };
jest.mock('../../services/billing/phase2EnforcementGate', () => ({ resolveEnforcementMode: async () => ({ mode: gateMode.mode }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({ select: async () => ({ data: [], error: null }) }) } }));

// ---------------------------------------------------------------- gateway: REAL guard + REAL usage collector
const providerCalls: Array<{ operation: string; companyId: string | null }> = [];
const tokensPerCall = { in: 300, out: 200 };
async function gatewayCall(operation: string, companyId: string | null) {
  const { checkAiBillingGuard, isAiBillingEnforced } = require('../../services/billing/aiGatewayBillingGuard');
  const guard = await checkAiBillingGuard({ operation, orgId: companyId ?? undefined });
  if (!guard.allowed && isAiBillingEnforced()) throw new Error(`[aiGateway] BILLING_REQUIRED: operation "${operation}"`);
  providerCalls.push({ operation, companyId });
  require('../../services/aiUsageCollector').recordProviderUsage(tokensPerCall.in, tokensPerCall.out);
}

// ---------------------------------------------------------------- routes' heavy services (each: TWO provider calls)
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const failNext = { generate: false };
jest.mock('../../services/contentGenerationService', () => ({
  generateContentForDay: async (input: any) => {
    await gatewayCall('generateContentForDay', input.companyProfile.company_id);
    if (failNext.generate) { failNext.generate = false; throw new Error('model output invalid'); }
    await gatewayCall('regenerateContent', input.companyProfile.company_id); // the overlap retry - same handle
    return { headline: 'H', caption: 'C' };
  },
}));
jest.mock('../../services/executionPlannerService', () => ({
  WEEK_EXECUTION_LOCKED: 'WEEK_EXECUTION_LOCKED',
  generateFromAI: async (_c: string, _w: number, options?: { companyId?: string }) => {
    await gatewayCall('generateDailyPlan', options?.companyId ?? null);
    if (failNext.generate) { failNext.generate = false; throw new Error('model output invalid'); }
    await gatewayCall('generateCampaignPlan', options?.companyId ?? null); // the slot scheduler - same handle, no own charge
    return { rowsInserted: 7 };
  },
}));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withRBAC', () => ({ withRBAC: (h: unknown) => h }));
jest.mock('../../services/rbacService', () => ({ Role: { SUPER_ADMIN: 'SUPER_ADMIN', ADMIN: 'ADMIN', CONTENT_CREATOR: 'CONTENT_CREATOR', CONTENT_MANAGER: 'CONTENT_MANAGER' } }));
jest.mock('../../services/userContextService', () => ({ enforceCompanyAccess: async () => ({ userId: USER }) }));
jest.mock('../../services/campaignAccessService', () => ({ requireCampaignAccess: async () => ({ userId: USER, companyId: ORG, campaignId: 'camp-1' }) }));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: async () => ({ company_id: ORG }) }));
jest.mock('../../services/companyContextService', () => ({ buildCompanyContext: () => ({}), buildForcedCompanyContext: () => ({ forced_context: {} }), formatForcedContextForPrompt: () => '' }));
jest.mock('../../services/campaignBlueprintService', () => ({
  getResolvedCampaignPlanContext: async () => ({ campaign: { id: 'camp-1' }, weekly_plan: [{ week_number: 1 }] }),
  PrePlanningRequiredError: class extends Error {},
}));
jest.mock('../../db/platformExecutionStore', () => ({ getLatestPlatformExecutionPlan: async () => ({ plan_json: { days: [{ date: 'mon', platform: 'linkedin' }] } }) }));
jest.mock('../../services/campaignMemoryService', () => ({ getCampaignMemory: async () => null }));
jest.mock('../../services/contentAssetService', () => ({ createContentAsset: async (a: any) => ({ asset_id: a.assetId }) }));
jest.mock('../../db/contentAssetStore', () => ({ getContentAssetByKey: async () => null }));
jest.mock('../../services/trackingLinkService', () => ({ generateTrackingLink: async () => ({ url: 'https://t' }) }));
jest.mock('../../services/creator/campaignVariantBridge', () => ({ resolveCampaignVariant: async () => ({ status: 'none' }) }));

import generateDay from '../../../pages/api/content/generate-day';
import generateDailyPlans from '../../../pages/api/campaigns/generate-ai-daily-plans';
import { resolveActivityEconomics } from '../../services/activityEconomyCatalog';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  res.setHeader = () => res;
  return res;
}
const call = async (h: any, body: Record<string, unknown>) => { const res = mockRes(); await h({ method: 'POST', body, query: {}, headers: {} }, res); return res; };

const ROUTES = {
  generateDay: { run: () => call(generateDay, { companyId: ORG, campaignId: 'camp-1', weekNumber: 1, day: 'mon' }), ok: (r: any) => expect(r.statusCode).toBe(200) },
  generateAiDailyPlans: { run: () => call(generateDailyPlans, { campaignId: 'camp-1', weekNumber: 1 }), ok: (r: any) => expect(r.body).toEqual(expect.objectContaining({ success: true, rowsInserted: 7 })) },
} as const;

const econ = resolveActivityEconomics('content_basic');
const totalCharged = () => charged.reduce((a, c) => a + c.credits, 0);

beforeEach(() => {
  ledger.clear(); holdAmount.clear(); charged.length = 0; providerCalls.length = 0;
  recordCostAnomaly.mockClear();
  wallet.balance = 1000;
  gateMode.mode = 'enforce';
  failNext.generate = false;
  tokensPerCall.in = 300; tokensPerCall.out = 200;
  process.env.PHASE2_ENTRY_CONSUMPTION = 'true';
  delete process.env.BILLING_REQUIRE_AI_HANDLE;
});
afterAll(() => { delete process.env.PHASE2_ENTRY_CONSUMPTION; });

describe.each(Object.keys(ROUTES) as Array<keyof typeof ROUTES>)('token-actual billing: %s', (name) => {
  const r = ROUTES[name];

  it('flag + gate ON: entry + exposure held, settled on the SUM of BOTH provider calls, remainder released', async () => {
    const res = await r.run();
    r.ok(res);
    expect(providerCalls).toHaveLength(2);
    expect(providerCalls.every((c) => c.companyId === ORG)).toBe(true);
    const actual = creditsFor(2 * (tokensPerCall.in + tokensPerCall.out)); // both calls, summed
    expect(totalCharged()).toBe(actual);
    expect(wallet.balance).toBe(1000 - actual); // exposure remainder released
  });

  it('CONTROL flag OFF (PHASE2_ENTRY_CONSUMPTION unset): legacy path, no holds, nothing charged', async () => {
    delete process.env.PHASE2_ENTRY_CONSUMPTION;
    const res = await r.run();
    r.ok(res);
    expect(ledger.size).toBe(0);
    expect(providerCalls).toHaveLength(2);
  });

  it("CONTROL gate OFF for the org: legacy path, nothing charged", async () => {
    gateMode.mode = 'off';
    await r.run();
    expect(ledger.size).toBe(0);
  });

  it('insufficient credits (below the max exposure): no provider call, shared 402 shape', async () => {
    wallet.balance = econ.maximumCredits - 1;
    const res = await r.run();
    expect(providerCalls).toHaveLength(0);
    expect(res.statusCode).toBe(402);
    expect(res.body).toEqual({ error: 'Insufficient credits to generate content', code: 'INSUFFICIENT_CREDITS', required: econ.maximumCredits, balance: econ.maximumCredits - 1 });
  });

  it('underfunded (actual > max): the excess is not charged and the cost anomaly is recorded', async () => {
    tokensPerCall.in = 5000; tokensPerCall.out = 5000;
    await r.run();
    expect(totalCharged()).toBe(econ.maximumCredits);
    expect(recordCostAnomaly).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG, severity: 'critical', metadata: expect.objectContaining({ violation: 'entry_consumption_exceeds_max' }),
    }));
  });

  it('BILLING_REQUIRE_AI_HANDLE=true: both provider calls pass the REAL guard (handle for the org)', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    const res = await r.run();
    r.ok(res);
    expect(providerCalls).toHaveLength(2);
  });

  it('failed attempt -> exposure released (only the entry for the call made is kept); IDENTICAL retry runs and settles once', async () => {
    failNext.generate = true;
    await r.run();
    const afterFail = totalCharged();
    expect(afterFail).toBe(econ.entryConsumption); // one provider call happened -> entry kept, exposure released
    expect(onlyKeys('release').length).toBe(1);
    const retry = await r.run();
    r.ok(retry);
    const settles = charged.filter((c) => c.key.endsWith(':exposure:confirm'));
    expect(settles).toHaveLength(1);
  });

  it('a SETTLED request repeated -> 409 ALREADY_PROCESSED, no provider call, no second charge', async () => {
    await r.run();
    const before = totalCharged();
    providerCalls.length = 0;
    const again = await r.run();
    expect(again.statusCode).toBe(409);
    expect(again.body).toEqual({ error: 'This request was already processed.', code: 'ALREADY_PROCESSED' });
    expect(providerCalls).toHaveLength(0);
    expect(totalCharged()).toBe(before);
  });
});
