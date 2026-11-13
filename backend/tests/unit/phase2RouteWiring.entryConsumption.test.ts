/**
 * wirePhase2Route ENFORCE path (e1 2026-11-13; owner pricing ruling + e9 BLOCKING-for-flip).
 *
 * Replaces the Phase-8C engine-selection pins, whose behaviour was REMOVED on purpose:
 *   - "default uses executeWithCredits (fixed)"   -> every billed route now settles TOKEN-ACTUAL (entry consumption,
 *                                                     llmPricing + collectViaCollector), never a fixed price;
 *   - "already_settled re-runs work, no charge"   -> that was a FREE re-run of the AI work for any identical request;
 *                                                     a charged replay is now 409 ALREADY_PROCESSED and run() is NOT
 *                                                     called again.
 * New: the identity is inputs + the client's Idempotency-Key (else the per-request id); a released (failed,
 * uncharged) attempt is reclaimed under the next slot; requests without the header are counted; the STANDARD billed
 * HTTP shape via billedRouteHttpError.
 * The gate is mocked to run the enforce branch directly (the real PaymentRequiredError class is kept).
 */

const engine = {
  executeWithEntryConsumption: jest.fn(),
  makeIdempotencyKey: jest.fn((u: string, a: string, r: string) => `${u}|${a}|${r}`),
};
jest.mock('../../services/creditExecutionService', () => engine);

const mockCtx: { idempotencyKey?: string; requestId?: string } = {};
jest.mock('../../services/requestContext', () => ({ getRequestContext: () => mockCtx }));

