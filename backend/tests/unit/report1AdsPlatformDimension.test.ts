/**
 * REPORT-1 WP-1 — the PLATFORM dimension of the advertising evidence model.
 *
 * WHY THIS SUITE EXISTS. The advertising model was structurally single-provider: no field named
 * the platform anywhere, and the persistence scope carried only `kind: 'ads_transparency'`. Every
 * observation was Google because the only client was Google — an assumption held in people's heads
 * rather than in the evidence. Three things have to be pinned for that to stop being true:
 *
 *  • an observation must be stamped with the platform its CLIENT declared, on every return path
 *    including the failures — "we could not look" is still about a specific platform;
 *  • the platform must survive persistence and come back out on the Report 1 surface, so a
 *    renderer can label evidence instead of inferring it;
 *  • a row written BEFORE the field existed must be interpreted by one explicit, stated rule
 *    (it is Google), and a row naming a platform this build does not know must NOT be served as
 *    Google — an unknown platform coerced to Google would be a fabricated attribution.
 *
 * And the whole change must be invisible to the existing Google path. Those regression checks are
 * here too, beside the new behaviour, rather than only in the suites that predate it.
 *
 * SECRETS: none. Everything is pure or runs against an in-memory fake of the evidence table.
 */
import {
  ADS_PLATFORM_GOOGLE,
  KNOWN_ADS_PLATFORMS,
  LEGACY_ADS_PLATFORM,
  isAdsPlatform,
  observePublicAdvertising,
  resolveObservedPlatform,
  type AdsObservationResult,
  type AdsTransparencyClient,
  type AdvertiserProfileObservation,
} from '../../services/ads/adsTransparencyObservation';
import { buildAdvertisingSurface } from '../../services/ads/advertisingSurface';
import { adsHistoryForPlatform } from '../../services/ads/adsDueSubjects';
import type { SubjectIdentity } from '../../services/ads/advertiserIdentityResolver';

// ── The evidence table, faked in memory ───────────────────────────────────────
//
// Both the write and the read path are exercised against the SAME rows, so "round-trips" means
// what it says: the row a persist produced is the row a load consumes.

type StoredRow = {
  id: string;
  company_id: string;
  observed_at: string;
  scope: Record<string, unknown>;
  evidence_count: number;
  evidence_sources: unknown;
  signal_summary: Record<string, unknown>;
};

/**
 * `mock`-prefixed so it may be referenced from a hoisted `jest.mock` factory. Both the write and
 * the read path are pointed at this ONE array, so "round-trips" means exactly that: the row a
 * persist produced is the row a load consumes.
 */
const mockRows: StoredRow[] = [];

jest.mock('../../db/writeOwner', () => ({
  ownedDbTable: () => ({
    insert: async (row: StoredRow) => {
      mockRows.push(row);
      return { error: null };
    },
  }),
}));

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: () => {
      // The production read is `.select(...).eq('company_id', …).order(…).limit(25)`.
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({ data: mockRows, error: null }),
      };
      return builder;
    },
  },
}));

import {
  adsRowPlatform,
  createAdsEvidenceSink,
  loadLatestAdsObservation,
} from '../../services/ads/adsEvidenceStore';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SUBJECT: SubjectIdentity = {
  declaredLegalName: 'Wix.com Ltd',
  brandName: 'Wix',
  jurisdiction: 'Israel',
  wikidataDomainVerified: false,
};

const profile = (over: Partial<AdvertiserProfileObservation> = {}): AdvertiserProfileObservation => ({
  advertiserId: 'AR_IL',
  legalName: 'Wix.com Ltd',
  basedIn: 'Israel',
  verified: true,
  ambiguityFlagged: false,
  adCountLabel: '~200 ads',
  creativeIds: [],
  profileUrl: 'https://adstransparency.google.com/advertiser/AR_IL',
  ...over,
});

/** The Google client, as production declares it: platform stated, not inferred. */
const googleClient = (over: Partial<AdsTransparencyClient> = {}): AdsTransparencyClient => ({
  platform: ADS_PLATFORM_GOOGLE,
  searchAdvertisers: async () => [
    { advertiserId: 'AR_IL', name: 'Wix.com Ltd', basedIn: 'Israel', verified: true, ambiguityFlagged: false, adCountLabel: '~200 ads' },
  ],
  openAdvertiser: async (id: string) => profile({ advertiserId: id }),
  ...over,
});

const observe = (client: AdsTransparencyClient = googleClient()) =>
  observePublicAdvertising({
    subject: SUBJECT,
    searchNames: ['Wix.com Ltd'],
    vantage: 'railway:us-west2',
    client,
    now: () => new Date('2026-09-27T08:08:00.000Z'),
  });

