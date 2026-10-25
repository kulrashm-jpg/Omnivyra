/**
 * The company profile is optional for report input resolution: a failed lookup, a missing record or
 * another company's record never stops a report, and each is recorded for what it is.
 */
import { resolveReportInput } from '../../services/reportInputResolver';
import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';

jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn() }));
jest.mock('../../services/googleProviderReadinessService', () => ({ getGoogleSearchConsoleReadiness: jest.fn(async () => ({ ready: false })) }));
jest.mock('../../services/companyProfileService', () => ({ saveProfile: jest.fn(), upsertCompanyProfilePayload: jest.fn() }));

const COMPANY = 'cmp-opt-0000-0000-0000-000000000001';
const getProfileMock = getCanonicalProfile as jest.Mock;
const resolve = (formData: Record<string, unknown> = { domain: 'acme.example' }) =>
  resolveReportInput({ companyId: COMPANY, reportCategory: 'snapshot', requestPayload: { formData } });

describe('optional company profile in report input', () => {
  beforeEach(() => getProfileMock.mockReset());

  it('a profile read failure is recorded as an access error and the input still resolves', async () => {
    getProfileMock.mockRejectedValue(new Error('Failed to fetch company profile: permission denied'));
    const input = await resolve();
    expect(input.profile).toBeNull();
    expect(input.profileLookup?.status).toBe('profile_access_error');
    expect(input.resolved.websiteDomain).toBe('acme.example');
  });

  it('no profile is "not found", not an error, and nothing is filled in', async () => {
    getProfileMock.mockResolvedValue(null);
    const input = await resolve();
    expect(input.profileLookup?.status).toBe('profile_not_found');
    expect(input.resolved.companyContext.revenueRange).toBeNull();
    expect(input.resolved.companyContext.teamSize).toBeNull();
  });

  it('another company’s profile is never used', async () => {
    getProfileMock.mockResolvedValue({ company_id: 'someone-else', name: 'Other Co', website_url: 'https://other.example', products_services: 'Other things' });
    const input = await resolve();
    expect(input.profile).toBeNull();
    expect(input.profileLookup?.status).toBe('profile_identity_mismatch');
    expect(input.resolved.companyName).not.toBe('Other Co');
    expect(input.resolved.websiteDomain).toBe('acme.example');
  });

  it('a readable profile is used as before', async () => {
    getProfileMock.mockResolvedValue({ company_id: COMPANY, name: 'Acme Ltd', website_url: 'https://acme.example', products_services: 'Widgets' });
    const input = await resolve({});
    expect(input.profileLookup?.status).toBe('profile_available');
    expect(input.resolved.companyName).toBe('Acme Ltd');
    expect(input.resolved.companyContext.productServices).toContain('Widgets');
  });
});
