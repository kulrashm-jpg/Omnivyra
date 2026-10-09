/**
 * CHARACTERIZATION — GET /api/reports/snapshot company grounding.
 *
 * Pins CURRENT behaviour; it is not a statement of intended behaviour. If the
 * route is repaired or deprecated, update this suite in the same change.
 *
 * The route calls composeSnapshotReport(companyId) with no resolved input
 * (pages/api/reports/snapshot.ts). With a realistic Company Profile available,
 * this suite separates the possible causes of missing company grounding:
 *   A. the real route handler                        → profile never loaded, grounding empty
 *   B. composeSnapshotReport(companyId)              → identical to A: the route adds/strips nothing
 *   C. composeSnapshotReport(companyId, {resolvedInput}) with the input the
 *      Report 1 pipeline resolves                    → fully grounded: serializer and
 *                                                      fallbacks are not the cause
 * So the gap is the route's omitted input, nothing downstream of it.
 *
 * Hermetic: database and identity are the shared route-auth fake, the profile
 * loader is a spy, and every outbound HTTP path is stubbed, refused and
 * recorded. Case C attempts outbound calls once a domain is known (website
 * crawl, LLM and knowledge-graph providers) — relevant to the cost of
 * resolving input on this route.
 */
import snapshotHandler from '../../../pages/api/reports/snapshot';
import { seed, invoke, CO_A } from '../helpers/routeAuthHarness';
import { composeSnapshotReport } from '../../services/snapshotReportService';
import { resolveReportInput } from '../../services/reportInputResolver';
import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';

const mockOutbound: string[] = [];

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn() }));
jest.mock('../../services/googleProviderReadinessService', () => ({
  getGoogleSearchConsoleReadiness: jest.fn(async () => ({ ready: false })),
}));
jest.mock('../../services/companyProfileService', () => ({
  ...jest.requireActual('../../services/companyProfileService'),
  saveProfile: jest.fn(),
  upsertCompanyProfilePayload: jest.fn(),
}));
jest.mock('../../services/decisionComposerService', () => ({
  ...jest.requireActual('../../services/decisionComposerService'),
  composeDecisionIntelligence: async () => ({ decisions: [] }),
}));
jest.mock('../../services/reportCompetitorIntelligenceServiceHelpers', () => ({
  ...jest.requireActual('../../services/reportCompetitorIntelligenceServiceHelpers'),
  fetchSerpResultsForKeyword: async () => [],
}));
jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: async (url: unknown) => {
    mockOutbound.push(String(url));
    throw new Error('outbound HTTP blocked in characterization test');
  },
}));

jest.setTimeout(120_000);

const PROFILE = {
  company_id: CO_A,
  name: 'Acme Ltd',
  website_url: 'https://acme.example',
  industry: 'Industrial Supplies',
  category: 'Industrial Supplies',
  products_services: 'Widgets, Gadgets',
  brand_positioning: 'Reliable industrial widgets',
  target_audience: 'Plant managers',
};
const getProfileMock = getCanonicalProfile as jest.Mock;

function field(source: unknown, key: string): unknown {
  return source && typeof source === 'object' ? (source as Record<string, unknown>)[key] : undefined;
}

/** The company-grounding fields of a snapshot report, read without assuming its shape. */
function grounding(report: unknown) {
  const ctx = field(report, 'company_context');
  const identityFields = field(field(report, 'company_identity'), 'fields');
  return {
    company_name: field(ctx, 'company_name') ?? null,
    domain: field(ctx, 'domain') ?? null,
    primary_offering: field(ctx, 'primary_offering') ?? null,
    positioning: field(ctx, 'positioning') ?? null,
    identity_keys: Array.isArray(identityFields) ? identityFields.map((f) => field(f, 'key')) : [],
  };
}

const UNGROUNDED = {
  company_name: null,
  domain: null,
  primary_offering: null,
  positioning: null,
  identity_keys: ['differentiation'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockOutbound.length = 0;
  seed({ companies: [{ id: CO_A, status: 'active', name: 'Acme Ltd' }] });
  getProfileMock.mockResolvedValue({ ...PROFILE });
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    mockOutbound.push(String(url));
    throw new Error('outbound HTTP blocked in characterization test');
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/reports/snapshot — company grounding (characterization)', () => {
  it('A. the route returns 200 without loading the profile, so brand / website / products are absent', async () => {
    const res = await invoke(snapshotHandler, { method: 'GET', as: 'A', query: { company_id: CO_A } });

    expect(res.status).toBe(200);
    expect(getProfileMock).not.toHaveBeenCalled();
    expect(grounding(res.body)).toEqual(UNGROUNDED);
    expect(mockOutbound).toEqual([]);
  });

  it('B. composing without input directly gives the same result: the route adds or strips nothing', async () => {
    const report = await composeSnapshotReport(CO_A);

    expect(getProfileMock).not.toHaveBeenCalled();
    expect(grounding(report)).toEqual(UNGROUNDED);
  });

  it('C. composing with the resolved input is fully grounded: serializer and fallbacks are not the cause', async () => {
    const resolvedInput = await resolveReportInput({ companyId: CO_A, reportCategory: 'snapshot' });
    const report = await composeSnapshotReport(CO_A, { resolvedInput });

    expect(getProfileMock).toHaveBeenCalledTimes(1);
    expect(grounding(report)).toEqual({
      company_name: 'Acme Ltd',
      domain: 'acme.example',
      primary_offering: 'Widgets',
      positioning: 'Reliable industrial widgets',
      identity_keys: ['offering', 'positioning', 'market', 'differentiation'],
    });
    // Once a domain is known the compose path reaches out (all refused here).
    expect(mockOutbound.length).toBeGreaterThan(0);
  });
});
