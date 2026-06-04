/**
 * Phase 8B — entry-consumption orchestration unit tests.
 *
 * Two layers:
 *   1. planEntryConsumptionSettlement — pure settlement arithmetic (TASK 4).
 *   2. executeWithEntryConsumption — the real composition over the certified
 *      primitives, with the repository + service layer mocked so we can assert
 *      the exact phase sequence (CONSUME entry → HOLD exposure → settle / release)
 *      without a database.
 *
 * We mock the LOWER layer (repository RPC wrappers + wallet/gate services), NOT
 * the reservation functions themselves — so the test exercises the genuine
 * reserveCreditsForWork → callCreditReservation composition.
 */

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

describe('isEntryConsumptionEnabled (Phase 10A adoption flag)', () => {
  const FLAG = 'PHASE2_ENTRY_CONSUMPTION';
  afterEach(() => { delete process.env[FLAG]; });
  it('default OFF', () => { delete process.env[FLAG]; expect(isEntryConsumptionEnabled()).toBe(false); });
  it('true → ON', () => { process.env[FLAG] = 'true'; expect(isEntryConsumptionEnabled()).toBe(true); });
  it('other values → OFF', () => { process.env[FLAG] = '1'; expect(isEntryConsumptionEnabled()).toBe(false); });
});

describe('planEntryConsumptionSettlement (TASK 4 arithmetic)', () => {
  it('actual within band: additional = actual − entry, release the rest', () => {
    expect(planEntryConsumptionSettlement({ entry: 10, reservation: 50, actualCredits: 34 }))
      .toEqual({ additionalConsumption: 24, exposureReleased: 26, underfunded: false });
  });

  it('actual below entry: no additional draw, full exposure released', () => {
    expect(planEntryConsumptionSettlement({ entry: 10, reservation: 50, actualCredits: 6 }))
      .toEqual({ additionalConsumption: 0, exposureReleased: 50, underfunded: false });
  });

  it('actual at exactly max (entry+reservation): consume all exposure, release 0', () => {
    expect(planEntryConsumptionSettlement({ entry: 10, reservation: 50, actualCredits: 60 }))
      .toEqual({ additionalConsumption: 50, exposureReleased: 0, underfunded: false });
  });

  it('actual exceeds max: clamp to exposure, flag underfunded', () => {
    expect(planEntryConsumptionSettlement({ entry: 10, reservation: 50, actualCredits: 80 }))
      .toEqual({ additionalConsumption: 50, exposureReleased: 0, underfunded: true });
  });

  it('matches the catalog envelope for every shape (release never negative)', () => {
    const e = resolveActivityEconomics(ACTION);
    const plan = planEntryConsumptionSettlement({ entry: e.entryConsumption, reservation: e.reservationCredits, actualCredits: 9 });
    expect(plan.additionalConsumption).toBe(9 - e.entryConsumption);
    expect(plan.exposureReleased).toBe(e.reservationCredits - (9 - e.entryConsumption));
    expect(plan.exposureReleased).toBeGreaterThanOrEqual(0);
  });
});

describe('executeWithEntryConsumption — happy path (fixed action)', () => {
  it('CONSUMES entry, HOLDS exposure, settles actual−entry, releases remainder', async () => {
    const executor = jest.fn(async () => 'OUTPUT');
    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any,
      referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      amountOverride: 9, // actual cost = 9 credits
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('executed');
    if (res.status !== 'executed') throw new Error('unreachable');
    expect(res.result).toBe('OUTPUT');
    expect(res.settlement).toMatchObject({
      entryConsumed: 2,
      exposureReserved: 13,
      additionalConsumed: 7,   // from mocked partial_confirm total_consumed
      exposureReleased: 6,
      totalConsumed: 9,
      underfunded: false,
    });

    const reservations = repo.callCreditReservation.mock.calls.map((c) => c[0]);
    // 1) entry HOLD(2)
    const entryHold = reservations.find((r) => r.idempotencyKey === `${IDEM}:entry:hold`);
    expect(entryHold).toBeTruthy();
    expect(entryHold.phase).toBe('hold');
    expect(holdTotal(entryHold)).toBe(2);
    // 2) entry CONFIRM (parent = entry hold) — non-refundable consumption
    const entryConfirm = reservations.find((r) => r.idempotencyKey === `${IDEM}:entry:confirm`);
    expect(entryConfirm).toBeTruthy();
    expect(entryConfirm.phase).toBe('confirm');
    expect(entryConfirm.parentId).toBe('hold:' + `${IDEM}:entry:hold`);
    // 3) exposure HOLD(13)
    const exposureHold = reservations.find((r) => r.idempotencyKey === `${IDEM}:exposure:hold`);
    expect(exposureHold).toBeTruthy();
    expect(exposureHold.phase).toBe('hold');
    expect(holdTotal(exposureHold)).toBe(13);
    // No entry RELEASE ever (entry is non-refundable).
    expect(reservations.some((r) => r.idempotencyKey === `${IDEM}:entry:release`)).toBe(false);

    // 4) settlement via partial_confirm on the exposure hold, actual−entry = 7
    expect(repo.callCreditPartialConfirm).toHaveBeenCalledTimes(1);
    const settle = repo.callCreditPartialConfirm.mock.calls[0][0];
    expect(settle.holdTxnId).toBe('hold:' + `${IDEM}:exposure:hold`);
    expect(settle.idempotencyKey).toBe(`${IDEM}:exposure:confirm`);
    const settleTotal = settle.actualSplit.free + settle.actualSplit.incentive + settle.actualSplit.paid;
    expect(settleTotal).toBe(7);
  });
});

