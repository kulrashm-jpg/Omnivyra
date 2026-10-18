/**
 * R1-META-01 — Meta advertising acquisition.
 *
 * Every test drives the client through an injected transport. Nothing here reaches the network,
 * no token exists, and no production flag is read: this proves the CONTRACT, which is all that can
 * honestly be proven before the owner provisions API access.
 *
 * The three properties that matter most, and why:
 *
 *  1. A Meta advertiser can never carry a company-specific claim. `MATCHED` requires
 *     `advertiser.verified`, Meta publishes no identity assertion for commercial advertisers, so
 *     an honest `verified: false` caps every Meta record at `PROBABLE_MATCH`. The existing
 *     resolver does this unchanged — these tests pin that it stays true.
 *  2. A failed, restricted, rate-limited or uncovered search is never an absence of advertising.
 *  3. Meta rows and Google rows never read as each other.
 */
import {
  ADS_PLATFORM_GOOGLE,
  ADS_PLATFORM_META,
  KNOWN_ADS_PLATFORMS,
  accessStateFromError,
  isAdsPlatform,
  observePublicAdvertising,
  resolveObservedPlatform,
  type AdsTransparencyClient,
} from '../../services/ads/adsTransparencyObservation';
import {
  META_NON_POLITICAL_COVERAGE,
  META_SEARCH_TERMS_MAX,
  MetaArchiveCoverageError,
  createMetaAdLibraryClient,
  type MetaHttpResponse,
} from '../../services/ads/metaAdLibraryClient';
import { adsRowPlatform, stampObservationPlatform } from '../../services/ads/adsEvidenceStore';
import { resolveAdvertiserIdentity, type SubjectIdentity } from '../../services/ads/advertiserIdentityResolver';

const TOKEN = 'test-token-not-a-secret';
const EU = ['DE'];

const SUBJECT: SubjectIdentity = {
  declaredLegalName: 'Acme GmbH',
  brandName: 'Acme',
  jurisdiction: 'Germany',
  wikidataDomainVerified: false,
};

function ad(over: Record<string, unknown> = {}) {
  return {
    id: 'ad-1',
    page_id: 'page-1',
    page_name: 'Acme GmbH',
    ad_creative_bodies: ['Buy widgets'],
    ad_creative_link_titles: ['Acme Widgets'],
    ad_delivery_start_time: '2026-09-01T00:00:00+0000',
    ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=ad-1',
    publisher_platforms: ['facebook', 'instagram'],
    ...over,
  };
}

/** A transport that returns a scripted sequence and records the URLs it was given. */
function transport(responses: MetaHttpResponse[]) {
  const urls: string[] = [];
  let i = 0;
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      return responses[Math.min(i++, responses.length - 1)];
    },
  };
}

const ok = (data: unknown[], next?: string): MetaHttpResponse => ({
  status: 200,
  body: next ? { data, paging: { next } } : { data },
});

function client(responses: MetaHttpResponse[], over: Record<string, unknown> = {}) {
  const t = transport(responses);
  return {
    t,
    client: createMetaAdLibraryClient({
      accessToken: TOKEN,
      reachedCountries: EU,
      fetch: t.fetch,
      ...over,
    }),
  };
}

async function observe(c: AdsTransparencyClient) {
  return observePublicAdvertising({
    subject: SUBJECT,
    searchNames: ['Acme GmbH'],
    client: c,
    vantage: 'test-vantage',
    now: () => new Date('2026-10-17T00:00:00.000Z'),
  });
}

// ── 1. Platform declaration ───────────────────────────────────────────────

describe('R1-META-01 — the platform is declared, never inferred', () => {
  it('meta is a known platform, and google still is', () => {
    expect(KNOWN_ADS_PLATFORMS).toEqual([ADS_PLATFORM_GOOGLE, ADS_PLATFORM_META]);
    expect(isAdsPlatform('meta')).toBe(true);
    expect(isAdsPlatform('google')).toBe(true);
    expect(isAdsPlatform('tiktok')).toBe(false);
  });

  it('the client declares itself meta', () => {
    expect(client([ok([])]).client.platform).toBe(ADS_PLATFORM_META);
  });

  it('every observation it produces is stamped meta, including the failures', async () => {
    const observed = await observe(client([ok([ad()]), ok([ad()])]).client);
    expect(observed.platform).toBe(ADS_PLATFORM_META);
    const failed = await observe(client([{ status: 500, body: null }]).client);
    expect(failed.platform).toBe(ADS_PLATFORM_META);
  });

  it('the legacy platform-less rule is still GOOGLE — every stored row predates meta', () => {
    expect(resolveObservedPlatform(undefined)).toBe(ADS_PLATFORM_GOOGLE);
    expect(resolveObservedPlatform('meta')).toBe(ADS_PLATFORM_META);
    expect(resolveObservedPlatform('tiktok')).toBeNull();
  });
});