beforeEach(() => {
  mockRows.length = 0;
});

// ── 1. The vocabulary ─────────────────────────────────────────────────────────

describe('the platform vocabulary is declared, never inferred', () => {
  it('declares exactly one platform, because exactly one client exists', () => {
    // A second member here without a client that can observe it would be a promise the
    // acquisition cannot keep. Adding one is deliberately a code change, not a data change.
    expect(KNOWN_ADS_PLATFORMS).toEqual(['google']);
    expect(ADS_PLATFORM_GOOGLE).toBe('google');
  });

  it('recognises only platforms this build can actually observe', () => {
    expect(isAdsPlatform('google')).toBe(true);
    for (const unknown of ['meta', 'linkedin', 'tiktok', 'x', 'reddit', '', null, undefined, 7]) {
      expect(isAdsPlatform(unknown)).toBe(false);
    }
  });
});

// ── 2. The legacy rule, stated once and tested directly ───────────────────────

describe('the legacy rule — a platform-less observation is Google, explicitly', () => {
  it('reads an absent platform as Google', () => {
    expect(LEGACY_ADS_PLATFORM).toBe(ADS_PLATFORM_GOOGLE);
    expect(resolveObservedPlatform(undefined)).toBe('google');
    expect(resolveObservedPlatform(null)).toBe('google');
    expect(resolveObservedPlatform('')).toBe('google');
  });

  it('keeps a declared known platform as itself', () => {
    expect(resolveObservedPlatform('google')).toBe('google');
  });

  it('never coerces an UNKNOWN platform to Google', () => {
    // The dangerous case. A row written by a future build that observes another platform must not
    // be served as Google evidence — that would be an attribution nothing observed.
    expect(resolveObservedPlatform('meta')).toBeNull();
    expect(resolveObservedPlatform('linkedin')).toBeNull();
    expect(resolveObservedPlatform(42)).toBeNull();
  });

  it('applies the same rule to a stored scope, and rejects a non-ads scope outright', () => {
    expect(adsRowPlatform({ kind: 'ads_transparency' })).toBe('google');
    expect(adsRowPlatform({ kind: 'ads_transparency', platform: 'google' })).toBe('google');
    expect(adsRowPlatform({ kind: 'ads_transparency', platform: 'meta' })).toBeNull();
    expect(adsRowPlatform({ kind: 'serp_rank' })).toBeNull();
    expect(adsRowPlatform(null)).toBeNull();
  });
});

// ── 3. The observation carries the client's declaration ───────────────────────

describe('an observation is stamped with the platform its client declared', () => {
  it('stamps a successful observation', async () => {
    const result = await observe();
    expect(result.platform).toBe('google');
    expect(result.accessState).toBe('observed');
  });

  it('stamps every failure path too — "could not look" is about a specific platform', async () => {
    const blocked = await observe(googleClient({
      searchAdvertisers: async () => { throw new Error('unusual traffic detected'); },
    }));
    expect(blocked.accessState).toBe('blocked');
    expect(blocked.platform).toBe('google');

    const noAnchor = await observePublicAdvertising({
      subject: { declaredLegalName: null, brandName: null, jurisdiction: null, wikidataDomainVerified: false },
      searchNames: [],
      vantage: 'railway',
      client: googleClient(),
    });
    expect(noAnchor.accessState).toBe('unavailable');
    expect(noAnchor.platform).toBe('google');
  });

  it('falls back to the stated legacy rule only for an untyped client with no declaration', async () => {
    // The type makes `platform` mandatory; this covers a JavaScript caller predating the field.
    // The fallback is the SAME published rule as the read side, not a second silent default.
    const undeclared = { searchAdvertisers: async () => [], openAdvertiser: async () => null } as unknown as AdsTransparencyClient;
    const result = await observePublicAdvertising({
      subject: SUBJECT, searchNames: ['Wix.com Ltd'], vantage: 'railway', client: undeclared,
    });
    expect(result.platform).toBe(LEGACY_ADS_PLATFORM);
  });
});

// ── 4. Round trip: acquisition → persistence → Report 1 surface ───────────────

