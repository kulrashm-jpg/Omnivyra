/**
 * e9 ruling 2026-11-12 (BLOCKING, money): the login reconcile in sync-supabase-user called grantInitialFreeCredit,
 * which made a FRESH grant for any company with no ledger row and no claim - so any member's login granted the
 * initial credits, skipping onboarding's eligibility checks (owner rule: the 300 come VIA ONBOARDING).
 * grantInitialFreeCredit({ repairOnly: true }) now repairs bookkeeping for a company that ALREADY has a ledger grant
 * and never creates one. The onboarding grant (no flag) is unchanged.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; row: Row }> = [];
const mockCredits: Row[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let op = 'select'; let payload: Row = {};
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    is: (c: string, v: unknown) => { tests.push((r) => (r[c] ?? null) === v); return b; },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      const rows = (mockDb[table] ??= []);
      if (op !== 'select') {
        mockWrites.push({ table, op, row: payload });
        if (op === 'insert') rows.push({ ...payload });
        if (op === 'update') rows.filter((r) => tests.every((t) => t(r))).forEach((r) => Object.assign(r, payload));
        return Promise.resolve({ data: null, error: null }).then(ok, ko);
      }
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      return Promise.resolve({ data: one ? hit[0] ?? null : hit, error: null }).then(ok, ko);
    },
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../services/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../services/creditExecutionService', () => ({
  makeIdempotencyKey: (...parts: string[]) => `idem:${parts.join(':')}`,
  createCredit: async (input: Row) => { mockCredits.push(input); },
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const { grantInitialFreeCredit } = require('../../services/initialFreeCreditService');
/* eslint-enable @typescript-eslint/no-var-requires */
const ORG = '11111111-1111-4111-8111-111111111111';
const KEY = `idem:${ORG}:initial_free_credit:${ORG}`;
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockCredits.length = 0;
  mockDb.free_credit_config = [{ category: 'initial_free_credit', credits: 300, expiry_days: 30, is_active: true }];
  mockDb.companies = [{ id: ORG, free_credit_granted_at: null }];
  mockDb.free_credit_claims = [];
  mockDb.credit_transactions = [];
});

it('repairOnly: a company with NO ledger grant and NO claim (a member’s login) is granted nothing', async () => {
  const r = await grantInitialFreeCredit({ orgId: ORG, userId: 'u1', emailDomain: 'acme.com', repairOnly: true });
  expect(r).toEqual({ granted: false, reason: 'no_existing_grant' });
  expect(mockCredits).toEqual([]);
  expect(mockWrites).toEqual([]);
});

it('repairOnly: a company WITH a ledger grant but a missing claim gets the claim repaired - no second credit', async () => {
  mockDb.credit_transactions = [{ id: 'tx1', idempotency_key: KEY, free_delta: 300, category: 'free' }];
  const r = await grantInitialFreeCredit({ orgId: ORG, userId: 'u1', emailDomain: 'acme.com', repairOnly: true });
  expect(r).toEqual({ granted: false, reason: 'already_claimed' });
  expect(mockCredits).toEqual([]);
  expect(mockDb.free_credit_claims).toEqual([expect.objectContaining({ organization_id: ORG, category: 'initial_free_credit', credits_granted: 300 })]);
  expect(mockDb.companies[0].free_credit_granted_at).not.toBeNull();
});

it('control: the onboarding grant (no repairOnly) still grants once - for an INTENT-BORN company (P1)', async () => {
  mockDb.signup_intents = [{ id: ORG }];
  const r = await grantInitialFreeCredit({ orgId: ORG, userId: 'u1', emailDomain: 'acme.com' });
  expect(r).toMatchObject({ granted: true, credits: 300 });
  expect(mockCredits).toHaveLength(1);
});

it('P1 credit chokepoint: a company NOT born from a server-minted signup intent gets NO new grant', async () => {
  const r = await grantInitialFreeCredit({ orgId: ORG, userId: 'u1', emailDomain: 'acme.com' });
  expect(r).toEqual({ granted: false, reason: 'not_signup_company' });
  expect(mockCredits).toEqual([]);
});
