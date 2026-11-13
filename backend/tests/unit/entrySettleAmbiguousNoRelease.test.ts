/**
 * e9 ruling 2026-11-13: executeWithEntryConsumption's token settle (apply_credit_partial_confirm on the exposure hold)
 * must not RELEASE the exposure on an error unless the exposure is provably open AND the error was a definitive DB
 * refusal. A committed settle is adopted; anything else RETURNS the finished work with settlementPending and no release (the exposure stays reserved for resolution).
 * Scaffold copied from activityEntryConsumption.test.ts (same lower-layer mocks).
 */
const settledState = { value: { state: 'open' } as Record<string, unknown> };
jest.mock('../../services/billing/holdSettlementState', () => {
  const actual = jest.requireActual('../../services/billing/holdSettlementState');
  return { ...actual, readHoldSettlementState: jest.fn(async () => settledState.value) };
});
jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn(), from: jest.fn() },
}));

// Force any action through the monetization-registry assertion.
jest.mock('../../../shared/monetization/featureRegistry', () => ({
  resolveMonetizationFeature: (input: { action_key: string }) => ({
    feature_key: 'f',
    action_key: input.action_key,
    pricing_key: 'p',
    feature: { feature_key: 'f', pricing_keys: {} },
  }),
  getFeatureDisplayGroup: () => null,
}));

const repo = {
  callCreditReservation: jest.fn(),
  callCreditPartialConfirm: jest.fn(),
  findCreditTransaction: jest.fn(),
  loadCreditHoldSplit: jest.fn(),
};
jest.mock('../../repositories/creditExecutionRepository', () => repo);

const priority = {
  getTotalAvailable: jest.fn(),
  resolveDeduction: jest.fn(),
};
jest.mock('../../services/creditPriorityService', () => priority);

jest.mock('../../services/orgControlService', () => ({
  preflightCheck: jest.fn(async () => ({ allowed: true })),
  autoBlockLlm: jest.fn(async () => undefined),
}));
jest.mock('../../services/billing/billingPolicyResolver', () => ({
  resolveBillingPolicy: jest.fn(async () => ({})),
}));
jest.mock('../../services/billing/creditSafetyGate', () => ({
  evaluateCreditSafetyGate: jest.fn(() => 'allow'),
}));
jest.mock('../../services/usageTrackingService', () => ({ trackUsage: jest.fn(async () => undefined) }));
// Phase 11C — the engine fire-and-forgets a durable settlement observation;
// stub it so this suite stays hermetic (no real Redis / open handle).
jest.mock('../../services/billing/creditEconomyObservability', () => ({
  recordSettlementObservation: jest.fn(async () => {}),
  recordShadowObservation: jest.fn(async () => {}),
}));
jest.mock('../../services/usageLedgerService', () => ({ logUsageEvent: jest.fn(async () => undefined) }));
jest.mock('../../services/creditAlertService', () => ({ checkCreditAlerts: jest.fn(async () => undefined) }));

// Phase 10B — token-actual settlement resolves cost via pricingService.
const pricing = {
  resolveLlmCost: jest.fn(),
  estimateLlmHoldCredits: jest.fn(),
  recordCostAnomaly: jest.fn(async () => undefined),
};
jest.mock('../../services/pricingService', () => pricing);

import {
  executeWithEntryConsumption,
  planEntryConsumptionSettlement,
  isEntryConsumptionEnabled,
  confirmCreditReservationToActual,
} from '../../services/creditExecutionService';
import { resolveActivityEconomics } from '../../services/activityEconomyCatalog';
import { recordProviderUsage, recordAssetCredits } from '../../services/aiUsageCollector';

const USER = '00000000-0000-4000-8000-000000000001';
const ORG = '00000000-0000-4000-8000-000000000002';
const REF = '00000000-0000-4000-8000-000000000003';
const IDEM = 'idem-key-abc';
const ACTION = 'content_basic'; // SHORT_GENERATION: entry 2, reservation 13, max 15

function holdTotal(call: any): number {
  const s = call.split;
  return (s.free ?? 0) + (s.incentive ?? 0) + (s.paid ?? 0);
}

