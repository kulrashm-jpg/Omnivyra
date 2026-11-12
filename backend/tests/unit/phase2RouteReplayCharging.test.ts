/**
 * Replay under-charge fix (2026-11-12, e9 ruling; enforce go-live gate).
 * Content-hash referenceIds + "replay = re-run free" let (a) a retry after a
 * FAILED attempt and (b) any later identical request run FREE forever.
 *
 * The engine fake keeps per-KEY ledger state like executeWithCredits does:
 * an executor error releases the hold and rethrows; a later call on a
 * released key returns already_released; a confirmed key returns
 * already_confirmed. Charges are counted per confirm.
 *
 * The fake models TWO of the engine's three per-key states (05): confirmed and
 * released. The third - an orphaned HOLD (process died between hold and
 * settle) - is neither; executeWithCredits reuses that hold and executes
 * (RuntimeCore :183), the status is never already_released, so the attempt
 * loop does not advance and exactly one charge results. No case needed.
 */
const ledger = new Map<string, 'confirmed' | 'released'>();
let charges = 0;
async function fakeExecute(opts: { idempotencyKey: string; executor: () => Promise<unknown> }) {
  const st = ledger.get(opts.idempotencyKey);
  if (st === 'confirmed') return { status: 'already_confirmed' };
  if (st === 'released') return { status: 'already_released' };
  try {
    const result = await opts.executor();
    ledger.set(opts.idempotencyKey, 'confirmed');
    charges += 1;
    return { status: 'executed', result };
  } catch (e) {
    ledger.set(opts.idempotencyKey, 'released');
    throw e;
  }
}
const engine = {
  executeWithCredits: jest.fn(fakeExecute),
  executeWithEntryConsumption: jest.fn(async (o: any) => {
    const r: any = await fakeExecute(o);
    return r.status === 'already_confirmed' ? { status: 'already_settled' } : r;
  }),
  makeIdempotencyKey: (...parts: string[]) => parts.join(':'),
};
jest.mock('../../services/creditExecutionService', () => engine);
let mockEcMode = 'off';
jest.mock('../../services/billing/creditEconomyActivation', () => ({ getCreditEconomyExecutionMode: async () => mockEcMode }));
jest.mock('../../services/billing/phase2EnforcementGate', () => ({
  runWithPhase2Enforcement: async (args: any) => {
    const r = await args.enforce();
    if (!r.ok) throw new Error(`PaymentRequired:${r.reason}`);
    return r.result;
  },
}));
jest.mock('../../services/creditDeductionService', () => ({ hasEnoughCredits: jest.fn(async () => ({ sufficient: true })) }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../services/billing/creditEconomyShadow', () => ({ emitCreditEconomyShadowEvaluation: jest.fn(async () => undefined) }));
jest.mock('../../services/billing/admissionControl', () => ({ evaluateActivityAdmission: jest.fn(async () => undefined) }));

import { wirePhase2Route, REPLAY_WINDOW_MS, MAX_ATTEMPTS_PER_WINDOW } from '../../services/billing/phase2RouteWiring';

const ARGS = { surface: 's' as any, organizationId: 'org-1', userId: 'user-1', action: 'campaign_chat' as any, referenceType: 'campaign_chat', referenceId: 'content-hash-1' };
const T0 = Date.parse('2026-11-12T10:00:00Z');
let now = T0;
let nowSpy: jest.SpyInstance;
beforeEach(() => {
  ledger.clear(); charges = 0; now = T0; mockEcMode = 'off';
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => nowSpy.mockRestore());

const ok = () => jest.fn(async () => 'OUT');
const boom = () => jest.fn(async () => { throw new Error('provider down'); });

describe.each(['off', 'enforce'])('engine=%s', (mode) => {
  beforeEach(() => { mockEcMode = mode; });

  it('(a) a failed attempt then a success charges EXACTLY once', async () => {
    await expect(wirePhase2Route({ ...ARGS, run: boom() })).rejects.toThrow('provider down');
    expect(charges).toBe(0);
    await expect(wirePhase2Route({ ...ARGS, run: ok() })).resolves.toBe('OUT');
    expect(charges).toBe(1);
  });

  it('(a) two failures then a success charges exactly once', async () => {
    await expect(wirePhase2Route({ ...ARGS, run: boom() })).rejects.toThrow();
    await expect(wirePhase2Route({ ...ARGS, run: boom() })).rejects.toThrow();
    await wirePhase2Route({ ...ARGS, run: ok() });
    expect(charges).toBe(1);
  });

  it('(b) an identical request INSIDE the window is a free replay (still answered)', async () => {
    await wirePhase2Route({ ...ARGS, run: ok() });
    now = T0 + 60_000;
    const run = ok();
    await expect(wirePhase2Route({ ...ARGS, run })).resolves.toBe('OUT');
    expect(run).toHaveBeenCalledTimes(1);
    expect(charges).toBe(1);
  });

  it('(b) an identical refresh AFTER the window charges', async () => {
    await wirePhase2Route({ ...ARGS, run: ok() });
    now = T0 + REPLAY_WINDOW_MS;
    await wirePhase2Route({ ...ARGS, run: ok() });
    expect(charges).toBe(2);
  });

  it('a success after a failure, replayed inside the window, is still one charge', async () => {
    await expect(wirePhase2Route({ ...ARGS, run: boom() })).rejects.toThrow();
    await wirePhase2Route({ ...ARGS, run: ok() });
    await wirePhase2Route({ ...ARGS, run: ok() });
    expect(charges).toBe(1);
  });
});

it('attempt limit: never loops - refuses after MAX_ATTEMPTS_PER_WINDOW released attempts', async () => {
  for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW; i++) {
    await expect(wirePhase2Route({ ...ARGS, run: boom() })).rejects.toThrow('provider down');
  }
  await expect(wirePhase2Route({ ...ARGS, run: ok() })).rejects.toThrow('PaymentRequired:attempt_limit');
  expect(charges).toBe(0);
});

it('different users of one org are separate keys (each charged)', async () => {
  await wirePhase2Route({ ...ARGS, run: ok() });
  await wirePhase2Route({ ...ARGS, userId: 'user-2', run: ok() });
  expect(charges).toBe(2);
});

it('attempt_limit is NOT reported as a credit shortfall (own code + own counter)', async () => {
  const { PaymentRequiredError } = jest.requireActual('../../services/billing/phase2EnforcementGate');
  const e = new PaymentRequiredError('s', 'attempt_limit');
  expect(e.code).toBe('RETRY_LIMIT_REACHED');
  expect(e.message).toMatch(/Too many failed attempts/);
  expect(new PaymentRequiredError('s', 'insufficient_credits').code).toBe('INSUFFICIENT_CREDITS');
  const { incrCounter } = jest.requireMock('../../services/billing/billingMetrics');
  (incrCounter as jest.Mock).mockClear();
  for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW; i++) {
    await expect(wirePhase2Route({ ...ARGS, run: boom() })).rejects.toThrow();
  }
  await expect(wirePhase2Route({ ...ARGS, run: ok() })).rejects.toThrow();
  expect(incrCounter).toHaveBeenCalledWith('phase2_route_attempt_limit');
});

it('a reason that names an Object.prototype key is still a plain credit refusal (no prototype lookup)', () => {
  const { PaymentRequiredError } = jest.requireActual('../../services/billing/phase2EnforcementGate');
  for (const d of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    expect(new PaymentRequiredError('s', d).code).toBe('INSUFFICIENT_CREDITS');
  }
});
