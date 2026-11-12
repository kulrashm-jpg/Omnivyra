/**
 * P1 — owner ruling 2026-11-13: a company's website must sit on the editing
 * user's email domain, compared at the registrable domain (eTLD+1). Only
 * SUPER_ADMIN is exempt; CONTENT_ARCHITECT is held to the same rule.
 *
 * Exercises POST /api/company-profile against a faithful in-memory table fake
 * (every filter applied; unknown tables empty; read errors injectable).
 */
import { createFakeDb, type FakeDb } from '../helpers/p1FaithfulTableFake';
import { createApiRequestMock, createMockRes } from '../utils';

let mockDb: FakeDb;
const mockAccess = { current: null as null | { userId: string; role: string } };

jest.mock('../../db/supabaseClient', () => ({
  get supabase() {
    return mockDb.client;
  },
}));

jest.mock('../../services/companyProfileService', () => ({
  getLatestProfile: jest.fn(),
  getProfile: jest.fn(),
  saveProfile: jest.fn(async (p: any) => ({ ...p })),
  refineProfileWithAI: jest.fn(),
  refineProfileWithAIWithDetails: jest.fn(),
  calculateCompanyProfileCompleteness: jest.fn(() => ({ score: 0, section_scores: {} })),
  toLimitedCompanyProfile: jest.fn((profile: any) => profile),
  upsertCompanyProfileGovernanceSettings: jest.fn(
    ({ existingReportSettings, incomingReportSettings }: any) => incomingReportSettings ?? existingReportSettings ?? null,
  ),
  getCompanyProfileReviewStatus: jest.fn(() => ({ status: 'ready', issues: [] })),
}));

jest.mock('../../services/contentArchitectService', () => ({
  resolveCompanyAccess: jest.fn(async (_req: any, res: any) => {
    if (!mockAccess.current) {
      res.status(403).json({ error: 'FORBIDDEN_ROLE' });
      return null;
    }
    return mockAccess.current;
  }),
  isContentArchitectSession: jest.fn(() => false),
}));

import companyProfileHandler from '../../../pages/api/company-profile';
import { getProfile, saveProfile } from '../../services/companyProfileService';

const COMPANY = 'company-own';

function seed(opts: { existingWebsite?: string | null; users?: Array<{ id: string; email: string | null }> }) {
  mockDb = createFakeDb({
    users: opts.users ?? [],
    companies: [
      { id: COMPANY, website_domain: null, admin_email_domain: null },
      { id: 'company-taken', website_domain: 'taken-corp.com', admin_email_domain: 'taken-corp.com' },
    ],
  });
  (getProfile as jest.Mock).mockResolvedValue(
    opts.existingWebsite === undefined ? null : { company_id: COMPANY, website_url: opts.existingWebsite },
  );
}

async function post(body: Record<string, unknown>) {
  const req = createApiRequestMock({ method: 'POST', companyId: COMPANY, body });
  const res = createMockRes();
  await companyProfileHandler(req, res);
  return res as any;
}

function savedWebsite(): unknown {
  const calls = (saveProfile as jest.Mock).mock.calls;
  return calls.length ? calls[calls.length - 1][0].website_url : '<<not saved>>';
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAccess.current = null;
});