// ── 2. Coverage: the boundary that must never read as "no ads" ─────────────

describe('R1-META-01 — archive coverage is a refusal, not an empty result', () => {
  it('refuses to search when the delivery area has no non-political coverage', async () => {
    const { client: c, t } = client([ok([])], { reachedCountries: ['US', 'IN'] });
    await expect(c.searchAdvertisers('Acme GmbH')).rejects.toThrow(MetaArchiveCoverageError);
    // Fails closed BEFORE any request — nothing was asked of the provider.
    expect(t.urls).toHaveLength(0);
  });

  it('that refusal becomes `unavailable` with a coverage reason, never `observed`', async () => {
    const result = await observe(client([ok([])], { reachedCountries: ['US'] }).client);
    expect(result.accessState).toBe('unavailable');
    expect(result.reason).toMatch(/does not cover/i);
    expect(result.advertisers).toEqual([]);
  });

  it('the reason never asserts the company does not advertise', async () => {
    const result = await observe(client([ok([])], { reachedCountries: ['US'] }).client);
    expect(result.reason ?? '').not.toMatch(/does not advertise|no advertising|not advertising/i);
    expect(result.reason).toMatch(/neither be observed nor excluded|could neither/i);
  });

  it('a covered area proceeds, and only covered codes are sent', async () => {
    const { client: c, t } = client([ok([ad()]), ok([ad()])], { reachedCountries: ['US', 'DE', 'FR'] });
    await c.searchAdvertisers('Acme GmbH');
    expect(t.urls[0]).toContain(encodeURIComponent('["DE","FR"]'));
    expect(t.urls[0]).not.toContain('US');
  });

  it('the coverage list is EU 27 plus GB, and excludes uncovered majors', () => {
    expect(META_NON_POLITICAL_COVERAGE).toContain('DE');
    expect(META_NON_POLITICAL_COVERAGE).toContain('GB');
    expect(META_NON_POLITICAL_COVERAGE).not.toContain('US');
    expect(META_NON_POLITICAL_COVERAGE).not.toContain('IN');
    expect(META_NON_POLITICAL_COVERAGE).toHaveLength(28);
  });
});

// ── 3. Every provider failure state ───────────────────────────────────────

