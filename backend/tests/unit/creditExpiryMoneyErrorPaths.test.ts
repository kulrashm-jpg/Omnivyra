/**
 * MONEY unread-error sites (2026-11-12): credit expiry.
 *
 *  - :50 wallet snapshot - a failed read was "no wallet" (skip) BEFORE expiry,
 *    and AFTER expiry it silently skipped the paid-balance invariant check
 *    (EXPIRY_CATEGORY_VIOLATION). Now throws -> counted as a per-org error.
 *  - :136 / :218 "already expired this window?" reads, :228 incentive grants
 *    read - throw, nothing expired on an unread answer.
 *  - :99 incentive config - best-effort in the customer-safe direction: a
 *    failed read leaves incentive expiry OFF this run (free expiry unaffected).
 *  - :189 / :273 expiry history rows - best-effort, logged with the amount.
 */
export {};
type Res = { data?: unknown; error: { message: string } | null };
let mockScript: Record<string, (n: number) => Res> = {};
const mockCalls: Record<string, number> = {};
const mockRpc: string[] = [];
const mockRpcKeys: string[] = [];

function mockBuilder(table: string) {
  let op = 'select';
  const b: any = {};
  const result = () => {
    const k = table + ':' + op;
    mockCalls[k] = (mockCalls[k] ?? 0) + 1;
    return (mockScript[k] ?? (() => ({ data: null, error: null })))(mockCalls[k]);
  };
  for (const m of ['select', 'eq', 'lt', 'gt', 'not', 'limit']) b[m] = () => b;
  b.insert = () => { op = 'insert'; return b; };
  b.maybeSingle = async () => result();
  b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockBuilder(t) }));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: async (_fn: string, a: { p_phase: string; p_idempotency_key: string }) => { mockRpc.push(a.p_phase); mockRpcKeys.push(a.p_idempotency_key); return { error: null }; } },
}));

import { runExpiryCheck } from '../../services/creditExpiryService';

const DOWN = () => ({ data: null, error: { message: 'down' } });
const WALLET = { data: { free_balance: 100, paid_balance: 50, incentive_balance: 0 }, error: null };
let errSpy: jest.SpyInstance;

beforeEach(() => {
  mockScript = {
    'free_credit_profiles:select': () => ({ data: [{ user_id: 'u1', organization_id: 'o1', initial_credits: 30, credit_expiry_at: '2026-11-01T00:00:00Z' }], error: null }),
    'organization_credits:select': () => WALLET,
  };
  for (const k of Object.keys(mockCalls)) delete mockCalls[k];
  mockRpc.length = 0;
  mockRpcKeys.length = 0;
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => errSpy.mockRestore());

it('control: a clean run expires the free credits once', async () => {
  const r = await runExpiryCheck();
  expect(r).toMatchObject({ expired: 1, total_expired_credits: 30, errors: 0 });
  expect(mockRpc).toEqual(['expire']);
});

it('"already expired?" read error -> per-org error, NOTHING expired', async () => {
  mockScript['credit_transactions:select'] = DOWN;
  const r = await runExpiryCheck();
  expect(r.errors).toBe(1);
  expect(mockRpc).toEqual([]);
});

it('wallet read error BEFORE expiry -> per-org error, nothing expired (never a silent skip)', async () => {
  mockScript['organization_credits:select'] = DOWN;
  const r = await runExpiryCheck();
  expect(r.errors).toBe(1);
  expect(mockRpc).toEqual([]);
});

it('wallet read error AFTER expiry -> the invariant check is NOT silently skipped: counted as an error', async () => {
  mockScript['organization_credits:select'] = (n) => (n === 1 ? WALLET : DOWN());
  const r = await runExpiryCheck();
  expect(mockRpc).toEqual(['expire']);
  expect(r.errors).toBe(1);
});

it('expiry history write fails -> the expiry still counts, and the failure is logged with the amount', async () => {
  mockScript['credit_expiry_log:insert'] = DOWN;
  const r = await runExpiryCheck();
  expect(r).toMatchObject({ expired: 1, total_expired_credits: 30, errors: 0 });
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('expiry log write failed') && String(c[0]).includes('expired 30'))).toBe(true);
});