describe('executeWithEntryConsumption — token-metered settlement (Phase 10B / M2, engine-collected)', () => {
  it('settles token-ACTUAL from the engine-collected scope usage, releasing unused exposure', async () => {
    pricing.resolveLlmCost.mockResolvedValue({ credits: 9 }); // actual token cost = 9
    // Phase 12E — the executor records provider usage into the engine's scope.
    const executor = jest.fn(async () => { recordProviderUsage(1000, 500); return 'OUTPUT'; });

    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any,
      referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      llmPricing: { provider: 'openai', model: 'gpt-4o-mini', actionKey: 'content_basic', maxInputTokens: 1000, maxOutputTokens: 500 },
      collectViaCollector: true,
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(1);
    // cost resolved from the ACTUAL collected tokens (not max/estimate)
    expect(pricing.resolveLlmCost).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 1000, outputTokens: 500, actionKey: 'content_basic' }),
    );
    expect(res.status).toBe('executed');
    if (res.status !== 'executed') throw new Error('unreachable');
    // SHORT_GENERATION entry 2; actual 9 → additional 7 (from partial_confirm mock), release 6
    expect(res.settlement).toMatchObject({ entryConsumed: 2, additionalConsumed: 7, exposureReleased: 6, underfunded: false });
    expect(repo.callCreditPartialConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('confirmCreditReservationToActual (Phase 10F — reports settlement)', () => {
  const handle = {
    orgId: ORG, userId: USER, action: 'full_strategy' as any,
    referenceType: 'report', referenceId: REF, idempotencyKey: 'rep-idem',
    holdTransactionId: 'hold-1', creditsReserved: 13,
    split: { free: 13, incentive: 0, paid: 0 },
  };

  it('settles a HOLD reservation to ACTUAL credits via partial-confirm (releases remainder)', async () => {
    repo.findCreditTransaction.mockResolvedValue(null);
    repo.callCreditPartialConfirm.mockResolvedValue({ error: null, data: { id: 'pc', total_consumed: 5, total_released: 8 } });

    const r = await confirmCreditReservationToActual(handle, 5); // actual token cost = 5 (held 13)

    const arg = repo.callCreditPartialConfirm.mock.calls[0][0];
    expect(arg.holdTxnId).toBe('hold-1');
    expect(arg.idempotencyKey).toBe('rep-idem:confirm'); // same confirm key as flat confirm → replay-safe
    const total = arg.actualSplit.free + arg.actualSplit.incentive + arg.actualSplit.paid;
    expect(total).toBe(5); // scaled to actual, not the full 13
    expect(r).toEqual({ status: 'confirmed', confirmTransactionId: 'pc', creditsCharged: 5 });
  });

  it('is idempotent: already-settled reservation is not re-confirmed', async () => {
    repo.findCreditTransaction.mockImplementation(async (key: string) => (key === 'rep-idem:confirm' ? { id: 'x' } : null));
    const r = await confirmCreditReservationToActual(handle, 5);
    expect(r).toEqual({ status: 'already_confirmed' });
    expect(repo.callCreditPartialConfirm).not.toHaveBeenCalled();
  });
});

describe('executeWithEntryConsumption — text + asset settlement (Phase 10E)', () => {
  it('adds asset credits (additionalCredits) to token-priced settlement', async () => {
    pricing.resolveLlmCost.mockResolvedValue({ credits: 4 });      // text cost = 4
    repo.callCreditPartialConfirm.mockResolvedValue({ error: null, data: { id: 's', total_consumed: 7, total_released: 6 } });
    // Phase 12E — text tokens + asset credits both recorded into the engine scope.
    const executor = jest.fn(async () => { recordProviderUsage(1000, 500); recordAssetCredits(5); return 'CREATOR'; });

    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any,
      referenceType: 'creator_content_job', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      llmPricing: { provider: 'openai', model: 'gpt-4o-mini', actionKey: 'content_basic', maxInputTokens: 1000, maxOutputTokens: 500 },
      collectViaCollector: true,
      executor,
    });

    expect(res.status).toBe('executed');
    // actual = text(4) + assets(5) = 9; SHORT_GENERATION entry 2 → additional 7
    // (if assets were NOT added, actual would be 4 → additional 2)
    const settle = repo.callCreditPartialConfirm.mock.calls[0][0];
    const settleTotal = settle.actualSplit.free + settle.actualSplit.incentive + settle.actualSplit.paid;
    expect(settleTotal).toBe(7);
  });
});

