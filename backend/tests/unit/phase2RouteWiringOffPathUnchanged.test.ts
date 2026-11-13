/**
 * PIN (e1 2026-11-13; 83/e9 release condition for fix/phase2-route-wiring-token-actual): with enforcement OFF the
 * reshaped wirePhase2Route behaves exactly as before - run() executes on EVERY request (a repeated request with the
 * same Idempotency-Key is NOT turned into a 409), the response is run()'s own, and the billing engine is never
 * called (no hold, no ledger write, no idempotency write). Uses the REAL enforcement gate, OFF by default (no
 * force/shadow env, the per-org canary flag false).
 */
const mockEngine = { executeWithEntryConsumption: jest.fn(), makeIdempotencyKey: jest.fn(() => 'k') };
jest.mock('../../services/creditExecutionService', () => mockEngine);
const mockCtx: { idempotencyKey?: string; requestId?: string } = { idempotencyKey: 'click-1', requestId: 'req-1' };
jest.mock('../../services/requestContext', () => ({ getRequestContext: () => mockCtx }));
jest.mock('../../services/billing/billingFeatureFlags', () => ({
  ...jest.requireActual('../../services/billing/billingFeatureFlags'),
  isBillingFlagEnabled: jest.fn(async () => ({ enabled: false })),
}));
jest.mock('../../services/creditDeductionService', () => ({ hasEnoughCredits: jest.fn(async () => ({ sufficient: true })) }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));
const mockAnomaly = jest.fn();
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: (a: unknown) => mockAnomaly(a) }));
jest.mock('../../services/logger', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() } }));

import { wirePhase2Route } from '../../services/billing/phase2RouteWiring';

const ENV = ['PHASE2_BILLING_KILL_SWITCH', 'PHASE2_BILLING_FORCE_ENFORCE', 'PHASE2_BILLING_SHADOW', 'PHASE2_BILLING_SHADOW_DEFAULT'] as const;
const saved: Record<string, string | undefined> = {};
beforeAll(() => { for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k]; } });
afterAll(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

it('OFF: a repeated request (same Idempotency-Key) runs BOTH times with run()\'s own response - no 409, no engine call', async () => {
  const run = jest.fn(async () => ({ answer: 42 }));
  const args = { surface: 'pin.off' as any, organizationId: 'org-1', userId: 'u-1', action: 'content_basic' as any, referenceType: 'pin', referenceId: 'ref-1', run };
  const a = await wirePhase2Route(args);
  const b = await wirePhase2Route(args);
  expect(a).toEqual({ answer: 42 });
  expect(b).toEqual({ answer: 42 });
  expect(run).toHaveBeenCalledTimes(2);
  expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();  // no hold / ledger / idempotency write
  expect(mockAnomaly).not.toHaveBeenCalled();
});

it('OFF: an error from run() propagates unchanged (not mapped to a billing refusal)', async () => {
  const boom = new Error('route failure');
  const run = jest.fn(async () => { throw boom; });
  await expect(wirePhase2Route({ surface: 'pin.off' as any, organizationId: 'org-1', action: 'content_basic' as any, referenceType: 'pin', referenceId: 'ref-2', run })).rejects.toBe(boom);
  expect(mockEngine.executeWithEntryConsumption).not.toHaveBeenCalled();
});

it('positive control: the SAME harness with PHASE2_BILLING_FORCE_ENFORCE=true DOES reach the billing engine (the OFF pins are not vacuous)', async () => {
  process.env.PHASE2_BILLING_FORCE_ENFORCE = 'true';
  try {
    mockEngine.executeWithEntryConsumption.mockResolvedValueOnce({ status: 'executed', result: { answer: 1 } });
    const out = await wirePhase2Route({ surface: 'pin.on' as any, organizationId: 'org-1', userId: 'u-1', action: 'content_basic' as any, referenceType: 'pin', referenceId: 'ref-3', run: jest.fn() });
    expect(out).toEqual({ answer: 1 });
    expect(mockEngine.executeWithEntryConsumption).toHaveBeenCalledTimes(1);
  } finally {
    delete process.env.PHASE2_BILLING_FORCE_ENFORCE;
  }
});
