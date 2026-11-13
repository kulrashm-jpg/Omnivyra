/**
 * e9 ruling 2026-11-13 (BLOCKING for pricing): when apply_credit_partial_confirm returns an error, executeWithCredits
 * must NOT release the whole hold unless the hold is provably open AND the error was a definitive database refusal.
 *
 *   committed confirm (timeout after commit)   -> adopt it, no release, no error
 *   open + definitive DB refusal (P0001 etc.)  -> release (old behaviour), throw
 *   open + non-definitive (network / timeout)  -> the finished work is RETURNED with settlementPending, NO release
 *   state unreadable (read error)              -> returned with settlementPending, NO release
 *   already released by someone else          -> returned with settlementPending, NO second release
 * (Throwing would lose the finished content and invite a re-click: a new key, a new hold, a second charge.)
 */
export {};

type Rows = Array<{ id: string; execution_phase: string }>;
const db: { byParent: { data: Rows | null; error: { message: string } | null }; byKey: { data: Rows | null; error: { message: string } | null } } = {
  byParent: { data: [], error: null },
  byKey: { data: [], error: null },
};
jest.mock('../../db/supabaseClient', () => {
  const from = () => {
    let byParent = false;
    const b: any = {};
    b.select = () => b;
    b.eq = (col: string) => { if (col === 'parent_transaction_id') byParent = true; return b; };
    for (const m of ['in', 'is', 'limit', 'order']) b[m] = () => b;
    b.then = (ok: any, err: any) => Promise.resolve(byParent ? db.byParent : db.byKey).then(ok, err);
    return b;
  };
  return { supabase: { from, rpc: async () => ({ data: null, error: null }) } };
});
const partialConfirm = jest.fn();
let confirmPhaseError: { code?: string; message: string } | null = null;
const reservation = jest.fn(async (cmd: { phase: string }) =>
  cmd.phase === 'confirm' && confirmPhaseError ? { error: confirmPhaseError, transactionId: null } : { error: null, transactionId: 'hold-tx-1' });
jest.mock('../../repositories/creditExecutionRepository', () => ({
  findCreditTransaction: jest.fn(async () => null),
  loadCreditHoldSplit: jest.fn(async () => null),
  callCreditReservation: (cmd: { phase: string }) => reservation(cmd),
  callCreditPartialConfirm: (...a: unknown[]) => partialConfirm(...a),
}));
jest.mock('../../services/pricingService', () => ({
  estimateLlmHoldCredits: jest.fn(async () => ({ credits: 10, total_cost_usd: 0.001, final_price_usd: 0.07 })),
  resolveLlmCost: jest.fn(async () => ({ credits: 4, total_cost_usd: 0.0004, final_price_usd: 0.028 })),
  recordCostAnomaly: jest.fn(async () => undefined),
}));
jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn() }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../services/creditPriorityService', () => ({
  resolveDeduction: jest.fn(async () => ({ wallet: { id: 'w' }, available: { total: 1000 }, split: { free: 0, incentive: 0, paid: 10 } })),
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
const { readHoldSettlementState, isDefinitiveDbRefusal } = require('../../services/billing/holdSettlementState');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const REF = '44444444-4444-4444-8444-444444444444';

const run = (key: string) => executeWithCredits({
  userId: USER, orgId: ORG, action: 'content_basic', referenceType: 'manual_adjustment', referenceId: REF,
  idempotencyKey: key, validateMembership: false,
  llmPricing: { provider: 'openai', model: 'gpt-4o-mini', actionKey: 'content_basic', maxInputTokens: 1000, maxOutputTokens: 500 },
  executor: async () => ({ result: 'done', usage: { source: 'provider', inputTokens: 100, outputTokens: 50 }, provider: 'openai', model: 'gpt-4o-mini' }),
});
const releases = () => reservation.mock.calls.filter(([c]) => c.phase === 'release').length;

beforeEach(() => {
  partialConfirm.mockReset();
  reservation.mockClear();
  db.byParent = { data: [], error: null };
  db.byKey = { data: [], error: null };
  confirmPhaseError = null;
});

describe('isDefinitiveDbRefusal', () => {
  it.each([['P0001', true], ['23505', true], ['PGRST202', true], ['', false], [undefined, false], ['ECONNRESET', false]])('%p -> %p', (code, want) => {
    expect(isDefinitiveDbRefusal(code === undefined ? { message: 'x' } : { code, message: 'x' })).toBe(want);
  });
});

