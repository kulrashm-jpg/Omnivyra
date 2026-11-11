/**
 * SECURITY (2026-11-11): GET /api/company-profile?mode=list answered from the
 * `content_architect_company_id` cookie BEFORE any authentication. That reader
 * (getContentArchitectCompanyId) was never behind the bridge lifecycle: no
 * signature, no session, no expiry. Any client setting the cookie to a
 * company's id got 200 with that company's profile name and a
 * CONTENT_ARCHITECT entry in rolesByCompany. The branch is removed; the list
 * now always resolves the caller's real session first.
 *
 * ROOT CAUSE: SEC-001A gave content_architect_session a signature, max-age,
 * hard expiry and dry-run switch, and left its sibling cookie with none - a
 * hardening that enumerates one cookie misses the next one.
 */
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const getProfile = jest.fn(async (id: string) => ({ company_id: id, name: 'Company B Confidential Name' }));

jest.mock('../../services/companyProfileService', () => ({
  getProfile: (id: string) => getProfile(id),
  saveProfile: jest.fn(),
  calculateCompanyProfileCompleteness: jest.fn(),
  toLimitedCompanyProfile: jest.fn(),
  upsertCompanyProfileGovernanceSettings: jest.fn(),
  getCompanyProfileReviewStatus: jest.fn(),
}));
jest.mock('../../services/supabaseAuthService', () => ({
  getSupabaseUserFromRequest: jest.fn(async () => ({ user: null, error: 'no session' })),
}));
jest.mock('../../db/supabaseClient', () => {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  return { supabase: { from: () => b } };
});
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));

import handler from '../../../pages/api/company-profile/index';

async function list(cookies: Record<string, string>) {
  const out = { code: 0, body: {} as Record<string, unknown> };
  const r = {
    status: (c: number) => { out.code = c; return r; },
    json: (b: Record<string, unknown>) => { out.body = b; return r; },
    setHeader: () => r,
    getHeader: () => undefined,
  };
  await (handler as unknown as (q: unknown, s: unknown) => Promise<void>)(
    { method: 'GET', query: { mode: 'list' }, body: {}, headers: { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') }, cookies }, r);
  return out;
}

it('an unauthenticated request with only the pinned-company cookie learns NOTHING about that company', async () => {
  const res = await list({ content_architect_company_id: CO_B });
  expect([401, 403]).toContain(res.code); // an auth refusal, not a crash
  expect(JSON.stringify(res.body)).not.toContain('Company B Confidential Name');
  expect(JSON.stringify(res.body)).not.toContain('CONTENT_ARCHITECT');
  expect(getProfile).not.toHaveBeenCalledWith(CO_B);
});
