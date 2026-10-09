/**
 * ResolvedReportInput.resolved.companyContext — contract tests.
 *
 * companyContext is REQUIRED: reportInputResolver.resolveReportInput is its only
 * production producer and always sets it. Readers must still tolerate a value
 * that reaches them without it (untyped records, legacy fixtures), and must
 * treat "absent" exactly like "all-empty" — never as an error and never as
 * different data.
 *
 *  (a) precedence: request formData > generationContext.manualData > profile > firmographics
 *  (b) the narrative and competitive extractors give identical output for an
 *      absent and an all-empty companyContext
 *  (c) the untyped cast path (generateDiscoveryKeywords → extractDiscoveryFields)
 *      only hands the typed extractor a well-formed companyContext
 */
import { seed } from '../helpers/routeAuthHarness';
import { EMPTY_REPORT_COMPANY_CONTEXT } from '../helpers/resolvedReportInputFixture';
import { resolveReportInput, type ResolvedReportInput } from '../../services/reportInputResolver';
import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { extractCompetitiveContextFromResolvedInput } from '../../services/competitorEngineServiceEngineDiscovery';
import { extractCompanyNarrativeContext } from '../../services/snapshotReport/narrativeHelpers';
import { generateDiscoveryKeywords } from '../../services/reportCompetitorIntelligenceServiceHelpers';

jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn() }));
jest.mock('../../services/googleProviderReadinessService', () => ({
  getGoogleSearchConsoleReadiness: jest.fn(async () => ({ ready: false })),
}));
jest.mock('../../services/companyProfileService', () => ({
  saveProfile: jest.fn(),
  upsertCompanyProfilePayload: jest.fn(),
}));

const COMPANY = 'cmp-ctx-0000-0000-0000-000000000001';
const getProfileMock = getCanonicalProfile as jest.Mock;

const PROFILE = {
  company_id: COMPANY,
  name: 'Acme Ltd',
  website_url: 'https://acme.example',
  industry: 'Industrial Supplies',
  target_audience: 'Profile Audience',
  products_services: 'Profile Widgets',
  brand_positioning: 'Profile Positioning',
};

function resolve(requestPayload: Record<string, unknown> = {}) {
  return resolveReportInput({ companyId: COMPANY, reportCategory: 'snapshot', requestPayload });
}

/** A typed deep copy with `resolved.companyContext` removed at runtime (deliberately absent). */
function withoutCompanyContext(input: ResolvedReportInput): ResolvedReportInput {
  const copy = structuredClone(input);
  Reflect.deleteProperty(copy.resolved, 'companyContext');
  return copy;
}

function withEmptyCompanyContext(input: ResolvedReportInput): ResolvedReportInput {
  const copy = structuredClone(input);
  copy.resolved.companyContext = { ...EMPTY_REPORT_COMPANY_CONTEXT };
  return copy;
}

beforeEach(() => {
  jest.clearAllMocks();
  seed({ companies: [{ id: COMPANY, status: 'active', name: 'Acme Ltd', size: '11-50' }] });
  getProfileMock.mockResolvedValue({ ...PROFILE });
});

describe('(a) companyContext precedence', () => {
  it('request formData wins over manualData and the profile', async () => {
    const input = await resolve({
      formData: { targetCustomer: 'Form Customer' },
      generationContext: { manualData: { targetCustomer: 'Manual Customer' } },
    });
    expect(input.resolved.companyContext.targetCustomer).toBe('Form Customer');
  });

  it('manualData wins over the profile when formData is silent', async () => {
    const input = await resolve({ generationContext: { manualData: { targetCustomer: 'Manual Customer' } } });
    expect(input.resolved.companyContext.targetCustomer).toBe('Manual Customer');
  });

  it('the profile is used when the request carries nothing', async () => {
    const input = await resolve();
    expect(input.resolved.companyContext.targetCustomer).toBe('Profile Audience');
    expect(input.resolved.companyContext.brandPositioning).toBe('Profile Positioning');
  });

  it('teamSize falls back to firmographics last, after the profile company facts', async () => {
    expect((await resolve()).resolved.companyContext.teamSize).toBe('11-50');

    getProfileMock.mockResolvedValue({ ...PROFILE, report_settings: { company_facts: { team_size: '51-200' } } });
    expect((await resolve()).resolved.companyContext.teamSize).toBe('51-200');
  });

  it('productServices merges request, manual and profile values without duplicates', async () => {
    const input = await resolve({
      formData: { productServices: 'Form Gadgets' },
      generationContext: { manualData: { productServices: 'Profile Widgets' } },
    });
    expect(input.resolved.companyContext.productServices).toEqual(['Form Gadgets', 'Profile Widgets']);
  });

  it('companyContext is always present, even with no profile', async () => {
    getProfileMock.mockResolvedValue(null);
    const input = await resolve();
    expect(Object.keys(input.resolved.companyContext).sort()).toEqual(Object.keys(EMPTY_REPORT_COMPANY_CONTEXT).sort());
  });
});

describe('(b) absent companyContext reads exactly like an all-empty one', () => {
  it('competitive context', async () => {
    const input = await resolve();
    expect(extractCompetitiveContextFromResolvedInput(withoutCompanyContext(input)))
      .toEqual(extractCompetitiveContextFromResolvedInput(withEmptyCompanyContext(input)));
  });

  it('narrative context', async () => {
    const input = await resolve();
    expect(extractCompanyNarrativeContext({ resolvedInput: withoutCompanyContext(input) }))
      .toEqual(extractCompanyNarrativeContext({ resolvedInput: withEmptyCompanyContext(input) }));
  });
});

describe('(c) untyped cast path', () => {
  it('a record with `resolved` but no companyContext behaves like an all-empty companyContext', async () => {
    const input = await resolve();
    const absent = generateDiscoveryKeywords(withoutCompanyContext(input));
    expect(absent).toEqual(generateDiscoveryKeywords(withEmptyCompanyContext(input)));
    expect(absent.length).toBeGreaterThan(0);
  });

  it('a populated companyContext still drives discovery', async () => {
    const input = await resolve({ formData: { marketFocus: 'Cold-chain logistics' } });
    expect(generateDiscoveryKeywords(input).join(' ').toLowerCase()).toContain('cold-chain logistics');
  });
});