describe('platform round-trips through persistence and out to the Report 1 surface', () => {
  it('persists the platform into the JSONB scope beside the unchanged kind', async () => {
    const observation = await observe();
    await createAdsEvidenceSink().persist({
      companyId: 'company-1',
      domainId: 'domain-1',
      observedAt: observation.observedAt,
      vantage: observation.vantage,
      observation,
    });

    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].scope).toMatchObject({
      kind: 'ads_transparency',
      platform: 'google',
      domain_id: 'domain-1',
      vantage: 'railway:us-west2',
    });
    // The evidence KIND and the source key are UNCHANGED — the platform is a second dimension
    // beside them, not a re-keying of the row that the provenance map already reads.
    expect(mockRows[0].evidence_sources).toEqual(['ads_transparency']);
    // No aggregate ad count was introduced: the count is advertiser ACCOUNTS, as before.
    expect(mockRows[0].evidence_count).toBe(1);
  });

  it('loads it back and carries it all the way onto SnapshotAdvertising', async () => {
    const observation = await observe();
    await createAdsEvidenceSink().persist({
      companyId: 'company-1', domainId: 'domain-1',
      observedAt: observation.observedAt, vantage: observation.vantage, observation,
    });

    const loaded = await loadLatestAdsObservation({ companyId: 'company-1', domainId: 'domain-1' });
    expect(loaded).not.toBeNull();
    expect(loaded!.platform).toBe('google');

    const surface = buildAdvertisingSurface({ observation: loaded!, subjectLegalNameUsed: 'Wix.com Ltd' });
    expect(surface.platform).toBe('google');
    // Per-record too, so a later renderer can present more than one platform in one list.
    expect(surface.companyAdvertisers).toHaveLength(1);
    expect(surface.companyAdvertisers[0].platform).toBe('google');
  });

  it('serves a Google read only Google rows, and never a row of another platform', async () => {
    mockRows.push({
      id: 'r-meta', company_id: 'company-1', observed_at: '2026-09-28T00:00:00.000Z',
      scope: { kind: 'ads_transparency', platform: 'meta', domain_id: 'domain-1', vantage: 'railway' },
      evidence_count: 3, evidence_sources: ['ads_transparency'],
      signal_summary: { platform: 'meta', accessState: 'observed', advertisers: [], vantage: 'railway' },
    });

    // Newest first, as the production query orders. The unknown-platform row must be SKIPPED,
    // not returned as Google evidence — and must not shadow the Google row behind it.
    const observation = await observe();
    mockRows.push({
      id: 'r-google', company_id: 'company-1', observed_at: '2026-09-27T08:08:00.000Z',
      scope: { kind: 'ads_transparency', platform: 'google', domain_id: 'domain-1', vantage: 'railway:us-west2' },
      evidence_count: 1, evidence_sources: ['ads_transparency'],
      signal_summary: observation as unknown as Record<string, unknown>,
    });

    const loaded = await loadLatestAdsObservation({ companyId: 'company-1', domainId: 'domain-1' });
    expect(loaded!.platform).toBe('google');
    expect(loaded!.advertisers).toHaveLength(1);
  });
});

// ── 5. Backward compatibility with rows already in production ─────────────────

