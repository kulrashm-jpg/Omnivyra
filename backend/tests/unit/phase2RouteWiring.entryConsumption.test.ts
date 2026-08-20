/**
 * Phase 8C — wirePhase2Route engine-selection test.
 *
 * Verifies the central ENFORCE-path switch: the SAME wired route runs through
 * executeWithCredits (default) or executeWithEntryConsumption (when
 * PHASE2_ENTRY_CONSUMPTION=true), and idempotent replay re-runs the work
 * without re-charging. The enforcement gate is mocked to invoke the enforce
 * branch directly, isolating the routing logic.
 */

const engine = {
  executeWithCredits: jest.fn(),
  executeWithEntryConsumption: jest.fn(),
  makeIdempotencyKey: jest.fn(() => 'idem-key'),
  // Phase 10A: the flag helper now lives in creditExecutionService; read env so
  // the existing PHASE2_ENTRY_CONSUMPTION-based test control still works.
  isEntryConsumptionEnabled: () => String(process.env.PHASE2_ENTRY_CONSUMPTION ?? '').toLowerCase() === 'true',
};
jest.mock('../../services/creditExecutionService', () => engine);

// Phase 11B: engine selection now reads the single activation verdict. Mock it
// to the env-driven control the test already uses, isolating the routing logic.
jest.mock('../../services/billing/creditEconomyActivation', () => ({
  getCreditEconomyExecutionMode: async () =>
    (String(process.env.PHASE2_ENTRY_CONSUMPTION ?? '').toLowerCase() === 'true' ? 'enforce' : 'off'),
}));

// Gate runs the enforce branch and surfaces ok/!ok like the real gate.
jest.mock('../../services/billing/phase2EnforcementGate', () => ({
  runWithPhase2Enforcement: async (args: any) => {
    const r = await args.enforce();
    if (!r.ok) throw new Error(`PaymentRequired:${r.reason}`);
    return r.result;
  },
}));
jest.mock('../../services/creditDeductionService', () => ({
  hasEnoughCredits: jest.fn(async () => ({ sufficient: true })),
}));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));

import { wirePhase2Route } from '../../services/billing/phase2RouteWiring';

const ARGS = {
  surface: 'test.surface' as any,
  organizationId: 'org-1',
  userId: 'user-1',
  action: 'content_basic' as any,
  referenceType: 'content',
  referenceId: 'ref-1',
};

const FLAG = 'PHASE2_ENTRY_CONSUMPTION';
// Ambient config must not decide this suite's outcome. `.env.local` is loaded
// into every jest run by backend/tests/setupEnv.ts and sets BOTH of these to
// 'true' for local implementation work, so the default-case test was asserting
// the documented dark default while running with the master switch ON, and the
// shadow emitter was reaching real Redis and outliving the test. Snapshot and
// restore rather than delete: the developer's .env.local stays untouched.
const AMBIENT = ['PHASE2_ENTRY_CONSUMPTION', 'PHASE2_CREDIT_ECONOMY_SHADOW'] as const;
const ORIGINAL_AMBIENT: Record<string, string | undefined> = {};

beforeAll(() => { for (const k of AMBIENT) ORIGINAL_AMBIENT[k] = process.env[k]; });
afterAll(() => {
  for (const k of AMBIENT) {
    if (ORIGINAL_AMBIENT[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINAL_AMBIENT[k];
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of AMBIENT) delete process.env[k];
  engine.executeWithCredits.mockResolvedValue({ status: 'executed', result: 'CREDITS' });
  engine.executeWithEntryConsumption.mockResolvedValue({ status: 'executed', result: 'ENTRY' });
});

// (env restoration is handled by the AMBIENT afterAll above)

describe('wirePhase2Route ENFORCE engine selection', () => {
  it('default (flag unset): uses executeWithCredits (HOLD-MAX), not entry consumption', async () => {
    const run = jest.fn(async () => 'WORK');
    const out = await wirePhase2Route({ ...ARGS, run });
    expect(out).toBe('CREDITS');
    expect(engine.executeWithCredits).toHaveBeenCalledTimes(1);
    expect(engine.executeWithEntryConsumption).not.toHaveBeenCalled();
  });

  it('PHASE2_ENTRY_CONSUMPTION=true: routes the SAME wiring through entry consumption', async () => {
    process.env[FLAG] = 'true';
    const run = jest.fn(async () => 'WORK');
    const out = await wirePhase2Route({ ...ARGS, run });
    expect(out).toBe('ENTRY');
    expect(engine.executeWithEntryConsumption).toHaveBeenCalledTimes(1);
    expect(engine.executeWithCredits).not.toHaveBeenCalled();
    // executor is the route's run, passed through unchanged
    const call = engine.executeWithEntryConsumption.mock.calls[0][0];
    expect(call.action).toBe('content_basic');
    expect(call.executor).toBe(run);
  });

  it('entry-consumption replay (already_settled): re-runs work, no re-charge', async () => {
    process.env[FLAG] = 'true';
    engine.executeWithEntryConsumption.mockResolvedValue({ status: 'already_settled' });
    const run = jest.fn(async () => 'WORK-AGAIN');
    const out = await wirePhase2Route({ ...ARGS, run });
    expect(out).toBe('WORK-AGAIN');
    expect(run).toHaveBeenCalledTimes(1); // re-run to produce the response
  });

  it('insufficient credits surfaces as a blocked enforcement (gate throws)', async () => {
    process.env[FLAG] = 'true';
    engine.executeWithEntryConsumption.mockResolvedValue({ status: 'insufficient_credits', available: 1, required: 15 });
    await expect(wirePhase2Route({ ...ARGS, run: jest.fn() })).rejects.toThrow('PaymentRequired:insufficient_credits');
  });
});
