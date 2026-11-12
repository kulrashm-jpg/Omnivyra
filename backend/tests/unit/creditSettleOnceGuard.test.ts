/**
 * SETTLE-ONCE GUARD (2026-11-12, e9 URGENT). Prod's apply_credit_reservation
 * does not refuse a second settlement of a HOLD (the 20260625 guard was never
 * installed); its idempotent return only collapses a repeat of the SAME key.
 * So every confirm / release / partial confirm now checks, by business
 * identity, that no other-key settlement of that hold exists.
 *
 * The ledger fake applies eq / in over stored rows; the RPC fake APPENDS a
 * terminal row like the live function would (and returns the existing row on
 * a same-key repeat, as prod does), so a missing guard double-settles here.
 * FAITHFUL PHASES (2026-11-12): a partial confirm writes execution_phase
 * 'confirm_partial' (the live and guarded bodies both do) - this fake used to
 * write 'confirm', which hid that the by-parent check never read that phase.
 * The guarded partial confirm also writes its released remainder as its own
 * 'release' row keyed <key>:remainder.
 */
export {};
type Row = { id: string; idempotency_key: string; execution_phase: string; parent_transaction_id: string | null };
let mockLedger: Row[] = [];
let mockReadErr = false;
let mockPartialRemainder = false;
let mockRacer = false;
const mockRpcCalls: string[] = [];

function mockQuery() {
  const filters: Array<(r: Row) => boolean> = [];
  const b: any = {
    select: () => b,
    eq: (c: keyof Row, v: unknown) => { filters.push((r) => r[c] === v); return b; },
    in: (c: keyof Row, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
    then: (ok: any, ko: any) => Promise.resolve(mockReadErr ? { data: null, error: { message: 'down' } } : { data: mockLedger.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r })), error: null }).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => mockQuery(),
    rpc: async (fn: string, a: Record<string, any>) => {
      const key = a.p_idempotency_key;
      mockRpcCalls.push(`${fn}:${key}`);
      const existing = mockLedger.find((r) => r.idempotency_key === key);
      if (existing) return { data: existing, error: null }; // prod: same-key idempotent return
      const isPartial = fn === 'apply_credit_partial_confirm_guarded';
      const phase = isPartial ? 'confirm_partial' : a.p_phase;
      const parent = isPartial ? a.p_hold_txn_id : a.p_parent_id;
      const row = { id: `t${mockLedger.length + 1}`, idempotency_key: key, execution_phase: phase, parent_transaction_id: parent };
      mockLedger.push(row);
      if (isPartial && mockPartialRemainder) {
        mockLedger.push({ id: `t${mockLedger.length + 1}`, idempotency_key: `${key}:remainder`, execution_phase: 'release', parent_transaction_id: parent });
      }
      if (mockRacer) mockLedger.push({ id: `t${mockLedger.length + 1}`, idempotency_key: 'racer:release', execution_phase: 'release', parent_transaction_id: parent });
      return { data: row, error: null };
    },
  },
}));

import { callCreditReservation, callCreditPartialConfirm } from '../../repositories/creditExecutionRepository';

const SPLIT = { free: 5, paid: 0, incentive: 0 };
const settle = (phase: 'confirm' | 'release', key: string, parentId: string | undefined = 'h1') =>
  callCreditReservation({ orgId: 'o1', phase, split: SPLIT, idempotencyKey: key, referenceType: 'x', note: 'n', performedBy: 'u', parentId });
const settledRows = () => mockLedger.filter((r) => r.parent_transaction_id === 'h1' && ['confirm', 'release', 'confirm_partial'].includes(r.execution_phase) && !r.idempotency_key.endsWith(':remainder'));
const partialConfirm = (key = 'k:confirm') =>
  callCreditPartialConfirm({ orgId: 'o1', holdTxnId: 'h1', actualSplit: SPLIT, idempotencyKey: key, referenceType: 'x', note: 'n', performedBy: 'u' });

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockLedger = [{ id: 'h1', idempotency_key: 'k:hold', execution_phase: 'hold', parent_transaction_id: null }];
  mockReadErr = false; mockPartialRemainder = false; mockRacer = false; mockRpcCalls.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('control: the first confirm of a hold settles it', async () => {
  await expect(settle('confirm', 'k:confirm')).resolves.toMatchObject({ error: null });
  expect(settledRows()).toHaveLength(1);
});

it('RELEASE after a CONFIRM of the same hold -> refused (HOLD_ALREADY_SETTLED), no second settlement', async () => {
  await settle('confirm', 'k:confirm');
  const r = await settle('release', 'k:release');
  expect(r.error?.message).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(settledRows()).toHaveLength(1);
});

