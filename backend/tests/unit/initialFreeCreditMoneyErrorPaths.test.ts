/**
 * MONEY unread-error sites (2026-11-12): the onboarding initial free-credit grant.
 *
 *  - :52 config read - a failed read was "no config", so the DEFAULT amount was
 *    granted even when the config disables the grant or sets another amount.
 *    Now grant_failed (setup-company logs it; the login-time reconciler in
 *    sync-supabase-user retries on the next login).
 *  - the three state probes (claim / ledger / company) - a failed probe is
 *    "unknown", never "absent": grant_failed, nothing granted or repaired.
 *  - repair / stamp / wallet-ensure writes - best-effort, logged.
 */
export {};
type Res = { data?: unknown; error: { message: string; code?: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockGrants: number[] = [];
const mockWarn = jest.fn();
const mockError = jest.fn();

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: (table: string) => {
    let op = 'select';
    const b: any = {};
    const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
    for (const m of ['select', 'eq', 'is']) b[m] = () => b;
    b.update = () => { op = 'update'; return b; };
    b.insert = () => { op = 'insert'; return b; };
    b.upsert = () => { op = 'upsert'; return b; };
    b.maybeSingle = async () => result();
    b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  },
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: jest.fn() } }));
jest.mock('../../services/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a), error: (...a: unknown[]) => mockError(...a), info: jest.fn() } }));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: async (a: { amount: number }) => { mockGrants.push(a.amount); },
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));

import { grantInitialFreeCredit } from '../../services/initialFreeCreditService';

const DOWN = () => ({ data: null, error: { message: 'down' } });
const IN = { orgId: 'o1', userId: 'u1' };
beforeEach(() => { mockScript = {}; mockGrants.length = 0; mockWarn.mockReset(); mockError.mockReset(); });

it('control: a clean first grant uses the configured amount', async () => {
  mockScript['free_credit_config:select'] = () => ({ data: { credits: 300, expiry_days: 30, is_active: true }, error: null });
  const r = await grantInitialFreeCredit(IN);
  expect(r).toMatchObject({ granted: true, credits: 300 });
  expect(mockGrants).toEqual([300]);
});

it('config read error -> grant_failed, NOTHING granted (never the default amount)', async () => {
  mockScript['free_credit_config:select'] = DOWN;
  const r = await grantInitialFreeCredit(IN);
  expect(r).toMatchObject({ granted: false, reason: 'grant_failed' });
  expect(mockGrants).toEqual([]);
});

it.each(['free_credit_claims', 'credit_transactions', 'companies'])('%s probe error -> grant_failed, nothing granted or repaired', async (table) => {
  mockScript['free_credit_config:select'] = () => ({ data: { credits: 300, is_active: true }, error: null });
  mockScript[table + ':select'] = DOWN;
  const r = await grantInitialFreeCredit(IN);
  expect(r).toMatchObject({ granted: false, reason: 'grant_failed' });
  expect(mockGrants).toEqual([]);
});

it('post-grant stamp failure is best-effort: granted, and logged', async () => {
  mockScript['free_credit_config:select'] = () => ({ data: { credits: 300, is_active: true }, error: null });
  mockScript['companies:update'] = DOWN;
  const r = await grantInitialFreeCredit(IN);
  expect(r).toMatchObject({ granted: true });
  expect(mockWarn).toHaveBeenCalledWith('initial_free_credit_stamp_failed', expect.anything());
});

// MUTANT SURVIVOR (2026-11-12): the REPAIR-path stamp (ledger row exists,
// company stamp missing) logs its own event; only the post-grant stamp had a case.
it('bookkeeping repair: company stamp repair fails -> already_claimed, the repair failure is logged', async () => {
  mockScript['free_credit_config:select'] = () => ({ data: { credits: 300, is_active: true }, error: null });
  mockScript['credit_transactions:select'] = () => ({ data: { id: 't1', free_delta: 300, category: 'free' }, error: null });
  mockScript['free_credit_claims:select'] = () => ({ data: { id: 'c1' }, error: null });
  mockScript['companies:select'] = () => ({ data: { free_credit_granted_at: null }, error: null });
  mockScript['companies:update'] = DOWN;
  const r = await grantInitialFreeCredit(IN);
  expect(r).toMatchObject({ granted: false, reason: 'already_claimed' });
  expect(mockGrants).toEqual([]);
  expect(mockWarn).toHaveBeenCalledWith('initial_free_credit_stamp_repair_failed', expect.anything());
});

// (2026-11-12) credit_transactions is immutable in prod (enabled trigger): a
// miscategorized legacy ledger row is REPORTED, never UPDATEd.
it('bookkeeping: a ledger row with the legacy category is reported, NOT updated (ledger is immutable)', async () => {
  mockScript['free_credit_config:select'] = () => ({ data: { credits: 300, is_active: true }, error: null });
  mockScript['credit_transactions:select'] = () => ({ data: { id: 't1', free_delta: 300, category: 'paid' }, error: null });
  mockScript['free_credit_claims:select'] = () => ({ data: { id: 'c1' }, error: null });
  mockScript['companies:select'] = () => ({ data: { free_credit_granted_at: '2026-01-01T00:00:00Z' }, error: null });
  let ledgerUpdated = false;
  mockScript['credit_transactions:update'] = () => { ledgerUpdated = true; return { data: null, error: null }; };
  const r = await grantInitialFreeCredit(IN);
  expect(r).toMatchObject({ granted: false, reason: 'already_claimed' });
  expect(ledgerUpdated).toBe(false);
  expect(mockWarn).toHaveBeenCalledWith('initial_free_credit_ledger_category_mismatch', expect.anything());
});