it('incentive config read error -> incentive expiry OFF this run (customer-safe), free expiry unaffected, logged', async () => {
  mockScript['free_credit_config:select'] = DOWN;
  const r = await runExpiryCheck();
  expect(mockRpc).toEqual(['expire']);
  expect(r.incentive_expired).toBe(0);
  expect(errSpy.mock.calls.some((c) => String(c[0]).includes('incentive_expiry config read failed'))).toBe(true);
});

it('incentive expiry ENABLED by config -> REFUSED in code (FIFO accounting missing): counted as an error, nothing incentive-expired, free expiry unaffected', async () => {
  mockScript['free_credit_config:select'] = () => ({ data: { is_active: true, expiry_days: 30 }, error: null });
  const r = await runExpiryCheck();
  expect(mockRpc).toEqual(['expire']);
  expect(r.incentive_expired).toBe(0);
  expect(r.errors).toBe(1);
  expect(errSpy.mock.calls.some((c) => String(c[1] ?? '').includes('INCENTIVE_EXPIRY_REFUSED'))).toBe(true);
});

it('ONE free expiry per org: two user profiles in the same org expire the single onboarding grant only once', async () => {
  mockScript['free_credit_profiles:select'] = () => ({ data: [
    { user_id: 'u1', organization_id: 'o1', initial_credits: 300, credit_expiry_at: '2026-10-01T00:00:00Z' },
    { user_id: 'u2', organization_id: 'o1', initial_credits: 300, credit_expiry_at: '2026-10-20T00:00:00Z' },
  ], error: null });
  // idempotency reads (per profile date) find nothing; the prior-org-expiry read finds the
  // first expiry once it has happened (2nd profile's check).
  let priorChecks = 0;
  mockScript['credit_transactions:select'] = () => {
    priorChecks += 1;
    // order per profile: [idempotency, prior-expiry]; 4th call = 2nd profile's prior check
    return priorChecks === 4 ? { data: { id: 'exp-1' }, error: null } : { data: null, error: null };
  };
  const r = await runExpiryCheck();
  expect(mockRpc).toEqual(['expire']);
  expect(r).toMatchObject({ expired: 1, errors: 0 });
});

it('prior-expiry read error -> per-org error, nothing expired', async () => {
  let n = 0;
  mockScript['credit_transactions:select'] = () => { n += 1; return n === 2 ? { data: null, error: { message: 'down' } } : { data: null, error: null }; };
  const r = await runExpiryCheck();
  expect(r.errors).toBe(1);
  expect(mockRpc).toEqual([]);
});

// CLASS 2 (2026-11-12): guard 1b ("one free expiry per org") is a plain READ.
// Two OVERLAPPING runs that each see no prior expiry - handling different
// profiles (different expiry dates) of one org - used different per-day keys
// and both expired. The key is now per ORG, so the ledger's unique key makes
// the second write a no-op. Modelled: two runs, neither sees the other's row.
it('overlapping runs on two profiles of ONE org write the SAME idempotency key (the ledger unique stops the 2nd)', async () => {
  mockScript['free_credit_profiles:select'] = () => ({ data: [{ user_id: 'u1', organization_id: 'o1', initial_credits: 30, credit_expiry_at: '2026-11-01T00:00:00Z' }], error: null });
  await runExpiryCheck();
  for (const k of Object.keys(mockCalls)) delete mockCalls[k];
  mockScript['free_credit_profiles:select'] = () => ({ data: [{ user_id: 'u2', organization_id: 'o1', initial_credits: 30, credit_expiry_at: '2026-11-05T00:00:00Z' }], error: null });
  await runExpiryCheck();
  expect(mockRpcKeys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(mockRpcKeys.filter((_, i) => mockRpc[i] === 'expire')).size).toBe(1);
});
it('control: two DIFFERENT orgs get different keys', async () => {
  mockScript['free_credit_profiles:select'] = () => ({ data: [
    { user_id: 'u1', organization_id: 'o1', initial_credits: 30, credit_expiry_at: '2026-11-01T00:00:00Z' },
    { user_id: 'u2', organization_id: 'o2', initial_credits: 30, credit_expiry_at: '2026-11-01T00:00:00Z' },
  ], error: null });
  await runExpiryCheck();
  expect(new Set(mockRpcKeys.filter((_, i) => mockRpc[i] === 'expire')).size).toBe(2);
});
