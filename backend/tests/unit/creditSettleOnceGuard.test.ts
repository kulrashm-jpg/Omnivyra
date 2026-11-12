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
 */
export {};
type Row = { id: string; idempotency_key: string; execution_phase: string; parent_transaction_id: string | null };
let mockLedger: Row[] = [];
let mockReadErr = false;
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
      const phase = fn === 'apply_credit_partial_confirm' ? 'confirm' : a.p_phase;
      const parent = fn === 'apply_credit_partial_confirm' ? a.p_hold_txn_id : a.p_parent_id;
      const row = { id: `t${mockLedger.length + 1}`, idempotency_key: key, execution_phase: phase, parent_transaction_id: parent };
      mockLedger.push(row);
      return { data: row, error: null };
    },
  },
}));

import { callCreditReservation, callCreditPartialConfirm } from '../../repositories/creditExecutionRepository';

const SPLIT = { free: 5, paid: 0, incentive: 0 };
const settle = (phase: 'confirm' | 'release', key: string, parentId: string | undefined = 'h1') =>
  callCreditReservation({ orgId: 'o1', phase, split: SPLIT, idempotencyKey: key, referenceType: 'x', note: 'n', performedBy: 'u', parentId });
const settledRows = () => mockLedger.filter((r) => r.parent_transaction_id === 'h1' && ['confirm', 'release'].includes(r.execution_phase));

let errSpy: jest.SpyInstance;
beforeEach(() => {
  mockLedger = [{ id: 'h1', idempotency_key: 'k:hold', execution_phase: 'hold', parent_transaction_id: null }];
  mockReadErr = false; mockRpcCalls.length = 0;
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

// The chokepoint is only a chokepoint while nothing else calls the RPCs.
it('fs: apply_credit_reservation / apply_credit_partial_confirm are called ONLY via the repository (expiry services excepted - no HOLD)', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const ROOT = path.resolve(__dirname, '../../..');
  const out: string[] = [];
  const walk = (d: string) => {
    let es: import('fs').Dirent[] = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (['node_modules', '.next', 'tests', '__tests__'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js)$/.test(e.name) && /rpc\(\s*['"]apply_credit_(reservation|partial_confirm)['"]/.test(fs.readFileSync(p, 'utf8'))) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  for (const d of ['backend', 'pages', 'lib', 'shared', 'app']) walk(path.join(ROOT, d));
  expect(out.sort()).toEqual([
    'backend/repositories/creditExecutionRepository.ts',
    'backend/services/creditExpiryService.ts',
    'backend/services/subscriptionCreditExpiryService.ts',
  ]);
});
