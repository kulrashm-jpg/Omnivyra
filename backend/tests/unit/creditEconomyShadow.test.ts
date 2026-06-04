/**
 * Phase 8E — credit-economy shadow adoption tests.
 *
 * Verifies: dark no-op when flag off, correct shadow event payload + counters
 * when on, never-throws on unknown activity, and the dashboard aggregator
 * (would_block count, average shortfall, most-blocked, most-expensive).
 * getWalletSnapshot is mocked; economics come from the real Phase 8A catalog.
 */

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));

const priority = { getWalletSnapshot: jest.fn() };
jest.mock('../../services/creditPriorityService', () => priority);

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../services/logger', () => ({ logger }));

// Phase 11C: the durable mirror is fire-and-forget; stub it so this suite stays
// hermetic (no real Redis connection / open handle).
const obs = { recordShadowObservation: jest.fn(async () => {}) };
jest.mock('../../services/billing/creditEconomyObservability', () => obs);

import {
  emitCreditEconomyShadowEvaluation,
  snapshotCreditEconomyShadow,
  isCreditEconomyShadowEnabled,
  _resetCreditEconomyShadowForTests,
} from '../../services/billing/creditEconomyShadow';
import { getCounter, _resetBillingMetricsForTests } from '../../services/billing/billingMetrics';

const ORG = 'org-1';
const FLAG = 'PHASE2_CREDIT_ECONOMY_SHADOW';

function wallet(free: number, paid = 0, incentive = 0, rFree = 0, rPaid = 0, rInc = 0) {
  return {
    free_balance: free, paid_balance: paid, incentive_balance: incentive,
    reserved_free: rFree, reserved_paid: rPaid, reserved_incentive: rInc,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetBillingMetricsForTests();
  _resetCreditEconomyShadowForTests();
  delete process.env[FLAG];
});
afterAll(() => { delete process.env[FLAG]; });

describe('dark by default (no production behavior change)', () => {
  it('flag default OFF', () => {
    expect(isCreditEconomyShadowEnabled()).toBe(false);
  });

  it('OFF → no-op: no wallet read, no event, no counters, empty aggregator', async () => {
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic' });
    expect(priority.getWalletSnapshot).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith('credit_economy_shadow_evaluation', expect.anything());
    expect(getCounter('credit_economy_shadow_would_allow')).toBe(0);
    expect(getCounter('credit_economy_shadow_would_block')).toBe(0);
    expect(snapshotCreditEconomyShadow().totalEvaluations).toBe(0);
  });
});

describe('shadow event payload (TASK 4) when enabled', () => {
  beforeEach(() => { process.env[FLAG] = 'true'; });

  it('would_allow: emits full economy payload + counter', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic', surface: 'test' });

    expect(getCounter('credit_economy_shadow_would_allow')).toBe(1);
    expect(getCounter('credit_economy_shadow_would_block')).toBe(0);
    const call = logger.info.mock.calls.find((c) => c[0] === 'credit_economy_shadow_evaluation');
    expect(call).toBeTruthy();
    expect(call![1]).toMatchObject({
      organizationId: ORG,
      activity: 'content_basic',
      activityClass: 'SHORT_GENERATION',
      entryConsumption: 2,
      maximumCredits: 15,
      reservationCredits: 13,
      effectiveCredits: 100,
      requiredCredits: 15,
      wouldBlock: false,
      shortfall: 0,
    });
  });

  it('would_block: counter + shortfall captured', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(5));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic' });
    expect(getCounter('credit_economy_shadow_would_block')).toBe(1);
    const call = logger.info.mock.calls.find((c) => c[0] === 'credit_economy_shadow_evaluation');
    expect(call![1]).toMatchObject({ wouldBlock: true, effectiveCredits: 5, requiredCredits: 15, shortfall: 10 });
  });

  it('never throws on unknown activity (best-effort)', async () => {
    await expect(emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'not_real' })).resolves.toBeUndefined();
    expect(getCounter('credit_economy_shadow_would_allow')).toBe(0);
    expect(getCounter('credit_economy_shadow_would_block')).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith('credit_economy_shadow_eval_failed', expect.anything());
  });
});

describe('dashboard aggregation (TASK 5)', () => {
  beforeEach(() => { process.env[FLAG] = 'true'; });

  it('computes would_block count, average shortfall, most-blocked, most-expensive', async () => {
    // content_basic (max 15): blocked twice (effective 5 → shortfall 10; effective 3 → shortfall 12)
    priority.getWalletSnapshot.mockResolvedValueOnce(wallet(5));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic' });
    priority.getWalletSnapshot.mockResolvedValueOnce(wallet(3));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic' });
    // campaign_generation (AUTOMATION max 120): blocked once (effective 0 → shortfall 120)
    priority.getWalletSnapshot.mockResolvedValueOnce(wallet(0));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'campaign_generation' });
    // ai_reply (REPLY max 3): allowed (effective 50)
    priority.getWalletSnapshot.mockResolvedValueOnce(wallet(50));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'ai_reply' });

    const snap = snapshotCreditEconomyShadow();
    expect(snap.totalEvaluations).toBe(4);
    expect(snap.wouldBlockCount).toBe(3);
    expect(snap.averageShortfall).toBeCloseTo((10 + 12 + 120) / 3, 5);
    // most blocked: content_basic (2) before campaign_generation (1)
    expect(snap.mostBlockedActivities[0]).toMatchObject({ activity: 'content_basic', wouldBlock: 2 });
    // most expensive: campaign_generation (120) first
    expect(snap.mostExpensiveActivities[0]).toMatchObject({ activity: 'campaign_generation', maximumCredits: 120 });
  });
});

describe('duplicate protection (TASK 4 — exactly one per launch)', () => {
  beforeEach(() => { process.env[FLAG] = 'true'; });

  it('same dedupeKey emits exactly once', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic', dedupeKey: 'launch-1' });
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic', dedupeKey: 'launch-1' });
    expect(getCounter('credit_economy_shadow_would_allow')).toBe(1);
    expect(snapshotCreditEconomyShadow().totalEvaluations).toBe(1);
  });

  it('distinct dedupeKeys (distinct launches) each emit', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic', dedupeKey: 'launch-1' });
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic', dedupeKey: 'launch-2' });
    expect(getCounter('credit_economy_shadow_would_allow')).toBe(2);
    expect(snapshotCreditEconomyShadow().totalEvaluations).toBe(2);
  });

  it('no dedupeKey → not deduped (legacy hook behavior preserved)', async () => {
    priority.getWalletSnapshot.mockResolvedValue(wallet(100));
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic' });
    await emitCreditEconomyShadowEvaluation({ organizationId: ORG, activity: 'content_basic' });
    expect(getCounter('credit_economy_shadow_would_allow')).toBe(2);
  });
});
