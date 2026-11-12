/**
 * e1 S2 finding (2026-11-12) - pages/api/onboarding/validate-company-name.ts is PUBLIC and passed raw
 * input to .ilike(), where % _ \ are pattern characters: 'Ac%' answered "is any company named Ac...",
 * enumerating existing company names by prefix across all tenants. Now the input is escaped (exact,
 * case-insensitive match) and the endpoint is rate-limited per IP. The fake implements Postgres
 * ILIKE semantics (%, _, backslash escape), so a wildcard probe is evaluated faithfully.
 */
export {};
type Row = Record<string, any>;

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
  const tests: Array<(r: Row) => boolean> = [];
  const b: any = {
    select: () => b, limit: () => b,
    ilike: (c: string, p: string) => { tests.push((r) => ilikeMatch(String(r[c] ?? ''), p)); return b; },
    then: (ok: any, ko: any) => Promise.resolve({ data: (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r))), error: null }).then(ok, ko),
  };
  return b;
}
let mockAllowed = true;
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t) }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../auth/requestClientIp', () => ({ authRequestIp: () => '1.2.3.4' }));
jest.mock('../../../lib/auth/rateLimit', () => ({ checkRateLimit: async () => ({ allowed: mockAllowed }) }));

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
  mockAllowed = true;
  mockDb.companies = [{ id: 'c1', name: 'Acme Corporation' }];
  mockDb.company_profiles = [{ company_id: 'c2', name: 'Zeta Labs' }];
});

it('a wildcard prefix never matches another company', async () => {
  for (const probe of ['Acme%', 'A%', '%%', '%Corporation', 'Zeta%', 'Zeta_Labs', 'Acme_Corporation']) {
    const r = await check(probe);
    expect([probe, r.body.available]).toEqual([probe, true]);
  }
});

it('control: the exact name (any case) is still reported taken - in both tables', async () => {
  expect((await check('acme corporation')).body.available).toBe(false);
  expect((await check('ZETA LABS')).body.available).toBe(false);
  expect((await check('Fresh Name Ltd')).body.available).toBe(true);
});

it('rate-limited per IP', async () => {
  mockAllowed = false;
  const r = await check('Anything');
  expect(r.statusCode).toBe(429);
});
