/**
 * e9 (2026-11-12), 20270217000023: executeWithCredits never settles without its
 * HOLD. holdId is null when the hold RPC succeeds without returning an id, or an
 * existing hold's split cannot be loaded. The runtime re-resolves the hold by its
 * deterministic key; if it still cannot be found it REFUSES before the executor
 * runs (no paid work without an identifiable reservation), logs CRITICAL and
 * emits an alert-ready monetization event. It never sends a parentless confirm /
 * release (the guarded functions refuse those).
 */
export {};

const mockLedger = new Map<string, { id: string; split: { free: number; incentive: number; paid: number } | null }>();
const mockCalls: Array<{ phase: string; parentId?: string }> = [];
const mockEvents: Array<Record<string, unknown>> = [];
let mockHoldReturnsId = true;
let mockHoldWritesRow = true;

jest.mock('../../services/billing/billingAuditEmitter', () => ({ emitAnomaly: jest.fn() }));
jest.mock('../../services/billing/billingMetrics', () => ({ incrCounter: jest.fn() }));
jest.mock('../../db/supabaseClient', () => {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'is', 'limit', 'order']) b[m] = () => b;
  b.then = (ok: any, err: any) => Promise.resolve({ data: [], error: null }).then(ok, err);
  return { supabase: { from: () => b, rpc: async () => ({ data: null, error: null }) } };
});
jest.mock('../../repositories/creditExecutionRepository', () => ({
  findCreditTransaction: jest.fn(async (key: string) => {
    const r = mockLedger.get(key);
    return r ? { id: r.id, execution_phase: key.endsWith(':hold') ? 'hold' : 'confirm' } : null;
  }),
  loadCreditHoldSplit: jest.fn(async (id: string) => [...mockLedger.values()].find((r) => r.id === id)?.split ?? null),
  callCreditReservation: jest.fn(async (c: { phase: string; parentId?: string; idempotencyKey: string; split: any }) => {
    mockCalls.push({ phase: c.phase, parentId: c.parentId });
    if (c.phase === 'hold' && mockHoldWritesRow) mockLedger.set(c.idempotencyKey, { id: 'hold-row-1', split: c.split });
    if (c.phase !== 'hold' && !c.parentId) return { error: new Error('SETTLEMENT_PARENT_REQUIRED'), transactionId: null };
    return { error: null, transactionId: c.phase === 'hold' ? (mockHoldReturnsId ? 'hold-row-1' : null) : 'settle-1' };
  }),
  callCreditPartialConfirm: jest.fn(async () => ({ error: null, data: {} })),
}));
jest.mock('../../services/monetizationOpsService', () => ({
  recordMonetizationOperationalEvent: jest.fn(async (e: Record<string, unknown>) => { mockEvents.push(e); }),
}));
jest.mock('../../services/creditPriorityService', () => ({
  resolveDeduction: jest.fn(async () => ({ wallet: { id: 'w' }, available: { total: 1000 }, split: { free: 0, incentive: 0, paid: 5 } })),
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
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('../../services/logger', () => ({ logger: mockLogger }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { executeWithCredits } = require('../../services/creditExecutionServiceRuntimeCore');

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const REF = '44444444-4444-4444-8444-444444444444';
const run = (executor: () => Promise<unknown>, key: string) => executeWithCredits({
  userId: USER, orgId: ORG, action: 'content_basic', referenceType: 'manual_adjustment', referenceId: REF,
  idempotencyKey: key, validateMembership: false, executor,
});

beforeEach(() => {
  mockLedger.clear(); mockCalls.length = 0; mockEvents.length = 0;
  mockHoldReturnsId = true; mockHoldWritesRow = true;
  for (const f of Object.values(mockLogger)) f.mockClear();
});

it('the hold RPC returned NO id but the row exists -> re-resolved by key; the confirm carries the parent', async () => {
  mockHoldReturnsId = false;
  const executor = jest.fn(async () => 'done');
  await run(executor, 'hu-1');
  expect(executor).toHaveBeenCalledTimes(1);
  expect(mockCalls.filter((c) => c.phase !== 'hold')).toEqual([{ phase: 'confirm', parentId: 'hold-row-1' }]);
  expect(mockLogger.warn).toHaveBeenCalledWith('credit_hold_reresolved', expect.objectContaining({ holdId: 'hold-row-1' }));
  expect(mockEvents).toEqual([]);
});

it('NO hold row can be found -> REFUSED before the executor runs; CRITICAL log + alert-ready event; no settlement sent', async () => {
  mockHoldReturnsId = false; mockHoldWritesRow = false;
  const executor = jest.fn(async () => 'done');
  await expect(run(executor, 'hu-2')).rejects.toThrow(/HOLD_UNRESOLVED/);
  expect(executor).not.toHaveBeenCalled();
  expect(mockCalls.map((c) => c.phase)).toEqual(['hold']);
  expect(mockLogger.error).toHaveBeenCalledWith(expect.stringMatching(/^CRITICAL credit_hold_unresolved/), expect.objectContaining({ holdKey: 'hu-2:hold' }));
  expect(mockEvents).toEqual([expect.objectContaining({ eventName: 'monetization.credit_hold_unresolved', severity: 'CRITICAL', alertKey: 'credit_hold_unresolved', organizationId: ORG })]);
});

it('an existing hold whose split cannot be loaded -> REFUSED (never settled with a zero split)', async () => {
  mockLedger.set('hu-3:hold', { id: 'hold-gone', split: null });
  const executor = jest.fn(async () => 'done');
  await expect(run(executor, 'hu-3')).rejects.toThrow(/HOLD_UNRESOLVED/);
  expect(executor).not.toHaveBeenCalled();
  expect(mockCalls).toEqual([]);
  expect(mockEvents).toHaveLength(1);
});

it('control: the normal path (hold returns its id) settles with the parent and emits nothing', async () => {
  await run(async () => 'done', 'hu-4');
  expect(mockCalls).toEqual([{ phase: 'hold', parentId: undefined }, { phase: 'confirm', parentId: 'hold-row-1' }]);
  expect(mockEvents).toEqual([]);
  expect(mockLogger.warn).not.toHaveBeenCalledWith('credit_hold_reresolved', expect.anything());
});
