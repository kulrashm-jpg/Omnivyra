/**
 * Owner ruling (BLOCKING, e1 2026-11-13; found by the P1 website-rule sweep): POST /api/company-profile/refine saved
 * `{...profile, ...req.body}` outside onboarding mode, so a body `website_url` overwrote the stored canonical website
 * with no email-domain check (any role passing resolveCompanyAccess, including a COMPANY_ADMIN whose website
 * company-profile locks). Refine now always keeps the stored website; website edits go only through
 * POST /api/company-profile (domain == editor's email domain at eTLD+1).
 */
export {};
const mockSaved: any[] = [];
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/contentArchitectService', () => ({ resolveCompanyAccess: async () => ({ userId: 'u1', role: 'COMPANY_ADMIN' }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => { throw new Error('no table read expected outside onboarding mode'); } } }));
jest.mock('../../services/companyProfileService', () => ({
  getProfile: async () => ({ company_id: 'co-1', name: 'Acme', website_url: 'https://www.acme.com', source: 'user', user_locked_fields: [] }),
  saveProfile: async (p: any) => { mockSaved.push(p); return p; },
  refineProfileWithAIWithDetails: async (p: any) => ({ profile: p, details: {} }),
  toLimitedCompanyProfile: (p: any) => p,
}));
/* eslint-disable @typescript-eslint/no-var-requires */
const route = require('../../../pages/api/company-profile/refine').default;
/* eslint-enable @typescript-eslint/no-var-requires */
async function post(body: Record<string, unknown>) {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (x: unknown) => { res.body = x; return res; };
  res.setHeader = () => res;
  await route({ method: 'POST', headers: {}, query: { companyId: 'co-1' }, body }, res);
  return res;
}
beforeEach(() => { mockSaved.length = 0; });

it('a body website_url is IGNORED - the stored website is saved', async () => {
  const r = await post({ companyId: 'co-1', website_url: 'https://www.attacker-elsewhere.com', industry: 'SaaS' });
  expect(r.statusCode).toBe(200);
  expect(mockSaved).toHaveLength(1);
  expect(mockSaved[0]).toMatchObject({ website_url: 'https://www.acme.com', industry: 'SaaS' });
});

it('control: other refine fields still save', async () => {
  await post({ companyId: 'co-1', industry: 'Fintech' });
  expect(mockSaved[0]).toMatchObject({ industry: 'Fintech', website_url: 'https://www.acme.com' });
});