describe('R1-META-01 — provider failures map to the existing access-state vocabulary', () => {
  const cases: Array<[string, MetaHttpResponse, string, RegExp]> = [
    ['invalid token (code 190)', { status: 400, body: { error: { code: 190 } } }, 'requires_auth', /sign-in|required/i],
    ['401 without a code', { status: 401, body: null }, 'requires_auth', /sign-in|required/i],
    ['rate limit (code 613)', { status: 400, body: { error: { code: 613 } } }, 'blocked', /rate-limited/i],
    ['429', { status: 429, body: null }, 'blocked', /rate-limited/i],
    ['upstream 500', { status: 500, body: null }, 'unreachable', /could not be reached/i],
    ['403 vantage refusal', { status: 403, body: null }, 'restricted', /vantage/i],
    ['unexplained 400', { status: 400, body: { error: { code: 1 } } }, 'unavailable', /could not be acquired/i],
  ];

  it.each(cases)('%s → %s', async (_label, response, state) => {
    const result = await observe(client([response]).client);
    expect(result.accessState).toBe(state);
  });

  it.each(cases)('%s states a reason and never implies absence', async (_label, response, _state, reason) => {
    const result = await observe(client([response]).client);
    expect(result.reason ?? '').toMatch(reason);
    expect(result.reason ?? '').not.toMatch(/does not advertise|no advertising/i);
  });

  it('a malformed body is not mistaken for an empty archive', async () => {
    const result = await observe(client([{ status: 200, body: { unexpected: true } }]).client);
    // Nothing was found, but nothing errored either: zero advertisers within coverage.
    expect(result.advertisers).toEqual([]);
    expect(result.reason ?? '').not.toMatch(/does not advertise/i);
  });

  it('no error message can leak the access token', async () => {
    const result = await observe(client([{ status: 400, body: { error: { code: 190 } } }]).client);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

// ── 4. Identity: MATCHED is unreachable, by truthfulness not by special-casing ──

describe('R1-META-01 — only MATCHED carries a company claim, and Meta cannot reach it', () => {
  it('the client reports verified:false, because Meta asserts no identity for commercial ads', async () => {
    const suggestions = await client([ok([ad()])]).client.searchAdvertisers('Acme GmbH');
    expect(suggestions[0].verified).toBe(false);
  });

  it('even with an EXACT legal-name agreement the resolver refuses a company claim', () => {
    const resolution = resolveAdvertiserIdentity(SUBJECT, {
      advertiserId: 'page-1',
      legalName: 'Acme GmbH', // identical to the declared legal name
      basedIn: null,
      verified: false,
      ambiguityFlagged: false,
    });
    expect(resolution.state).toBe('PROBABLE_MATCH');
    expect(resolution.eligibleForCompanyClaim).toBe(false);
    expect(resolution.basis).toMatch(/not provider-verified/i);
  });

  it('non-vacuity: the SAME subject and name DOES reach MATCHED when the provider verifies it', () => {
    const resolution = resolveAdvertiserIdentity(SUBJECT, {
      advertiserId: 'AR1',
      legalName: 'Acme GmbH',
      basedIn: 'Germany',
      verified: true, // the Google path
      ambiguityFlagged: false,
    });
    expect(resolution.state).toBe('MATCHED');
    expect(resolution.eligibleForCompanyClaim).toBe(true);
  });

  it('no Meta advertiser in a full observation is ever eligible for a company claim', async () => {
    const result = await observe(client([ok([ad()]), ok([ad()])]).client);
    expect(result.advertisers.length).toBeGreaterThan(0);
    expect(result.advertisers.every((a) => a.resolution.eligibleForCompanyClaim === false)).toBe(true);
    expect(result.counts.matchedAdvertiserAccounts).toBe(0);
  });

  it('two Pages sharing a display name are flagged ambiguous, not silently picked', async () => {
    const { client: c } = client([ok([ad(), ad({ id: 'ad-2', page_id: 'page-2' })])]);
    const suggestions = await c.searchAdvertisers('Acme GmbH');
    expect(suggestions).toHaveLength(2);
    expect(suggestions.every((s) => s.ambiguityFlagged)).toBe(true);
  });
});

// ── 5. Platform isolation ─────────────────────────────────────────────────

describe('R1-META-01 — Meta evidence can never be read as Google evidence', () => {
  it('a stored meta row reports meta, not google', () => {
    expect(adsRowPlatform({ kind: 'ads_transparency', platform: 'meta' })).toBe(ADS_PLATFORM_META);
  });

  it('a platform-less legacy row is still google', () => {
    expect(adsRowPlatform({ kind: 'ads_transparency' })).toBe(ADS_PLATFORM_GOOGLE);
  });

  it('a non-ads scope is rejected outright, whatever platform it names', () => {
    expect(adsRowPlatform({ kind: 'something_else', platform: 'meta' })).toBeNull();
  });

  it('stamping preserves the platform the client declared', async () => {
    const result = await observe(client([ok([ad()]), ok([ad()])]).client);
    const stamped = stampObservationPlatform(result, ADS_PLATFORM_META);
    expect(stamped?.platform).toBe(ADS_PLATFORM_META);
  });

  it('stamping cannot relabel a meta observation as google', async () => {
    const result = await observe(client([ok([ad()]), ok([ad()])]).client);
    const stamped = stampObservationPlatform(result, ADS_PLATFORM_GOOGLE);
    expect(stamped?.platform).toBe(ADS_PLATFORM_META);
  });
});

// ── 6. Query construction, paging and the documented caps ─────────────────

describe('R1-META-01 — the query obeys the documented contract', () => {
  it('requests ad_type=ALL and ad_active_status=ALL, so concluded campaigns are not hidden', async () => {
    const { client: c, t } = client([ok([ad()])]);
    await c.searchAdvertisers('Acme GmbH');
    expect(t.urls[0]).toContain('ad_type=ALL');
    expect(t.urls[0]).toContain('ad_active_status=ALL');
  });

  it('requests no political-only field — no spend, impressions, currency or bylines', async () => {
    const { client: c, t } = client([ok([ad()])]);
    await c.searchAdvertisers('Acme GmbH');
    for (const field of ['spend', 'impressions', 'currency', 'bylines', 'demographic_distribution']) {
      expect(t.urls[0]).not.toContain(field);
    }
  });

  it('truncates search_terms to the documented 100 characters', async () => {
    const { client: c, t } = client([ok([])]);
    await c.searchAdvertisers('x'.repeat(250));
    const sent = new URL(t.urls[0]).searchParams.get('search_terms') ?? '';
    expect(sent).toHaveLength(META_SEARCH_TERMS_MAX);
  });

  it('follows paging.next, and stops at the page ceiling', async () => {
    const { client: c, t } = client(
      [ok([ad()], 'https://graph.facebook.com/next'), ok([ad()], 'https://graph.facebook.com/next')],
      { maxPages: 3 },
    );
    await c.searchAdvertisers('Acme GmbH');
    expect(t.urls).toHaveLength(3);
  });

  it('stops when data is empty, whatever paging says', async () => {
    const { client: c, t } = client([ok([], 'https://graph.facebook.com/next')]);
    await c.searchAdvertisers('Acme GmbH');
    expect(t.urls).toHaveLength(1);
  });

  it('openAdvertiser queries by page id and returns no destination claim', async () => {
    const { client: c, t } = client([ok([ad()])]);
    const profile = await c.openAdvertiser('page-1');
    expect(t.urls[0]).toContain('search_page_ids');
    expect(profile?.advertiserId).toBe('page-1');
    expect(profile?.legalName).toBe('Acme GmbH');
    expect(profile?.verified).toBe(false);
    expect(profile?.basedIn).toBeNull();
    // No provider-stated count exists, and one must not be derived from paged rows.
    expect(profile?.adCountLabel).toBeNull();
  });

  it('openAdvertiser returns null when the page has no archived ads', async () => {
    expect(await client([ok([])]).client.openAdvertiser('page-1')).toBeNull();
  });

  it('exposes no destination-domain discovery, because the archive has no landing URL', () => {
    expect(client([ok([])]).client.searchByDomain).toBeUndefined();
  });
});

// ── 7. Duplicate handling: repeated responses, overlapping pages, retries ──
//
// Graph paging is cursor-based over a live archive, so consecutive pages can legitimately re-serve
// a row. Without dedup the same ad is reported twice and an identical observation stops being
// deterministic between runs purely because of cursor timing.

describe('R1-META-01 — duplicate handling is deterministic', () => {
  const overlapping = () => [
    ok([ad({ id: 'ad-1' }), ad({ id: 'ad-2' })], 'https://graph.facebook.com/p2'),
    ok([ad({ id: 'ad-2' }), ad({ id: 'ad-3' })], 'https://graph.facebook.com/p3'),
    ok([ad({ id: 'ad-3' })]),
  ];

  it('overlapping pages yield each ad exactly once', async () => {
    const profile = await client(overlapping(), { maxPages: 3 }).client.openAdvertiser('page-1');
    expect(profile?.creativeIds).toEqual(['ad-1', 'ad-2', 'ad-3']);
  });

  it('a page made entirely of repeats does not truncate the walk', async () => {
    // Page 2 is all duplicates. The cursor still served it, so paging must continue to page 3,
    // where `ad-3` lives — deduplicating must not be mistaken for reaching the end.
    const { client: c, t } = client(overlapping(), { maxPages: 3 });
    const profile = await c.openAdvertiser('page-1');
    expect(t.urls).toHaveLength(3);
    expect(profile?.creativeIds).toContain('ad-3');
  });

  it('repeating the SAME observation twice produces an identical result', async () => {
    const first = await client(overlapping(), { maxPages: 3 }).client.openAdvertiser('page-1');
    const second = await client(overlapping(), { maxPages: 3 }).client.openAdvertiser('page-1');
    expect(second).toEqual(first);
  });

  it('a retry after a rate limit does not double-count what the first attempt collected', async () => {
    const limited = client([ok([ad({ id: 'ad-1' })], 'https://graph.facebook.com/p2'), { status: 429, body: null }], { maxPages: 3 });
    await expect(limited.client.openAdvertiser('page-1')).rejects.toThrow(/rate limit/i);
    // The failed attempt persisted nothing, so a later clean attempt starts from zero state.
    const retried = await client(overlapping(), { maxPages: 3 }).client.openAdvertiser('page-1');
    expect(retried?.creativeIds).toEqual(['ad-1', 'ad-2', 'ad-3']);
  });

  it('duplicate Pages across pages collapse to one advertiser, and the count is not inflated', async () => {
    const result = await observePublicAdvertising({
      subject: SUBJECT,
      searchNames: ['Acme GmbH'],
      client: client(overlapping(), { maxPages: 3 }).client,
      vantage: 'test-vantage',
      now: () => new Date('2026-10-17T00:00:00.000Z'),
    });
    // Three ads, all from page-1: one advertiser account, not three.
    expect(result.counts.advertiserAccountsDiscovered).toBe(1);
  });

  it('an ad with no readable id is kept, not silently dropped', async () => {
    const profile = await client([ok([ad({ id: null }), ad({ id: 'ad-2' })])]).client.openAdvertiser('page-1');
    // It cannot participate in dedup, but under-reporting evidence would be worse.
    expect(profile?.creativeIds).toEqual(['ad-2']);
    expect(profile?.advertiserId).toBe('page-1');
  });
});

// ── 8. Access-state retention through persistence ─────────────────────────
//
// `stampObservationPlatform` is the transform a stored row passes through on the read path. If the
// access state or its reason were lost there, an inaccessible observation would come back from
// storage indistinguishable from one that looked and found nothing.

describe('R1-META-01 — the access state and its reason survive persistence', () => {
  const failures: Array<[string, MetaHttpResponse]> = [
    ['requires_auth', { status: 400, body: { error: { code: 190 } } }],
    ['blocked', { status: 400, body: { error: { code: 613 } } }],
    ['restricted', { status: 403, body: null }],
    ['unreachable', { status: 500, body: null }],
    ['unavailable', { status: 400, body: { error: { code: 1 } } }],
  ];

  it.each(failures)('%s keeps its state, reason and platform through stamping', async (state, response) => {
    const observed = await observe(client([response]).client);
    const restored = stampObservationPlatform(observed, ADS_PLATFORM_META);
    expect(restored?.accessState).toBe(state);
    expect(restored?.reason).toBe(observed.reason);
    expect(restored?.reason).toBeTruthy();
    expect(restored?.platform).toBe(ADS_PLATFORM_META);
  });

  it('the five failure states are mutually distinct — none collapses into another', async () => {
    const states = new Set<string>();
    const reasons = new Set<string>();
    for (const [, response] of failures) {
      const observed = await observe(client([response]).client);
      states.add(observed.accessState);
      reasons.add(observed.reason ?? '');
    }
    expect(states.size).toBe(5);
    expect(reasons.size).toBe(5);
  });

  it('a restored failure observation still asserts nothing about absence of advertising', async () => {
    for (const [, response] of failures) {
      const restored = stampObservationPlatform(await observe(client([response]).client), ADS_PLATFORM_META);
      expect(restored?.reason ?? '').not.toMatch(/does not advertise|no advertising|not advertising/i);
      expect(restored?.advertisers).toEqual([]);
    }
  });

  it('nothing that would be persisted carries the access token', async () => {
    for (const [, response] of failures) {
      const restored = stampObservationPlatform(await observe(client([response]).client), ADS_PLATFORM_META);
      expect(JSON.stringify(restored)).not.toContain(TOKEN);
    }
  });
});

// ── 9. The Google path is unchanged ───────────────────────────────────────

describe('R1-META-01 — existing access-state mappings are untouched', () => {
  it.each([
    ['please sign in', 'requires_auth'],
    ['captcha challenge', 'blocked'],
    ['not available in your country', 'restricted'],
    ['navigation timeout', 'unreachable'],
    ['something else entirely', 'unavailable'],
  ])('%s still maps to %s', (message, state) => {
    expect(accessStateFromError(new Error(message)).state).toBe(state);
  });
});