describe('legacy rows — written before the field existed', () => {
  /** Exactly what production holds: no `scope.platform`, no `signal_summary.platform`. */
  const legacyRow = (over: Partial<StoredRow> = {}): StoredRow => ({
    id: 'legacy-1',
    company_id: 'company-1',
    observed_at: '2026-09-27T08:08:00.000Z',
    scope: { kind: 'ads_transparency', domain_id: 'domain-1', vantage: 'railway:us-west2' },
    evidence_count: 0,
    evidence_sources: ['ads_transparency'],
    signal_summary: {
      accessState: 'observed', reason: null, vantage: 'railway:us-west2',
      observedAt: '2026-09-27T08:08:00.000Z', advertisers: [],
      counts: { domainAdCountLabel: null, advertiserAccountsDiscovered: 0, candidateAdvertisers: 0, matchedAdvertiserAccounts: 0 },
    },
    ...over,
  });

  it('is still found by a Google read', async () => {
    mockRows.push(legacyRow());
    const loaded = await loadLatestAdsObservation({ companyId: 'company-1', domainId: 'domain-1' });
    expect(loaded).not.toBeNull();
    expect(loaded!.accessState).toBe('observed');
  });

  it('comes back stamped `google` rather than platform-less', async () => {
    mockRows.push(legacyRow());
    const loaded = await loadLatestAdsObservation({ companyId: 'company-1', domainId: 'domain-1' });
    // The one place the legacy interpretation happens. Everything downstream sees an explicit
    // platform, so the assumption cannot silently reappear on the surface or in a renderer.
    expect(loaded!.platform).toBe('google');
    expect(buildAdvertisingSurface({ observation: loaded!, subjectLegalNameUsed: 'Wix.com Ltd' }).platform).toBe('google');
  });

  it('keeps the domain scoping it already had', async () => {
    mockRows.push(legacyRow());
    expect(await loadLatestAdsObservation({ companyId: 'company-1', domainId: 'other-domain' })).toBeNull();
    expect(await loadLatestAdsObservation({ companyId: 'company-1', domainId: null })).toBeNull();
  });

  it('counts as a Google attempt for the due rule, so the cadence is unchanged', () => {
    const rows = [{
      observed_at: '2026-09-27T08:08:00.000Z',
      scope: { kind: 'ads_transparency', domain_id: 'domain-1' },
      signal_summary: { accessState: 'observed' },
    }];
    expect(adsHistoryForPlatform(rows, { domainId: 'domain-1' })).toEqual([
      { observedAt: '2026-09-27T08:08:00.000Z', accessState: 'observed' },
    ]);
  });

  it('does not let another platform\'s row suppress Google acquisition', () => {
    const rows = [
      { observed_at: '2026-09-28T00:00:00.000Z', scope: { kind: 'ads_transparency', platform: 'meta', domain_id: 'domain-1' }, signal_summary: { accessState: 'observed' } },
      { observed_at: '2026-09-20T00:00:00.000Z', scope: { kind: 'ads_transparency', platform: 'google', domain_id: 'domain-1' }, signal_summary: { accessState: 'observed' } },
    ];
    // Without the platform filter the Meta row would read as a recent Google success and hold the
    // subject out of the cycle for a day, for a look that never happened on Google.
    expect(adsHistoryForPlatform(rows, { domainId: 'domain-1' })).toEqual([
      { observedAt: '2026-09-20T00:00:00.000Z', accessState: 'observed' },
    ]);
  });

  it('still excludes another domain, exactly as before', () => {
    const rows = [
      { observed_at: '2026-09-27T00:00:00.000Z', scope: { kind: 'ads_transparency', domain_id: 'other' }, signal_summary: { accessState: 'observed' } },
    ];
    expect(adsHistoryForPlatform(rows, { domainId: 'domain-1' })).toEqual([]);
  });
});

// ── 6. No provider behaviour regression ───────────────────────────────────────

describe('the existing Google path is unchanged in every respect but the new field', () => {
  it('produces the same surface it always did, plus `platform`', async () => {
    const surface = buildAdvertisingSurface({
      observation: await observe(),
      subjectLegalNameUsed: 'Wix.com Ltd',
    });

    expect(surface.source).toBe('ads_transparency');
    expect(surface.provenance).toBe('PUBLIC_OBSERVED');
    expect(surface.accessState).toBe('observed');
    expect(surface.vantage).toBe('railway:us-west2');
    expect(surface.observedAt).toBe('2026-09-27T08:08:00.000Z');
    expect(surface.subjectLegalNameUsed).toBe('Wix.com Ltd');
    expect(surface.otherAdvertisers).toEqual([]);
    expect(surface.counts).toEqual({
      domainAdCountLabel: null,
      advertiserAccountsDiscovered: 1,
      matchedAdvertiserAccounts: 1,
    });

    // The partition rule is untouched: MATCHED only, and the ad-count label stays verbatim.
    const record = surface.companyAdvertisers[0];
    expect(record.resolutionState).toBe('MATCHED');
    expect(record.adCountLabel).toBe('~200 ads');
    expect(record.discoveredVia).toBe('advertiser_name');
  });

  it('adds exactly one key to the surface and one to each advertiser record', async () => {
    const surface = buildAdvertisingSurface({ observation: await observe(), subjectLegalNameUsed: 'Wix.com Ltd' });
    expect(Object.keys(surface).sort()).toEqual([
      'accessState', 'companyAdvertisers', 'counts', 'observedAt', 'otherAdvertisers',
      'platform', 'provenance', 'reason', 'source', 'subjectLegalNameUsed', 'vantage',
    ]);
    expect(Object.keys(surface.companyAdvertisers[0])).toContain('platform');
  });

  it('introduces no platform-derived claim: platform never becomes a count or a verdict', async () => {
    const observation: AdsObservationResult = await observe();
    // `platform` is a label on evidence. It must not appear in, or alter, any counted quantity.
    expect(observation.counts).toEqual({
      domainAdCountLabel: null,
      advertiserAccountsDiscovered: 1,
      candidateAdvertisers: 1,
      matchedAdvertiserAccounts: 1,
    });
    expect(JSON.stringify(observation)).not.toMatch(/does not advertise|no advertising|zero ads/i);
  });
});