beforeEach(() => {
  jest.clearAllMocks();
  // wallet has plenty; split mirrors requested credits (single free bucket).
  priority.getTotalAvailable.mockResolvedValue(1_000_000);
  priority.resolveDeduction.mockImplementation(async (_org: string, credits: number) => ({
    wallet: { id: 'w' },
    available: { free: credits, incentive: 0, paid: 0, total: 1_000_000 },
    split: { free: credits, incentive: 0, paid: 0 },
  }));
  // No prior phases exist unless a test overrides.
  repo.findCreditTransaction.mockResolvedValue(null);
  // HOLD/CONFIRM/RELEASE all succeed; id encodes phase+key for assertions.
  repo.callCreditReservation.mockImplementation(async (cmd: any) => ({
    error: null,
    transactionId: `${cmd.phase}:${cmd.idempotencyKey}`,
  }));
  repo.callCreditPartialConfirm.mockResolvedValue({
    error: null,
    data: { id: 'settle-id', total_consumed: 7, total_released: 6 },
  });
});



const runEntry = () => executeWithEntryConsumption({
  userId: USER, orgId: ORG, action: ACTION as any,
  referenceType: 'content', referenceId: REF,
  idempotencyKey: IDEM, validateMembership: false,
  llmPricing: { provider: 'openai', model: 'gpt-4o-mini', actionKey: 'content_basic', maxInputTokens: 1000, maxOutputTokens: 500 },
  collectViaCollector: true,
  executor: async () => { recordProviderUsage(1000, 500); return 'OUTPUT'; },
});
const exposureReleases = () => repo.callCreditReservation.mock.calls
  .filter(([c]: any[]) => c.phase === 'release' && String(c.idempotencyKey).startsWith(`${IDEM}:exposure`)).length;

describe('executeWithEntryConsumption: exposure settle error handling', () => {
  beforeEach(() => {
    pricing.resolveLlmCost.mockResolvedValue({ credits: 9 });
    settledState.value = { state: 'open' };
  });

  it('a settle that COMMITTED despite the error is adopted: executed, no exposure release', async () => {
    repo.callCreditPartialConfirm.mockResolvedValue({ error: { message: 'fetch failed' }, data: null });
    settledState.value = { state: 'confirmed', transactionId: 'settle-committed', creditsSettled: 5 };
    const res: any = await runEntry();
    expect(res.status).toBe('executed');
    expect(res.settlementPending).toBeUndefined();
    // the committed row's amount, not the planned additional (7)
    expect(res.settlement).toMatchObject({ additionalConsumed: 5, totalConsumed: 7 });
    expect(res.settlement.amountsUnknown).toBeUndefined();
    expect(exposureReleases()).toBe(0);
  });

  it('open exposure + definitive DB refusal: released, then raised (old behaviour)', async () => {
    repo.callCreditPartialConfirm.mockResolvedValue({ error: { code: 'P0001', message: 'refused' }, data: null });
    await expect(runEntry()).rejects.toThrow(/exposure settle failed: refused/);
    expect(exposureReleases()).toBe(1);
  });

  it.each([
    ['open + network error', { state: 'open' }, { message: 'socket hang up' }],
    ['state unreadable', { state: 'unreadable', message: 'read failed' }, { code: 'P0001', message: 'refused' }],
    ['already released', { state: 'released', transactionId: 'r' }, { code: 'P0001', message: 'refused' }],
  ])('%s: the work is RETURNED with settlementPending, NO exposure release', async (_n, state, error) => {
    repo.callCreditPartialConfirm.mockResolvedValue({ error, data: null });
    settledState.value = state as Record<string, unknown>;
    const res: any = await runEntry();
    expect(res).toMatchObject({ status: 'executed', result: 'OUTPUT', settlementPending: { code: 'CREDIT_SETTLE_AMBIGUOUS', state: (state as any).state } });
    expect(res.settlement).toMatchObject({ entryConsumed: 2, amountsUnknown: true });
    expect(exposureReleases()).toBe(0);
  });
});