describe('executeWithEntryConsumption — asset activity (Phase 10D / M3)', () => {
  it('settles image_generation actual asset cost via amountOverride (existing primitives)', async () => {
    // resolveAssetActivityEconomics would yield actualCredits=3 for 3 images.
    repo.callCreditPartialConfirm.mockResolvedValue({ error: null, data: { id: 'settle-id', total_consumed: 1, total_released: 9 } });
    const executor = jest.fn(async () => 'IMG');

    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: 'image_generation' as any,
      referenceType: 'creator_asset', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      amountOverride: 3, // actual asset cost from the cost profile
      executor,
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('executed');
    if (res.status !== 'executed') throw new Error('unreachable');
    // IMAGE_GENERATION: entry 2, exposure (max 12 − 2) = 10; actual 3 → additional 1, release 9
    expect(res.settlement).toMatchObject({
      entryConsumed: 2, exposureReserved: 10, additionalConsumed: 1, exposureReleased: 9, underfunded: false,
    });
  });
});

describe('executeWithEntryConsumption — abandonment before any consumable event (Phase 12E)', () => {
  it('fixed activity throws BEFORE a provider call → entry NOT consumed, exposure released, charge 0', async () => {
    const executor = jest.fn(async () => { throw new Error('executor exploded'); }); // no recordProviderUsage

    await expect(executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any,
      referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      amountOverride: 9,
      executor,
    })).rejects.toThrow('executor exploded');

    const reservations = repo.callCreditReservation.mock.calls.map((c) => c[0]);
    // entry was NEVER consumed (no consumable event occurred)
    expect(reservations.some((r) => r.idempotencyKey === `${IDEM}:entry:hold`)).toBe(false);
    expect(reservations.some((r) => r.idempotencyKey === `${IDEM}:entry:confirm`)).toBe(false);
    // exposure was held then RELEASED
    const exposureRelease = reservations.find((r) => r.idempotencyKey === `${IDEM}:exposure:release`);
    expect(exposureRelease).toBeTruthy();
    expect(exposureRelease.phase).toBe('release');
    // never settled
    expect(repo.callCreditPartialConfirm).not.toHaveBeenCalled();
  });
});