describe('company website <-> editor email domain (eTLD+1)', () => {
  it('first-time set by a normal admin: email on a subdomain (mail.acme.com) + site acme.com is allowed', async () => {
    seed({ existingWebsite: null, users: [{ id: 'u-admin', email: 'jane@mail.acme.com' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://www.acme.com' });
    expect(res.statusCode).toBe(200);
    expect(savedWebsite()).toBe('https://www.acme.com');
  });

  it('first-time set by a normal admin: email acme.com + site other.com is refused', async () => {
    seed({ existingWebsite: null, users: [{ id: 'u-admin', email: 'jane@acme.com' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://other.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('WEBSITE_DOMAIN_MISMATCH');
    expect(res.body?.error).toContain('acme.com');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('multi-part TLD: email x@shop.acme.co.uk + site acme.co.uk allowed; site evil.co.uk refused', async () => {
    seed({ existingWebsite: null, users: [{ id: 'u-admin', email: 'x@shop.acme.co.uk' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    expect((await post({ website_url: 'acme.co.uk' })).statusCode).toBe(200);
    (saveProfile as jest.Mock).mockClear();
    const refused = await post({ website_url: 'evil.co.uk' });
    expect(refused.statusCode).toBe(400);
    expect(refused.body?.code).toBe('WEBSITE_DOMAIN_MISMATCH');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('CONTENT_ARCHITECT change is refused on mismatch', async () => {
    seed({ existingWebsite: 'https://acme.com', users: [{ id: 'u-ca', email: 'ca@beta-corp.com' }] });
    mockAccess.current = { userId: 'u-ca', role: 'CONTENT_ARCHITECT' };
    const res = await post({ website_url: 'https://other.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('WEBSITE_DOMAIN_MISMATCH');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('CONTENT_ARCHITECT change is allowed on match', async () => {
    seed({ existingWebsite: 'https://acme.com', users: [{ id: 'u-ca', email: 'ca@beta-corp.com' }] });
    mockAccess.current = { userId: 'u-ca', role: 'CONTENT_ARCHITECT' };
    const res = await post({ website_url: 'https://beta-corp.com' });
    expect(res.statusCode).toBe(200);
    expect(savedWebsite()).toBe('https://beta-corp.com');
  });

  it('CONTENT_ARCHITECT cookie principal (no user row, no email) is refused — fail closed', async () => {
    seed({ existingWebsite: 'https://acme.com', users: [] });
    mockAccess.current = { userId: 'content_architect', role: 'CONTENT_ARCHITECT' };
    const res = await post({ website_url: 'https://beta-corp.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('WEBSITE_DOMAIN_MISMATCH');
    expect(saveProfile).not.toHaveBeenCalled();
    // The cookie principal never triggers a users read with a non-uuid id.
    expect(mockDb.log).not.toContain('select:users');
  });

  it('CONTENT_ARCHITECT clearing the website is refused', async () => {
    seed({ existingWebsite: 'https://acme.com', users: [{ id: 'u-ca', email: 'ca@acme.com' }] });
    mockAccess.current = { userId: 'u-ca', role: 'CONTENT_ARCHITECT' };
    const res = await post({ website_url: '' });
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('WEBSITE_DOMAIN_MISMATCH');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('users read error refuses the change (fail closed)', async () => {
    seed({ existingWebsite: null, users: [{ id: 'u-admin', email: 'jane@acme.com' }] });
    mockDb.failSelect.users = { message: 'boom' };
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://acme.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('WEBSITE_DOMAIN_MISMATCH');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN is exempt — may set a website on any domain', async () => {
    seed({ existingWebsite: 'https://acme.com', users: [{ id: 'u-sa', email: 'root@acme.com' }] });
    mockAccess.current = { userId: 'u-sa', role: 'SUPER_ADMIN' };
    const res = await post({ website_url: 'https://other.com' });
    expect(res.statusCode).toBe(200);
    expect(savedWebsite()).toBe('https://other.com');
  });

  it('unchanged website is untouched (no domain check, even with a mismatching email)', async () => {
    seed({ existingWebsite: 'https://other.com', users: [{ id: 'u-admin', email: 'jane@acme.com' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://other.com', name: 'Acme' });
    expect(res.statusCode).toBe(200);
    expect(savedWebsite()).toBe('https://other.com');
    expect(mockDb.log).not.toContain('select:users');
  });

  it('normal admin cannot change an existing website (still locked, silently kept)', async () => {
    seed({ existingWebsite: 'https://acme.com', users: [{ id: 'u-admin', email: 'jane@other.com' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://other.com' });
    expect(res.statusCode).toBe(200);
    expect(savedWebsite()).toBe('https://acme.com');
  });

  it('matching domain still subject to the cross-company uniqueness check', async () => {
    seed({ existingWebsite: null, users: [{ id: 'u-admin', email: 'jane@taken-corp.com' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://taken-corp.com' });
    expect(res.statusCode).toBe(400);
    expect(res.body?.code).toBe('DOMAIN_ALREADY_REGISTERED');
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it('matching domain still subject to the public-URL check (personal email provider)', async () => {
    seed({ existingWebsite: null, users: [{ id: 'u-admin', email: 'jane@gmail.com' }] });
    mockAccess.current = { userId: 'u-admin', role: 'COMPANY_ADMIN' };
    const res = await post({ website_url: 'https://gmail.com' });
    expect(res.statusCode).toBe(400);
    expect(saveProfile).not.toHaveBeenCalled();
  });
});