it('CONFIRM after a RELEASE of the same hold -> refused', async () => {
  await settle('release', 'k:release');
  const r = await settle('confirm', 'k:confirm');
  expect(r.error?.message).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(settledRows()).toHaveLength(1);
});

it('a second RELEASE under a DIFFERENT key (e.g. a re-keyed retry) -> refused', async () => {
  await settle('release', 'k:release');
  const r = await settle('release', 'other:release');
  expect(r.error?.message).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(settledRows()).toHaveLength(1);
});

it('control: a repeat of the SAME key passes through (the RPC returns the existing row)', async () => {
  await settle('release', 'k:release');
  const r = await settle('release', 'k:release');
  expect(r.error).toBeNull();
  expect(settledRows()).toHaveLength(1);
});

it('key-family check: a settled hold is found even without a parent id on the call', async () => {
  await settle('confirm', 'k:confirm');
  const r = await settle('release', 'k:release', undefined);
  expect(r.error?.message).toMatch(/HOLD_ALREADY_SETTLED/);
});

it('PARTIAL CONFIRM after a release -> refused', async () => {
  await settle('release', 'k:release');
  const r = await callCreditPartialConfirm({ orgId: 'o1', holdTxnId: 'h1', actualSplit: SPLIT, idempotencyKey: 'k:confirm', referenceType: 'x', note: 'n', performedBy: 'u' });
  expect(r.error?.message).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(settledRows()).toHaveLength(1);
});

it('settle-once read error -> refused, nothing settled (never "no settlement")', async () => {
  mockReadErr = true;
  const r = await settle('confirm', 'k:confirm');
  expect(r.error?.message).toMatch(/settle-once check failed/);
  expect(mockRpcCalls).toEqual([]);
});

it('control: hold / grant / expire phases are not checked (no parent settlement concept)', async () => {
  mockReadErr = true; // would refuse if checked
  const r = await callCreditReservation({ orgId: 'o1', phase: 'grant', split: SPLIT, idempotencyKey: 'g1', referenceType: 'x', note: 'n', performedBy: 'u' });
  expect(r.error).toBeNull();
});

// COVERAGE BOUND (05, 2026-11-12): a settlement with a NULL parent under a
// DIFFERENT key family is invisible to both checks. This pins the bound
// HONESTLY (it is NOT refused) so nobody reads the guard as complete coverage;
// the guarded function's mandatory parent closes it.
it('KNOWN BOUND: a NULL-parent settlement under a different key family is NOT detected (closed only by the guarded function)', async () => {
  mockLedger.push({ id: 'x1', idempotency_key: 'retry:k:lineage1:release', execution_phase: 'release', parent_transaction_id: null });
  const r = await settle('confirm', 'k:confirm');
  expect(r.error).toBeNull();
});

// 20270217000023: the repository calls the GUARDED functions (the DB guard is
// the atomic one); the static "no app code calls the old pair" pin lives in
// creditLegacyRpcNotCalled.test.ts.
it('the repository calls the GUARDED functions, never the legacy pair', async () => {
  await settle('confirm', 'k:confirm');
  await partialConfirm('p:confirm').catch(() => undefined);
  expect(mockRpcCalls.every((c) => /^apply_credit_(reservation|partial_confirm)_guarded:/.test(c))).toBe(true);
  expect(mockRpcCalls.length).toBeGreaterThan(0);
});

it("RELEASE under an UNRELATED key after a PARTIAL confirm -> refused BY PARENT (the 'confirm_partial' phase is read)", async () => {
  await partialConfirm('k:confirm');
  const r = await settle('release', 'reaper-other:release'); // a key outside the k: family: only the by-parent half can see it
  expect(r.error?.message).toMatch(/HOLD_ALREADY_SETTLED/);
  expect(settledRows()).toHaveLength(1);
});

it("a partial confirm's OWN remainder row is not 'another settlement': a same-key repeat passes, the post-check stays quiet", async () => {
  mockPartialRemainder = true;
  await partialConfirm('k:confirm');
  expect(mockLedger.some((r) => r.idempotency_key === 'k:confirm:remainder')).toBe(true);
  const r = await partialConfirm('k:confirm');
  expect(r.error).toBeNull();
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('HOLD_DOUBLE_SETTLED'))).toBe(false);
});

it('control: a REAL second settlement (a racer behind the pre-check) -> the post-check logs CRITICAL', async () => {
  mockRacer = true; // the fake writes another key's release of h1 in the same instant
  mockPartialRemainder = true;
  await partialConfirm('k:confirm');
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('HOLD_DOUBLE_SETTLED'))).toBe(true);
});