jest.mock('../../services/billing/phase2EnforcementGate', () => {
  const actual = jest.requireActual('../../services/billing/phase2EnforcementGate');
  return {
    ...actual,
    runWithPhase2Enforcement: async (args: any) => {
      const r = await args.enforce();
      if (!r.ok) throw new actual.PaymentRequiredError(args.surface, r.reason);
      return r.result;
    },
  };
});
jest.mock('../../services/creditDeductionService', () => ({ hasEnoughCredits: jest.fn(async () => ({ sufficient: true })) }));
const mockCounters: string[] = [];
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: (n: string) => { mockCounters.push(n); } }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));
const mockWarn = jest.fn();
jest.mock('../../services/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a), info: jest.fn(), error: jest.fn() } }));

import {
  wirePhase2Route,
  routeLlmPricingFor,
  BilledRouteAlreadyProcessedError,
  BilledRouteAlreadyReleasedError,
  BilledRoutePaymentRequiredError,
  BilledRoutePricingUnavailableError,
  MAX_ROUTE_RECLAIM_ATTEMPTS,
} from '../../services/billing/phase2RouteWiring';
import { billedRouteHttpError } from '../../services/billing/billedRouteHttpError';
import { PaymentRequiredError } from '../../services/billing/phase2EnforcementGate';

const ARGS = {
  surface: 'test.surface' as any,
  organizationId: 'org-1',
  userId: 'user-1',
  action: 'content_basic' as any,
  referenceType: 'content',
  referenceId: 'ref-1',
};

/** A ledger-faithful fake: one settlement per idempotency key; a key can be pre-marked released. */
const ledger = new Map<string, 'settled' | 'released'>();
let charges = 0;
function faithfulEngine(): void {
  engine.executeWithEntryConsumption.mockImplementation(async (o: any) => {
    const st = ledger.get(o.idempotencyKey);
    if (st === 'settled') return { status: 'already_settled' };
    if (st === 'released') return { status: 'already_released' };
    const result = await o.executor();
    ledger.set(o.idempotencyKey, 'settled');
    charges += 1;
    return { status: 'executed', result };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  ledger.clear(); charges = 0; mockCounters.length = 0;
  delete mockCtx.idempotencyKey; delete mockCtx.requestId;
  faithfulEngine();
});

describe('wirePhase2Route ENFORCE - token-actual, per-request identity, never a free re-run', () => {
  it('settles TOKEN-ACTUAL: entry consumption with llmPricing + collectViaCollector, the route run() as executor', async () => {
    mockCtx.idempotencyKey = 'click-1';
    const run = jest.fn(async () => 'WORK');
    expect(await wirePhase2Route({ ...ARGS, run })).toBe('WORK');
    const call = engine.executeWithEntryConsumption.mock.calls[0][0];
    expect(call).toMatchObject({ action: 'content_basic', collectViaCollector: true, executor: run, orgId: 'org-1' });
    expect(call.llmPricing).toEqual(routeLlmPricingFor('content_basic' as any));
    expect(call.llmPricing.actionKey).toBe('content_basic');
  });

  it('a multi-call unit holds proportionally more (virality = 5 calls, blog = 7)', () => {
    const one = routeLlmPricingFor('content_basic' as any);
    expect(routeLlmPricingFor('insight_generation' as any).maxOutputTokens).toBe(one.maxOutputTokens * 5);
    expect(routeLlmPricingFor('blog_generation' as any).maxInputTokens).toBe(one.maxInputTokens * 7);
  });

  it('the SAME Idempotency-Key twice: the 2nd is 409 ALREADY_PROCESSED - no AI call, no second charge', async () => {
    mockCtx.idempotencyKey = 'click-1';
    const run = jest.fn(async () => 'WORK');
    await wirePhase2Route({ ...ARGS, run });
    await expect(wirePhase2Route({ ...ARGS, run })).rejects.toBeInstanceOf(BilledRouteAlreadyProcessedError);
    expect(run).toHaveBeenCalledTimes(1);
    expect(charges).toBe(1);
    expect(billedRouteHttpError(new BilledRouteAlreadyProcessedError('s' as any))).toMatchObject({ status: 409, body: { code: 'ALREADY_PROCESSED' } });
  });

  it('two DELIBERATE identical requests (different Idempotency-Keys) are charged twice - never a free regeneration', async () => {
    const run = jest.fn(async () => 'WORK');
    mockCtx.idempotencyKey = 'click-1';
    await wirePhase2Route({ ...ARGS, run });
    mockCtx.idempotencyKey = 'click-2';
    await wirePhase2Route({ ...ARGS, run });
    expect(run).toHaveBeenCalledTimes(2);
    expect(charges).toBe(2);
  });

  it('WITHOUT a header every request is a new charge (per-request id) and is counted + logged', async () => {
    const run = jest.fn(async () => 'WORK');
    mockCtx.requestId = 'req-A';
    await wirePhase2Route({ ...ARGS, run });
    mockCtx.requestId = 'req-B';
    await wirePhase2Route({ ...ARGS, run });
    expect(charges).toBe(2);
    expect(mockCounters.filter((c) => c === 'phase2_route_without_idempotency_key_total')).toHaveLength(2);
    expect(mockWarn).toHaveBeenCalledWith('phase2_route_without_idempotency_key', expect.objectContaining({ surface: 'test.surface' }));
  });

  it('a RELEASED (failed, uncharged) attempt is reclaimed: the retry runs and is charged ONCE', async () => {
    mockCtx.idempotencyKey = 'click-1';
    const first = engine.makeIdempotencyKey('user-1', 'content_basic', 'ref-1:k:' + require('crypto').createHash('sha256').update('click-1').digest('hex').slice(0, 24));
    ledger.set(first, 'released');
    const run = jest.fn(async () => 'WORK');
    expect(await wirePhase2Route({ ...ARGS, run })).toBe('WORK');
    expect(run).toHaveBeenCalledTimes(1);
    expect(charges).toBe(1);
    expect(engine.executeWithEntryConsumption.mock.calls[1][0].referenceId).toMatch(/:r1$/);
  });

  it(`after ${MAX_ROUTE_RECLAIM_ATTEMPTS} released slots: 409 ALREADY_RELEASED, nothing run`, async () => {
    engine.executeWithEntryConsumption.mockResolvedValue({ status: 'already_released' });
    const run = jest.fn();
    await expect(wirePhase2Route({ ...ARGS, run })).rejects.toBeInstanceOf(BilledRouteAlreadyReleasedError);
    expect(run).not.toHaveBeenCalled();
    expect(engine.executeWithEntryConsumption).toHaveBeenCalledTimes(MAX_ROUTE_RECLAIM_ATTEMPTS);
  });

  it('insufficient credits: 402 INSUFFICIENT_CREDITS with required + balance (still a PaymentRequiredError)', async () => {
    engine.executeWithEntryConsumption.mockResolvedValue({ status: 'insufficient_credits', available: 1, required: 15 });
    const err = await wirePhase2Route({ ...ARGS, run: jest.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequiredError);
    expect(billedRouteHttpError(err)).toEqual({ status: 402, body: { error: expect.any(String), code: 'INSUFFICIENT_CREDITS', required: 15, balance: 1 } });
  });

  it('no credit account: 402 NO_CREDIT_ACCOUNT', async () => {
    engine.executeWithEntryConsumption.mockResolvedValue({ status: 'no_credit_account' });
    const err = await wirePhase2Route({ ...ARGS, run: jest.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(BilledRoutePaymentRequiredError);
    expect(billedRouteHttpError(err)).toMatchObject({ status: 402, body: { code: 'NO_CREDIT_ACCOUNT' } });
  });

  it('missing pricing: 503 PRICING_UNAVAILABLE (a configuration gap, never "top up"), nothing run', async () => {
    const pm = Object.assign(new Error("No active pricing for provider='openai' model='x' kind='llm'."), { name: 'PricingMissingError' });
    engine.executeWithEntryConsumption.mockRejectedValue(pm);
    const run = jest.fn();
    const err = await wirePhase2Route({ ...ARGS, run }).catch((e) => e);
    expect(err).toBeInstanceOf(BilledRoutePricingUnavailableError);
    expect(billedRouteHttpError(err)).toMatchObject({ status: 503, body: { code: 'PRICING_UNAVAILABLE' } });
    expect(run).not.toHaveBeenCalled();
  });

  it('control: an unrelated error is NOT mapped (the route keeps its own handling)', () => {
    expect(billedRouteHttpError(new Error('boom'))).toBeNull();
  });
});