describe('executeWithEntryConsumption — Phase 12E first-consumable entry trigger', () => {
  const LLM = { provider: 'openai', model: 'gpt-4o-mini', actionKey: 'content_basic', maxInputTokens: 1000, maxOutputTokens: 500 } as const;

  it('A. provider call occurs → entry consumed exactly once (even across multiple calls)', async () => {
    pricing.resolveLlmCost.mockResolvedValue({ credits: 9 });
    const executor = jest.fn(async () => { recordProviderUsage(500, 200); recordProviderUsage(300, 100); return 'OK'; });
    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any, referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false, llmPricing: LLM, collectViaCollector: true, executor,
    });
    expect(res.status).toBe('executed');
    if (res.status === 'executed') expect(res.settlement.entryConsumed).toBe(2);
    const entryConfirms = repo.callCreditReservation.mock.calls.map((c) => c[0]).filter((r) => r.idempotencyKey === `${IDEM}:entry:confirm`);
    expect(entryConfirms.length).toBe(1); // consumed ONCE despite two provider calls
  });

  it('B. validation failure BEFORE provider call → NO entry consumed, exposure released, no settlement', async () => {
    const executor = jest.fn(async () => { throw new Error('validation failed'); }); // never reaches a provider
    await expect(executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any, referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false, llmPricing: LLM, collectViaCollector: true, executor,
    })).rejects.toThrow('validation failed');
    const calls = repo.callCreditReservation.mock.calls.map((c) => c[0]);
    expect(calls.some((r) => r.idempotencyKey === `${IDEM}:entry:confirm`)).toBe(false);
    expect(calls.some((r) => r.idempotencyKey === `${IDEM}:entry:hold`)).toBe(false);
    expect(calls.some((r) => r.idempotencyKey === `${IDEM}:exposure:release` && r.phase === 'release')).toBe(true);
    expect(repo.callCreditPartialConfirm).not.toHaveBeenCalled();
  });

  it('C. abandonment AFTER a provider call → entry KEPT, exposure released', async () => {
    const executor = jest.fn(async () => { recordProviderUsage(300, 100); throw new Error('boom after provider'); });
    await expect(executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any, referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false, llmPricing: LLM, collectViaCollector: true, executor,
    })).rejects.toThrow('boom after provider');
    const calls = repo.callCreditReservation.mock.calls.map((c) => c[0]);
    expect(calls.some((r) => r.idempotencyKey === `${IDEM}:entry:confirm` && r.phase === 'confirm')).toBe(true); // entry kept
    expect(calls.some((r) => r.idempotencyKey === `${IDEM}:entry:release`)).toBe(false);
    expect(calls.some((r) => r.idempotencyKey === `${IDEM}:exposure:release`)).toBe(true);
    expect(repo.callCreditPartialConfirm).not.toHaveBeenCalled();
  });

  it('D. replay (exposure already settled) → no re-execution, no duplicate charge', async () => {
    repo.findCreditTransaction.mockImplementation(async (key: string) => (key === `${IDEM}:exposure:confirm` ? { id: 'prior' } : null));
    const executor = jest.fn(async () => { recordProviderUsage(100, 50); return 'X'; });
    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any, referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false, llmPricing: LLM, collectViaCollector: true, executor,
    });
    expect(res.status).toBe('already_settled');
    expect(executor).not.toHaveBeenCalled();
    expect(repo.callCreditReservation).not.toHaveBeenCalled();
  });

  it('E. settlement math unchanged — token-actual = entry + (actual−entry), release remainder', async () => {
    pricing.resolveLlmCost.mockResolvedValue({ credits: 9 });
    repo.callCreditPartialConfirm.mockResolvedValue({ error: null, data: { id: 's', total_consumed: 7, total_released: 6 } });
    const executor = jest.fn(async () => { recordProviderUsage(1000, 500); return 'OK'; });
    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any, referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false, llmPricing: LLM, collectViaCollector: true, executor,
    });
    if (res.status !== 'executed') throw new Error('unreachable');
    expect(res.settlement).toMatchObject({ entryConsumed: 2, additionalConsumed: 7, exposureReleased: 6, totalConsumed: 9, underfunded: false });
  });
});

describe('executeWithEntryConsumption — replay (TASK 6)', () => {
  it('does not re-execute when exposure already settled', async () => {
    repo.findCreditTransaction.mockImplementation(async (key: string) =>
      key === `${IDEM}:exposure:confirm` ? { id: 'prior-settle', execution_phase: 'confirm' } : null,
    );
    const executor = jest.fn(async () => 'OUTPUT');

    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any,
      referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      amountOverride: 9,
      executor,
    });

    expect(res.status).toBe('already_settled');
    expect(executor).not.toHaveBeenCalled();
    expect(repo.callCreditReservation).not.toHaveBeenCalled();
    expect(repo.callCreditPartialConfirm).not.toHaveBeenCalled();
  });
});

describe('executeWithEntryConsumption — admission control (Phase 8 TASK 2)', () => {
  it('blocks when effective balance < MAX exposure, consuming nothing', async () => {
    priority.getTotalAvailable.mockResolvedValue(5); // < max (15)
    const executor = jest.fn(async () => 'OUTPUT');

    const res = await executeWithEntryConsumption({
      userId: USER, orgId: ORG, action: ACTION as any,
      referenceType: 'content', referenceId: REF,
      idempotencyKey: IDEM, validateMembership: false,
      amountOverride: 9,
      executor,
    });

    expect(res.status).toBe('insufficient_credits');
    if (res.status === 'insufficient_credits') expect(res.required).toBe(15);
    expect(executor).not.toHaveBeenCalled();
    expect(repo.callCreditReservation).not.toHaveBeenCalled();
  });
});
