/**
 * e1 finding (2026-11-12) - pages/api/onboarding/complete.ts bound a verified signup to ANY existing
 * company whose name matched the email domain's first label (x@acme.io -> 'acme', i.e. acme.com's
 * company) and, when that company had no initial credit claim, inserted the signer as COMPANY_ADMIN.
 * Now a pre-existing company is reachable only with an active/invited membership; anyone else gets
 * 403 INVITE_REQUIRED before ANY write binds them to it.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockWrites: Array<{ table: string; op: string; row: Row }> = [];
let mockSeq = 0;
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false; let cap = Infinity;
  let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'; let payload: Row | null = null;
  const run = () => {
    const rows = (mockDb[table] ??= []);
    if (op === 'insert' || op === 'upsert') {
      const row = { id: `00000000-0000-4000-8000-${String(++mockSeq).padStart(12, '0')}`, ...payload };
      rows.push(row); mockWrites.push({ table, op, row });
      return { data: one ? row : [row], error: null };
    }
    const hit = rows.filter((r) => tests.every((t) => t(r))).slice(0, cap);
    if (op === 'update') { hit.forEach((r) => { Object.assign(r, payload); mockWrites.push({ table, op, row: { ...r } }); }); return { data: null, error: null }; }
    // PostgREST: maybeSingle/single over >1 row -> PGRST116 error, data null (05 review)
    if (one && hit.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' } };
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: any = {
    select: () => b, order: () => b,
    limit: (n: number) => { cap = n; return b; },
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { tests.push((r) => v.includes(r[c])); return b; },
    not: (c: string, _o: string, v: unknown) => { tests.push((r) => (r[c] ?? null) !== v); return b; },
    ilike: (c: string, v: string) => { tests.push((r) => String(r[c] ?? '').toLowerCase() === v.toLowerCase()); return b; },
    or: (expr: string) => {
      const alts = expr.split(',').map((p) => { const [col, , ...rest] = p.split('.'); return [col, rest.join('.')]; });
      tests.push((r) => alts.some(([c, v]) => r[c] === v)); return b;
    },
    insert: (p: Row) => { op = 'insert'; payload = p; return b; },
    upsert: (p: Row) => { op = 'upsert'; payload = p; return b; },
    update: (p: Row) => { op = 'update'; payload = p; return b; },
    maybeSingle: () => { one = true; return b; }, single: () => { one = true; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
let mockEmail = 'mallory@acme.io';
const mockGrants: unknown[] = [];
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: { id: 'ignored', supabaseUid: 'sb-user', email: mockEmail, emailVerified: true }, error: null }),
}));
jest.mock('../../services/domainEligibilityService', () => ({ checkDomainEligibility: async () => ({ eligible: true, result: 'ELIGIBLE' }) }));
jest.mock('../../services/initialFreeCreditService', () => ({
  grantInitialFreeCredit: async (a: unknown) => { mockGrants.push(a); return { granted: true, credits: 300, expiresAt: 'x' }; },
  INITIAL_FREE_CREDIT_CATEGORY: 'initial_free_credit', INITIAL_FREE_CREDIT_DEFAULT: 300, INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT: 30,
}));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: true }), ONBOARDING_COMPLETE_LIMIT: {}, ONBOARDING_UID_LIMIT: {} }));
jest.mock('../../../lib/security/clientIp', () => ({ getTrustedClientIp: () => '1.2.3.4' }));
jest.mock('../../services/signupEventService', () => ({
  emitSignupEvent: async () => undefined, ensureSignupCorrelationId: async () => 'corr', requestUserAgent: () => 'ua',
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const complete = require('../../../pages/api/onboarding/complete').default;
/* eslint-enable @typescript-eslint/no-var-requires */
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VICTIM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function post() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await complete({ method: 'POST', headers: {}, query: {}, body: { fullName: 'M' } }, res);
  return res;
}
const bindingWrites = () => mockWrites.filter((w) =>
  w.table !== 'users' || w.row.active_company_id !== undefined);
beforeEach(() => {
  for (const k of Object.keys(mockDb)) delete mockDb[k];
  mockWrites.length = 0; mockGrants.length = 0; mockSeq = 0;
  mockDb.users = [{ id: USER, supabase_uid: 'sb-user', email: 'x', is_deleted: false }];
  // acme.com's company: created by an admin flow, so it has NO initial free-credit claim
  mockDb.companies = [{ id: VICTIM, name: 'Acme', admin_email_domain: 'acme.com' }];
  mockDb.free_credit_claims = [];
  mockDb.user_company_roles = [];
});

it('a stranger whose domain label matches an existing company is refused before any write binds them', async () => {
  mockEmail = 'mallory@acme.io';
  const r = await post();
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('INVITE_REQUIRED');
  expect(bindingWrites()).toEqual([]);
  expect(mockDb.user_company_roles).toEqual([]);
  expect(mockGrants).toEqual([]);
});

it('an INACTIVE former member is refused the same way', async () => {
  mockEmail = 'old@acme.com';
  mockDb.user_company_roles = [{ id: 'r0', user_id: USER, company_id: VICTIM, role: 'CONTENT_CREATOR', status: 'inactive' }];
  const r = await post();
  expect(r.statusCode).toBe(403);
  expect(bindingWrites()).toEqual([]);
});

it('control: an INVITED user lands on the existing company without being promoted', async () => {
  mockEmail = 'invitee@acme.com';
  mockDb.user_company_roles = [{ id: 'r1', user_id: USER, company_id: VICTIM, role: 'CONTENT_CREATOR', status: 'invited' }];
  const r = await post();
  expect(r.statusCode).toBe(200);
  expect(mockDb.user_company_roles).toEqual([{ id: 'r1', user_id: USER, company_id: VICTIM, role: 'CONTENT_CREATOR', status: 'invited' }]);
});

it('an invited member with a second stale row is NEVER promoted (05: multi-row read error)', async () => {
  mockEmail = 'invitee@acme.com';
  mockDb.user_company_roles = [
    { id: 'r1', user_id: USER, company_id: VICTIM, role: 'CONTENT_CREATOR', status: 'invited' },
    { id: 'r2', user_id: USER, company_id: VICTIM, role: 'CONTENT_CREATOR', status: 'expired' },
  ];
  const r = await post();
  expect(r.statusCode).toBe(200);
  expect(mockDb.user_company_roles.map((x) => x.role)).toEqual(['CONTENT_CREATOR', 'CONTENT_CREATOR']);
});

it('control: the first registrant of a NEW company is its COMPANY_ADMIN', async () => {
  mockEmail = 'founder@newco.io';
  const r = await post();
  expect(r.statusCode).toBe(200);
  const created = mockDb.companies.find((c) => c.name === 'newco');
  expect(created).toBeTruthy();
  expect(mockDb.user_company_roles).toEqual([expect.objectContaining({ user_id: USER, company_id: created!.id, role: 'COMPANY_ADMIN' })]);
});
