/**
 * e1 finding (2026-11-12) - pages/api/onboarding/validate-company-name.ts is PUBLIC and passed raw
 * input to .ilike(), so a pattern probe ('Acme%', 'Acme*') answered "is any company named Acme...",
 * enumerating existing company names by prefix across all tenants. Now availability is decided by
 * case-insensitive EQUALITY in code, and the endpoint is rate-limited per IP (fails closed).
 * The fake models BOTH layers the real call crosses: PostgREST rewrites `*` to `%` in like/ilike
 * values (05 review), then Postgres ILIKE applies %, _ and backslash escapes.
 */
export {};
type Row = Record<string, any>;

/** PostgREST like/ilike value -> SQL pattern: `*` is an alias for `%`. */
function postgrestLikeValue(v: string): string {
  return v.replace(/\*/g, '%');
}
/** Postgres ILIKE with the default escape character '\'. */
function ilikeMatch(value: string, pattern: string): boolean {
  let re = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '%') re += '.*';
    else if (c === '_') re += '.';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$', 'is').test(value);
}
const mockDb: Record<string, Row[]> = {};
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let cap = Infinity;
  const b: any = {
    select: () => b,
    limit: (n: number) => { cap = n; return b; },
    ilike: (c: string, p: string) => { const sql = postgrestLikeValue(p); tests.push((r) => ilikeMatch(String(r[c] ?? ''), sql)); return b; },
    then: (ok: any, ko: any) => Promise.resolve({ data: (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r))).slice(0, cap), error: null }).then(ok, ko),
  };
  return b;
}
let mockAllowed = true;
const mockLimitConfigs: any[] = [];
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../../lib/auth/rateLimit', () => ({
  checkRateLimit: async (_id: string, cfg: unknown) => { mockLimitConfigs.push(cfg); return { allowed: mockAllowed }; },
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/onboarding/validate-company-name').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function check(companyName: string) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await route({ method: 'POST', headers: {}, query: {}, body: { companyName } }, res);
  return res;
}
beforeEach(() => {
  mockAllowed = true; mockLimitConfigs.length = 0;
  mockDb.companies = [{ id: 'c1', name: 'Acme Corporation' }, { id: 'c3', name: 'Star*Co' }];
  mockDb.company_profiles = [{ company_id: 'c2', name: 'Zeta Labs' }];
});

it('a wildcard prefix never matches another company', async () => {
  const probes = ['Acme%', 'A%', '%%', '%Corporation', 'Zeta%', 'Zeta_Labs', 'Acme_Corporation',
    'Acme*', 'A*', '**', '*Corporation', 'Zeta*', 'Zeta*Labs', 'Star_Co', 'Star%'];
  for (const probe of probes) {
    const r = await check(probe);
    expect([probe, r.statusCode, r.body.available]).toEqual([probe, 200, true]);
  }
});

it('control: the exact name (any case) is still reported taken - in both tables, incl. a literal *', async () => {
  expect((await check('acme corporation')).body.available).toBe(false);
  expect((await check('ZETA LABS')).body.available).toBe(false);
  expect((await check('star*co')).body.available).toBe(false);
  expect((await check('Fresh Name Ltd')).body.available).toBe(true);
});

it('rate-limited per IP', async () => {
  mockAllowed = false;
  const r = await check('Anything');
  expect(r.statusCode).toBe(429);
  expect(r.body.available).toBe(false);
});

it('the limit fails CLOSED when the limiter store is down', async () => {
  await check('Anything');
  expect(mockLimitConfigs[0]).toMatchObject({ keyPrefix: 'rl:validate-company-name', onRedisFailure: 'closed' });
});
