/**
 * STEP 3AH-91 integration — SEC91-D2 §6.3: executeWithCredits runs its executor
 * under the execution's credit handle.
 *
 * SEC-D made the billing guard read an ambient handle (runWithCreditHandle) and
 * adopted it in runBilledAiCompletion. executeWithCredits — the other billed
 * path (HOLD → execute → confirm) — still ran its executor with no handle, so
 * every AI gateway call it made was logged as `untracked_ai_call_blocked`, and
 * enforcing BILLING_REQUIRE_AI_HANDLE would have blocked billed, credit-held
 * work. The handle is bound to the execution's org: a nested call attributed to
 * another org is NOT vouched for.
 */
export {};

const mockAnomalies: Array<Record<string, unknown>> = [];
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: (a: Record<string, unknown>) => { mockAnomalies.push(a); } }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../db/supabaseClient', () => {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'limit', 'order']) b[m] = () => b;
  b.then = (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err);
  return { supabase: { from: () => b, rpc: async () => ({ data: null, error: null }) } };
});
jest.mock('../../repositories/creditExecutionRepository', () => ({
  findCreditTransaction: jest.fn(async () => null),
  loadCreditHoldSplit: jest.fn(async () => null),
  callCreditReservation: jest.fn(async () => ({ error: null, transactionId: 'hold-tx-fake-1' })),
  callCreditPartialConfirm: jest.fn(async () => ({ error: null, data: {} })),
}));
jest.mock('../../services/creditPriorityService', () => ({
  resolveDeduction: jest.fn(async () => ({ wallet: { id: 'wallet-fake' }, available: { total: 1000 }, split: { free: 0, incentive: 0, paid: 5 } })),
  getTotalAvailable: jest.fn(async () => 1000),
}));
jest.mock('../../services/creditDeductionService', () => ({
  getCreditCost: jest.fn(async () => 5),
  getSmartModeDedupSeconds: jest.fn(() => 0),
  wasRecentlyRun: jest.fn(async () => false),
}));
jest.mock('../../services/orgControlService', () => ({ preflightCheck: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../../services/billing/holdPolicySnapshot', () => ({ buildHoldPolicySnapshot: () => ({}), freezeHoldPolicySnapshot: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/creditSafetyGate', () => ({ evaluateCreditSafetyGate: () => 'allow' }));
jest.mock('../../services/billing/billingPolicyResolver', () => ({ resolveBillingPolicy: jest.fn(async () => ({})) }));
jest.mock('../../services/usageTrackingService', () => ({ trackUsage: jest.fn(async () => undefined) }));
jest.mock('../../services/creditAlertService', () => ({ checkCreditAlerts: jest.fn(async () => undefined) }));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeWithCredits } = require('../../services/creditExecutionServiceRuntimeCore');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkAiBillingGuard, getActiveCreditHandle } = require('../../services/billing/aiGatewayBillingGuard');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const REF = '44444444-4444-4444-8444-444444444444';

const run = (executor: () => Promise<unknown>, key = 'sec91-int-d2-key-1') => executeWithCredits({
  userId: USER, orgId: ORG_A, action: 'content_basic', referenceType: 'manual_adjustment', referenceId: REF,
  idempotencyKey: key, validateMembership: false, executor,
});

beforeEach(() => { mockAnomalies.length = 0; delete process.env.BILLING_REQUIRE_AI_HANDLE; });

describe('SEC91-D2 §6.3 — executeWithCredits carries its credit handle into the executor', () => {
  it('an AI gateway guard check inside the executor sees the handle (no untracked anomaly)', async () => {
    let inner: any;
    let handle: any;
    const r = await run(async () => {
      handle = getActiveCreditHandle();
      inner = await checkAiBillingGuard({ operation: 'sec91_fake_operation', orgId: ORG_A });
      return 'done';
    });
    expect(r.status).not.toMatch(/insufficient|not_a_member|blocked|no_credit_account/);
    expect(inner.reason).toBe('has_handle');
    expect(handle).toEqual(expect.objectContaining({ orgId: ORG_A, action: 'content_basic', idempotencyKey: 'sec91-int-d2-key-1', operationId: 'hold-tx-fake-1', amountReserved: 5 }));
    expect(mockAnomalies.filter((a) => a.kind === 'untracked_ai_call_blocked')).toEqual([]);
  });

  it('with enforcement ON the billed executor is still allowed', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    let inner: any;
    await run(async () => { inner = await checkAiBillingGuard({ operation: 'sec91_fake_operation', orgId: ORG_A }); return 'ok'; }, 'sec91-int-d2-key-2');
    expect(inner).toEqual(expect.objectContaining({ allowed: true, reason: 'has_handle' }));
  });

  it('TENANT BINDING: a nested call attributed to ANOTHER org is not vouched for by this org’s handle', async () => {
    process.env.BILLING_REQUIRE_AI_HANDLE = 'true';
    let inner: any;
    await run(async () => { inner = await checkAiBillingGuard({ operation: 'sec91_fake_operation', orgId: ORG_B }); return 'ok'; }, 'sec91-int-d2-key-3');
    expect(inner).toEqual(expect.objectContaining({ allowed: false, reason: 'enforced_block' }));
  });

  it('the handle does not leak outside the execution', async () => {
    await run(async () => 'ok', 'sec91-int-d2-key-4');
    expect(getActiveCreditHandle()).toBeUndefined();
    const outside = await checkAiBillingGuard({ operation: 'sec91_fake_operation', orgId: ORG_A });
    expect(outside.reason).toBe('shadow_mode');
  });
});
