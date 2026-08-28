/**
 * Phase 97 — ingestion resolves campaign → company through THE seam.
 *
 * WHY THIS EXISTS
 * ---------------
 * PR #79 declared `resolveCampaignCompanyId` the canonical campaign → company
 * resolution. Ingestion carried its own inline copy of exactly that logic —
 * same table, same filter, same ordering, same null handling — which agreed
 * with the seam by coincidence rather than by construction.
 *
 * That is the same shape as the defect this whole workstream started from: the
 * X reply URL existed in two places, so fixing one left the other answering
 * 404s. A second copy of a resolution rule is a place for the two to drift, and
 * this one decides which company an ingested comment is attributed to — so
 * drift here is a cross-tenant attribution bug, not a style problem.
 *
 * These tests pin the seam as the ONLY path, and pin the tenant behaviour that
 * must not change while swapping implementations.
 */

// Marks this file as a MODULE. Without a top-level import or export TypeScript
// treats a test file as a script, so its top-level `const`s land in the global
// scope and collide with identically-named mocks in sibling suites — which the
// certification typecheck catches even though jest runs each file in its own
// sandbox and never sees the clash.
export {};

jest.mock('@/config', () => ({ config: {}, getValidatedConfig: () => ({}) }));

const mockResolveCampaignCompanyId = jest.fn();
const mockGetLatestCampaignVersion = jest.fn();
const mockSyncUnified = jest.fn();
const mockGetToken = jest.fn();
const mockGetScheduledPost = jest.fn();
const mockAdapterFetch = jest.fn();
const roleLookup = jest.fn();

jest.mock('../../services/campaignAccessService', () => ({
  resolveCampaignCompanyId: (...a: any[]) => mockResolveCampaignCompanyId(...a),
}));
// If the old inline path ever returns, this mock proves it: the seam test would
// still pass while THIS counter moved off zero.
jest.mock('../../db/campaignVersionStore', () => ({
  getLatestCampaignVersionByCampaignId: (...a: any[]) => mockGetLatestCampaignVersion(...a),
}));
jest.mock('../../auth/tokenStore', () => ({
  getToken: (...a: any[]) => mockGetToken(...a),
  isTokenExpiringSoon: () => false,
  markSocialAccountNeedsReauth: jest.fn(),
}));
jest.mock('../../auth/tokenRefresh', () => ({ refreshPlatformToken: jest.fn() }));
jest.mock('../../db/queries', () => ({ getScheduledPost: (...a: any[]) => mockGetScheduledPost(...a) }));
jest.mock('../../services/platformAdapters', () => ({
  getPlatformAdapter: () => ({ fetchComments: (...a: any[]) => mockAdapterFetch(...a) }),
}));
jest.mock('../../services/platformRegistryService', () => ({ getPlatformCategory: () => 'social' }));
jest.mock('../../services/engagementNormalizationService', () => ({
  syncFromPostComments: (...a: any[]) => mockSyncUnified(...a),
}));
jest.mock('../../db/supabaseClient', () => ({ supabase: {} }));
jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => roleLookup() }) }) }) }),
    upsert: () => ({ select: async () => ({ data: [], error: null }) }),
  }),
}));

let ingestComments: typeof import('../../services/engagementIngestionService').ingestComments;

beforeAll(async () => {
  ({ ingestComments } = await import('../../services/engagementIngestionService'));
});

/** One comment comes back, so the attribution branch actually runs. */
const ONE_COMMENT = { data: [{ id: 'c1', text: 'hello', author_id: 'a1', created_at: '2026-01-01T00:00:00Z' }] };

beforeEach(() => {
  jest.clearAllMocks();
  roleLookup.mockReturnValue({ data: null });
  mockGetScheduledPost.mockResolvedValue({
    id: 'p1', platform: 'x', platform_post_id: 't1',
    social_account_id: 'acct-1', campaign_id: 'camp-1', user_id: 'user-1',
  });
  mockGetToken.mockResolvedValue({ access_token: 'tok', refresh_token: 'r', is_active: true });
  mockAdapterFetch.mockResolvedValue(ONE_COMMENT);
  mockResolveCampaignCompanyId.mockResolvedValue('co-1');
});

describe('A — the canonical seam is the resolution path', () => {
  it('CRITICAL: campaign → company goes through resolveCampaignCompanyId', async () => {
    const r = await ingestComments('p1');

    expect(r.success).toBe(true);
    expect(mockResolveCampaignCompanyId).toHaveBeenCalledTimes(1);
    expect(mockResolveCampaignCompanyId).toHaveBeenCalledWith('camp-1');
  });

  it('CRITICAL: the old inline campaign-version read is gone', async () => {
    await ingestComments('p1');
    // The duplicate this phase removed. If it comes back, this moves off zero.
    expect(mockGetLatestCampaignVersion).not.toHaveBeenCalled();
  });

  it('resolves exactly once per ingest — the seam is not called per comment', async () => {
    mockAdapterFetch.mockResolvedValue({
      data: [
        { id: 'c1', text: 'a', author_id: 'x', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c2', text: 'b', author_id: 'y', created_at: '2026-01-01T00:00:00Z' },
        { id: 'c3', text: 'c', author_id: 'z', created_at: '2026-01-01T00:00:00Z' },
      ],
    });
    await ingestComments('p1');
    expect(mockResolveCampaignCompanyId).toHaveBeenCalledTimes(1);
  });
});

describe('B — tenant attribution is unchanged by the swap', () => {
  it('CRITICAL: the resolved company is what engagement is attributed to', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue('co-77');

    await ingestComments('p1');

    expect(mockSyncUnified).toHaveBeenCalled();
    const ctx = mockSyncUnified.mock.calls[0][1];
    expect(ctx.organization_id).toBe('co-77');
  });

  it('CRITICAL: an unresolvable campaign does not invent a company', async () => {
    // Null must stay null through to attribution — never a fallback tenant.
    mockResolveCampaignCompanyId.mockResolvedValue(null);
    roleLookup.mockReturnValue({ data: null });

    await ingestComments('p1');

    const ctx = mockSyncUnified.mock.calls[0][1];
    expect(ctx.organization_id).toBeNull();
  });

  it('the user-role fallback still applies only when the campaign resolves nothing', async () => {
    mockResolveCampaignCompanyId.mockResolvedValue(null);
    roleLookup.mockReturnValue({ data: { company_id: 'co-fallback' } });

    await ingestComments('p1');

    expect(mockSyncUnified.mock.calls[0][1].organization_id).toBe('co-fallback');
  });

  it('CRITICAL: the campaign answer wins over the user-role fallback', async () => {
    // Order matters: a user may belong to several companies; the campaign is
    // the authoritative owner of the post being ingested.
    mockResolveCampaignCompanyId.mockResolvedValue('co-authoritative');
    roleLookup.mockReturnValue({ data: { company_id: 'co-other' } });

    await ingestComments('p1');

    expect(mockSyncUnified.mock.calls[0][1].organization_id).toBe('co-authoritative');
  });

  it('a post with no campaign skips resolution entirely', async () => {
    mockGetScheduledPost.mockResolvedValue({
      id: 'p1', platform: 'x', platform_post_id: 't1',
      social_account_id: 'acct-1', campaign_id: null, user_id: 'user-1',
    });
    roleLookup.mockReturnValue({ data: { company_id: 'co-role' } });

    await ingestComments('p1');

    expect(mockResolveCampaignCompanyId).not.toHaveBeenCalled();
    expect(mockSyncUnified.mock.calls[0][1].organization_id).toBe('co-role');
  });
});
