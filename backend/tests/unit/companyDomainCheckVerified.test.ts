/**
 * e1 (2026-11-12): /api/onboarding/company-domain-check uses the session email's DOMAIN as its only
 * evidence, but never required that email to be verified - an unverified session at someone else's
 * domain learned their company id, name and admin (with the admin's email local-part as fallback).
 * Now: 403 EMAIL_NOT_VERIFIED before any read; a verified match returns the company name and the
 * admin's DISPLAY name only - no company id, never any part of an email.
 */
export {};
type Row = Record<string, any>;
const mockDb: Record<string, Row[]> = {};
const mockReads: string[] = [];
function mockTable(table: string) {
  const tests: Array<(r: Row) => boolean> = []; let one = false;
  const b: any = {
    select: () => b, limit: () => b,
    eq: (c: string, v: unknown) => { tests.push((r) => r[c] === v); return b; },
    or: (expr: string) => {
      const alts = expr.split(',').map((p) => { const [col, , ...rest] = p.split('.'); return [col, rest.join('.')]; });
      tests.push((r) => alts.some(([c, v]) => r[c] === v)); return b;
    },
    maybeSingle: () => { one = true; return b; },
    then: (ok: any, ko: any) => {
      mockReads.push(table);
      const hit = (mockDb[table] ?? []).filter((r) => tests.every((t) => t(r)));
      const res = one && hit.length > 1 ? { data: null, error: { code: 'PGRST116' } } : { data: one ? hit[0] ?? null : hit, error: null };
      return Promise.resolve(res).then(ok, ko);
    },
  };
  return b;
}
let mockVerified = true;
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/authResolver', () => ({
  resolveAuthenticatedUser: async () => ({ user: { id: 'x', supabaseUid: 'sb-p', email: 'p@acme.com', emailVerified: mockVerified }, error: null }),
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/onboarding/company-domain-check').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function get() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  await route({ method: 'GET', headers: {}, query: {} }, res);
  return res;
}
beforeEach(() => {
  mockVerified = true; mockReads.length = 0;
  mockDb.users = [{ id: 'u-p', supabase_uid: 'sb-p', email: 'p@acme.com' }, { id: 'u-admin', name: 'Ada Admin', email: 'ada@acme.com' }];
  mockDb.companies = [{ id: 'c-acme', name: 'Acme', status: 'active', website_domain: 'acme.com', admin_email_domain: 'acme.com' }];
  mockDb.user_company_roles = [{ user_id: 'u-admin', company_id: 'c-acme', role: 'COMPANY_ADMIN', status: 'active' }];
});

it('an UNVERIFIED session is refused before anything is read', async () => {
  mockVerified = false;
  const r = await get();
  expect(r.statusCode).toBe(403);
  expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
  expect(mockReads).toEqual([]);
});
it('a verified match returns the company name and admin display name - no id', async () => {
  const r = await get();
  expect(r.body).toEqual({ matched: true, companyName: 'Acme', adminName: 'Ada Admin' });
});
it('an admin with no display name is null - never the email local-part', async () => {
  mockDb.users[1].name = null;
  const r = await get();
  expect(r.body).toEqual({ matched: true, companyName: 'Acme', adminName: null });
});
