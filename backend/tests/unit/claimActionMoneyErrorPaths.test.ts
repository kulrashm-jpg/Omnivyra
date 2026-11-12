/**
 * MONEY unread-error sites (2026-11-12): credits/claim-action.
 *
 *  - :60 a failed reward-config read fell back to the DEFAULT amounts (granting
 *    a changed or deactivated category at the default) -> now 503, no claim.
 *  - :104 the org was resolved AFTER the one-time claim was inserted; a failed
 *    read - or a user with no active organisation - consumed the claim,
 *    granted nothing and answered 200 "success, N credits". Nothing replays
 *    these claims, so the credits were lost for good. The org is now resolved
 *    FIRST: read error -> 503, no org -> 409, and the claim is untouched.
 *  - :128 a failed rollback delete (claim stranded, user can never retry) is
 *    logged as its own event.
 *  - an unexpected error no longer returns the database message to the client.
 */
export {};
const USER = 'u0000000-0000-4000-8000-0000000000u1';
const ORG = 'a0000000-0000-4000-8000-00000000000a';

type Res = { data: unknown; error: { message: string; code?: string } | null };
let mockScript: Record<string, () => Res> = {};
const mockWrites: string[] = [];
const mockLogs: string[] = [];
let mockGrantFails = false;
const mockGrants: unknown[] = [];

jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../middleware/withIdempotency', () => ({ withIdempotency: (h: unknown) => h }));
jest.mock('../../services/logger', () => ({
  logger: { error: (e: string) => mockLogs.push(e), warn: (e: string) => mockLogs.push(e), info: () => undefined },
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: async () => ({ user: { id: USER, email: null }, error: null }),
}));
jest.mock('../../services/domainEligibilityService', () => ({ checkDomainEligibility: async () => ({ eligible: true, result: 'eligible' }) }));
jest.mock('../../services/creditExecutionService', () => ({
  createCredit: async (args: unknown) => { if (mockGrantFails) throw new Error('grant down'); mockGrants.push(args); },
  makeIdempotencyKey: (...p: string[]) => p.join(':'),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      let op = 'select';
      const b: any = {};
      const result = () => (mockScript[table + ':' + op] ?? (() => ({ data: null, error: null })))();
      for (const m of ['select', 'eq', 'in', 'limit']) b[m] = () => b;
      b.insert = () => { op = 'insert'; mockWrites.push(table + ':insert'); return b; };
      b.delete = () => { op = 'delete'; mockWrites.push(table + ':delete'); return b; };
      b.maybeSingle = async () => result();
      b.then = (ok: (v: Res) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
      return b;
    },
  },
}));

import handler from '../../../pages/api/credits/claim-action';

function mockRes() {
  const r: any = { statusCode: 0, body: null };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
}
const post = () => ({ method: 'POST', body: { category: 'setup' }, headers: {}, query: {} }) as any;

beforeEach(() => {
  mockScript = {
    'free_credit_config:select': () => ({ data: [], error: null }),
    'user_company_roles:select': () => ({ data: { company_id: ORG }, error: null }),
  };
  mockWrites.length = 0; mockLogs.length = 0; mockGrants.length = 0; mockGrantFails = false;
});

async function run() { const res = mockRes(); await handler(post(), res); return res; }

it('control: the category under test is a real reward category', async () => {
  const res = await run();
  expect(res.statusCode).toBe(200);
  expect(mockWrites).toEqual(['free_credit_claims:insert']);
  expect(mockGrants).toHaveLength(1);
});

it('reward-config read error -> 503, NO claim consumed, nothing granted (not the default amount)', async () => {
  mockScript['free_credit_config:select'] = () => ({ data: null, error: { message: 'down' } });
  const res = await run();
  expect(res.statusCode).toBe(503);
  expect(mockWrites).toEqual([]);
  expect(mockGrants).toEqual([]);
});

it('membership read error -> 503 BEFORE the claim; the one-time claim is not consumed', async () => {
  mockScript['user_company_roles:select'] = () => ({ data: null, error: { message: 'down' } });
  const res = await run();
  expect(res.statusCode).toBe(503);
  expect(mockWrites).toEqual([]);
  expect(mockGrants).toEqual([]);
});

it('no active organisation -> 409, the claim is not consumed, and never a 200 "success" with nothing granted', async () => {
  mockScript['user_company_roles:select'] = () => ({ data: null, error: null });
  const res = await run();
  expect(res.statusCode).toBe(409);
  expect(res.body).toMatchObject({ error: 'no_active_organization' });
  expect(mockWrites).toEqual([]);
});

it('grant fails and the rollback delete fails -> 500, the stranded claim is logged as its own event', async () => {
  mockGrantFails = true;
  mockScript['free_credit_claims:delete'] = () => ({ data: null, error: { message: 'down' } });
  const res = await run();
  expect(res.statusCode).toBe(500);
  expect(mockWrites).toEqual(['free_credit_claims:insert', 'free_credit_claims:delete']);
  expect(mockLogs).toContain('credits_claim_action_rollback_failed');
});

it('an unexpected claim-insert error never returns the database message', async () => {
  mockScript['free_credit_claims:insert'] = () => ({ data: null, error: { message: 'relation secret_internal does not exist', code: '42P01' } });
  const res = await run();
  expect(res.statusCode).toBe(500);
  expect(JSON.stringify(res.body)).not.toContain('secret_internal');
});

// MUTANT SURVIVOR (2026-11-12): the duplicate-claim branch had no case.
it('duplicate claim (23505) -> 409 "already claimed", nothing granted', async () => {
  mockScript['free_credit_claims:insert'] = () => ({ data: null, error: { message: 'duplicate key value', code: '23505' } as any });
  const res = await run();
  expect(res.statusCode).toBe(409);
  expect(res.body.error).toMatch(/already been claimed/);
  expect(mockGrants).toEqual([]);
});