describe('readHoldSettlementState', () => {
  const input = { holdId: 'h', confirmKey: 'k:confirm', releaseKey: 'k:release' };
  it('open when neither the parent nor the key lookup finds a terminal row', async () => {
    expect(await readHoldSettlementState(input)).toEqual({ state: 'open' });
  });
  it('confirmed via the parent link', async () => {
    db.byParent = { data: [{ id: 'c1', execution_phase: 'confirm' }], error: null };
    expect(await readHoldSettlementState(input)).toEqual({ state: 'confirmed', transactionId: 'c1' });
  });
  it('released via the settle key', async () => {
    db.byKey = { data: [{ id: 'r1', execution_phase: 'release' }], error: null };
    expect(await readHoldSettlementState(input)).toEqual({ state: 'released', transactionId: 'r1' });
  });
  it('a read error on either lookup is unreadable - never "open"', async () => {
    db.byParent = { data: null, error: { message: 'boom' } };
    expect(await readHoldSettlementState(input)).toEqual({ state: 'unreadable', message: 'boom' });
    db.byParent = { data: [], error: null };
    db.byKey = { data: null, error: { message: 'boom2' } };
    expect(await readHoldSettlementState(input)).toEqual({ state: 'unreadable', message: 'boom2' });
  });
});

describe('executeWithCredits: partial_confirm error handling', () => {
  it('a confirm that COMMITTED despite the error is adopted: no release, no marker', async () => {
    partialConfirm.mockResolvedValue({ error: { message: 'fetch failed' }, data: null });
    db.byParent = { data: [{ id: 'conf-1', execution_phase: 'confirm' }], error: null };
    const r = await run('pc-adopt');
    expect(r.status).toBe('executed');
    expect(r.settlementPending).toBeUndefined();
    expect(releases()).toBe(0);
  });

  it('open hold + definitive DB refusal (P0001): released, then the error is raised', async () => {
    partialConfirm.mockResolvedValue({ error: { code: 'P0001', message: 'refused' }, data: null });
    await expect(run('pc-definitive')).rejects.toThrow(/partial_confirm failed: refused/);
    expect(releases()).toBe(1);
  });

  it('open hold + NON-definitive error (network / timeout): returned with settlementPending, NO release', async () => {
    partialConfirm.mockResolvedValue({ error: { message: 'fetch failed: socket hang up' }, data: null });
    const r = await run('pc-network');
    expect(r).toMatchObject({ status: 'executed', result: 'done', settlementPending: { code: 'CREDIT_SETTLE_AMBIGUOUS', state: 'open' } });
    expect(releases()).toBe(0);
  });

  it('settled state UNREADABLE: returned with settlementPending, NO release (a read error is no answer)', async () => {
    partialConfirm.mockResolvedValue({ error: { code: 'P0001', message: 'refused' }, data: null });
    db.byParent = { data: null, error: { message: 'read failed' } };
    const r = await run('pc-unreadable');
    expect(r).toMatchObject({ status: 'executed', settlementPending: { code: 'CREDIT_SETTLE_AMBIGUOUS', state: 'unreadable' } });
    expect(releases()).toBe(0);
  });

  it('hold already RELEASED by someone else: returned with settlementPending, NO second release', async () => {
    partialConfirm.mockResolvedValue({ error: { code: 'P0001', message: 'refused' }, data: null });
    db.byParent = { data: [{ id: 'rel-1', execution_phase: 'release' }], error: null };
    const r = await run('pc-released');
    expect(r).toMatchObject({ status: 'executed', settlementPending: { state: 'released' } });
    expect(releases()).toBe(0);
  });
});

describe('executeWithCredits: FIXED-cost confirm error handling (same rule)', () => {
  const runFixed = (key: string) => executeWithCredits({
    userId: USER, orgId: ORG, action: 'content_basic', referenceType: 'manual_adjustment', referenceId: REF,
    idempotencyKey: key, validateMembership: false, executor: async () => 'done',
  });

  it('a confirm that COMMITTED despite the error is adopted: no release', async () => {
    confirmPhaseError = { message: 'fetch failed' };
    db.byKey = { data: [{ id: 'conf-9', execution_phase: 'confirm' }], error: null };
    const r = await runFixed('fx-adopt');
    expect(r.status).toBe('executed');
    expect(releases()).toBe(0);
  });

  it('open + definitive refusal: released (old behaviour)', async () => {
    confirmPhaseError = { code: 'P0001', message: 'refused' };
    await expect(runFixed('fx-definitive')).rejects.toThrow(/confirm failed: refused/);
    expect(releases()).toBe(1);
  });

  it('open + network error: returned with settlementPending, NO release', async () => {
    confirmPhaseError = { message: 'socket hang up' };
    const r = await runFixed('fx-network');
    expect(r).toMatchObject({ status: 'executed', result: 'done', settlementPending: { code: 'CREDIT_SETTLE_AMBIGUOUS', state: 'open' } });
    expect(releases()).toBe(0);
  });
});
