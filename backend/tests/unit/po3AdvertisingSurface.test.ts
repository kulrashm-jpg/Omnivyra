/**
 * PO-3 Phases 2/4/5 — acquisition orchestration, surface construction, and rendering.
 *
 * WHY THIS SUITE EXISTS. T1 proved the resolver refuses correctly in isolation. That is necessary
 * and not sufficient: the fabrication this programme exists to prevent — "HubSpot runs ~4K ads" —
 * is produced by the LAYERS AROUND the resolver, by aggregating a domain-scoped count or by
 * rendering a `PROBABLE_MATCH` as ownership. These tests hold the orchestrator, the surface and
 * the renderer to the same bar the resolver already meets.
 *
 * Every advertiser below was observed live during PO-3a.
 *
 * SECRETS: none. No network, no browser, no credential — the provider is an injected fake.
 */
import {
  observePublicAdvertising,
  accessStateFromError,
  type AdsTransparencyClient,
  type AdvertiserProfileObservation,
} from '../../services/ads/adsTransparencyObservation';
import { buildAdvertisingSurface, mayStateNoVerifiedCompanyAdvertising } from '../../services/ads/advertisingSurface';
import { renderPublicAdvertising } from '../../services/intelligence/exportRendererReport1';
import type { SubjectIdentity } from '../../services/ads/advertiserIdentityResolver';
import type { CanonicalExportPayload } from '../../services/intelligence/canonicalExport';

const WIX_SUBJECT: SubjectIdentity = {
  declaredLegalName: 'Wix.com Ltd',
  brandName: 'Wix',
  jurisdiction: 'Israel',
  wikidataDomainVerified: true,
};

const HUBSPOT_SUBJECT: SubjectIdentity = {
  declaredLegalName: null, // the site declares an Organization but no legalName
  brandName: 'HubSpot',
  jurisdiction: 'the United States',
  wikidataDomainVerified: true,
};

const profile = (over: Partial<AdvertiserProfileObservation> & { advertiserId: string }): AdvertiserProfileObservation => ({
  legalName: null,
  basedIn: null,
  verified: true,
  ambiguityFlagged: false,
  adCountLabel: null,
  creativeIds: [],
  profileUrl: `https://adstransparency.google.com/advertiser/${over.advertiserId}`,
  ...over,
});

/** A fake provider. Production supplies a browser-backed client on the Railway plane. */
function fakeClient(over: Partial<AdsTransparencyClient> = {}): AdsTransparencyClient {
  return {
    searchAdvertisers: async () => [],
    openAdvertiser: async () => null,
    ...over,
  };
}

describe('accessStateFromError — absence of access is never absence of ads', () => {
  it.each([
    ['Please sign in to continue', 'requires_auth'],
    ['unusual traffic detected', 'blocked'],
    ['Not available in your region', 'restricted'],
    ['navigation timeout of 30000ms exceeded', 'unreachable'],
    ['something else entirely', 'unavailable'],
  ])('%s → %s', (message, expected) => {
    expect(accessStateFromError(new Error(message)).state).toBe(expected);
  });

  it('never produces a state that means "no advertising"', () => {
    const { reason } = accessStateFromError(new Error('boom'));
    expect(reason).not.toMatch(/no ads|does not advertise|zero/i);
  });
});

describe('observePublicAdvertising — discovery order and resolution', () => {
  it('resolves a name-discovered advertiser to MATCHED', async () => {
    const result = await observePublicAdvertising({
      subject: WIX_SUBJECT,
      searchNames: ['Wix.com Ltd'],
      vantage: 'us-west2',
      client: fakeClient({
        searchAdvertisers: async () => [
          { advertiserId: 'AR03389342251585896449', name: 'WIX.COM LTD', basedIn: 'Israel', verified: true, ambiguityFlagged: false, adCountLabel: '~1 ads' },
        ],
        openAdvertiser: async (id) => profile({
          advertiserId: id, legalName: 'WIX.COM LTD', basedIn: 'Israel', adCountLabel: '~1 ads', creativeIds: ['CR1'],
        }),
      }),
    });
    expect(result.accessState).toBe('observed');
    expect(result.advertisers[0].resolution.state).toBe('MATCHED');
    expect(result.counts.matchedAdvertiserAccounts).toBe(1);
  });

  it('treats a domain query as candidate discovery and never as a company count', async () => {
    const result = await observePublicAdvertising({
      subject: HUBSPOT_SUBJECT,
      searchNames: ['HubSpot'],
      destinationDomain: 'hubspot.com',
      vantage: 'us-west2',
      client: fakeClient({
        searchAdvertisers: async () => [],
        searchByDomain: async () => ({
          domainAdCountLabel: '~4K ads',
          advertiserIds: ['AR10072600183532683265', 'AR17621460850743181313', 'AR00306548136791244801'],
        }),
        openAdvertiser: async (id) => ({
          AR10072600183532683265: profile({ advertiserId: id, legalName: 'Hubspot, Inc.', basedIn: 'the United States', ambiguityFlagged: true, adCountLabel: '~3K ads' }),
          AR17621460850743181313: profile({ advertiserId: id, legalName: 'PT Revolusi Cita Edukasi', basedIn: 'Indonesia' }),
          AR00306548136791244801: profile({ advertiserId: id, legalName: "Lisa O'Connell", basedIn: 'the United States' }),
        }[id] ?? null),
      }),
    });
    // The ~4K is retained as provider context, and NOT as any company's count.
    expect(result.counts.domainAdCountLabel).toBe('~4K ads');
    expect(result.counts.matchedAdvertiserAccounts).toBe(0);
    expect(result.advertisers.every((a) => a.discoveredVia === 'destination_domain')).toBe(true);
  });

  it('keeps name-discovered candidates when the secondary domain query fails', async () => {
    const result = await observePublicAdvertising({
      subject: WIX_SUBJECT,
      searchNames: ['Wix.com Ltd'],
      destinationDomain: 'wix.com',
      vantage: 'us-west2',
      client: fakeClient({
        searchAdvertisers: async () => [
          { advertiserId: 'AR1', name: 'WIX.COM LTD', basedIn: 'Israel', verified: true, ambiguityFlagged: false, adCountLabel: null },
        ],
        searchByDomain: async () => { throw new Error('navigation timeout'); },
        openAdvertiser: async (id) => profile({ advertiserId: id, legalName: 'WIX.COM LTD', basedIn: 'Israel' }),
      }),
    });
    expect(result.accessState).toBe('observed');
    expect(result.advertisers).toHaveLength(1);
  });

  it('reports an access state, not an empty result, when discovery is blocked', async () => {
    const result = await observePublicAdvertising({
      subject: WIX_SUBJECT,
      searchNames: ['Wix.com Ltd'],
      vantage: 'us-west2',
      client: fakeClient({ searchAdvertisers: async () => { throw new Error('unusual traffic'); } }),
    });
    expect(result.accessState).toBe('blocked');
    expect(result.advertisers).toHaveLength(0);
    expect(result.counts.matchedAdvertiserAccounts).toBe(0);
  });

  it('survives one unreadable profile without losing the run', async () => {
    const result = await observePublicAdvertising({
      subject: WIX_SUBJECT,
      searchNames: ['Wix.com Ltd'],
      vantage: 'us-west2',
      client: fakeClient({
        searchAdvertisers: async () => [
          { advertiserId: 'AR_BAD', name: 'x', basedIn: null, verified: true, ambiguityFlagged: false, adCountLabel: null },
          { advertiserId: 'AR_OK', name: 'WIX.COM LTD', basedIn: 'Israel', verified: true, ambiguityFlagged: false, adCountLabel: null },
        ],
        openAdvertiser: async (id) => {
          if (id === 'AR_BAD') throw new Error('profile failed');
          return profile({ advertiserId: id, legalName: 'WIX.COM LTD', basedIn: 'Israel' });
        },
      }),
    });
    expect(result.accessState).toBe('observed');
    expect(result.advertisers).toHaveLength(1);
    expect(result.advertisers[0].resolution.state).toBe('MATCHED');
  });

  it('reports unavailable when there is no identity anchor to search with', async () => {
    const result = await observePublicAdvertising({
      subject: HUBSPOT_SUBJECT, searchNames: [], vantage: 'us-west2', client: fakeClient(),
    });
    expect(result.accessState).toBe('unavailable');
  });
});

describe('buildAdvertisingSurface — the partition is the guard', () => {
  const observation = async () => observePublicAdvertising({
    subject: WIX_SUBJECT,
    searchNames: ['Wix.com Ltd'],
    destinationDomain: 'wix.com',
    vantage: 'us-west2',
    client: fakeClient({
      searchAdvertisers: async () => [
        { advertiserId: 'AR_IL', name: 'WIX.COM LTD', basedIn: 'Israel', verified: true, ambiguityFlagged: false, adCountLabel: '~1 ads' },
        { advertiserId: 'AR_EG', name: 'WIX.EG', basedIn: 'Egypt', verified: true, ambiguityFlagged: false, adCountLabel: '~38 ads' },
      ],
      searchByDomain: async () => ({ domainAdCountLabel: '~10K ads', advertiserIds: [] }),
      openAdvertiser: async (id) => ({
        AR_IL: profile({ advertiserId: id, legalName: 'WIX.COM LTD', basedIn: 'Israel', adCountLabel: '~1 ads' }),
        AR_EG: profile({ advertiserId: id, legalName: 'WIX.EG', basedIn: 'Egypt', adCountLabel: '~38 ads' }),
      }[id] ?? null),
    }),
  });

  it('places only MATCHED advertisers in companyAdvertisers', async () => {
    const surface = buildAdvertisingSurface({ observation: await observation(), subjectLegalNameUsed: 'Wix.com Ltd' });
    expect(surface.companyAdvertisers.map((a) => a.legalName)).toEqual(['WIX.COM LTD']);
    expect(surface.otherAdvertisers.map((a) => a.legalName)).toEqual(['WIX.EG']);
  });

  it('keeps the domain-scoped count out of every company-owned field', async () => {
    const surface = buildAdvertisingSurface({ observation: await observation(), subjectLegalNameUsed: 'Wix.com Ltd' });
    // The domain count is ~10K; the matched advertiser's own count is ~1. They must not be
    // conflated, and no field aggregates them.
    expect(surface.counts.domainAdCountLabel).toBe('~10K ads');
    expect(surface.companyAdvertisers[0].adCountLabel).toBe('~1 ads');
    const companyJson = JSON.stringify(surface.companyAdvertisers);
    expect(companyJson).not.toContain('10K');
  });

  it('permits a "no verified company advertising" statement only with a declared legal name', async () => {
    const obs = await observePublicAdvertising({
      subject: HUBSPOT_SUBJECT, searchNames: ['HubSpot'], vantage: 'us-west2',
      client: fakeClient({ searchAdvertisers: async () => [] }),
    });
    expect(mayStateNoVerifiedCompanyAdvertising(
      buildAdvertisingSurface({ observation: obs, subjectLegalNameUsed: null }),
    )).toBe(false);
    expect(mayStateNoVerifiedCompanyAdvertising(
      buildAdvertisingSurface({ observation: obs, subjectLegalNameUsed: 'HubSpot, Inc.' }),
    )).toBe(true);
  });

  it('never permits the statement when access failed', async () => {
    const obs = await observePublicAdvertising({
      subject: WIX_SUBJECT, searchNames: ['Wix.com Ltd'], vantage: 'us-west2',
      client: fakeClient({ searchAdvertisers: async () => { throw new Error('unusual traffic'); } }),
    });
    expect(mayStateNoVerifiedCompanyAdvertising(
      buildAdvertisingSurface({ observation: obs, subjectLegalNameUsed: 'Wix.com Ltd' }),
    )).toBe(false);
  });
});

describe('renderPublicAdvertising — claim wording is bound to state', () => {
  const render = (advertising: unknown): string =>
    renderPublicAdvertising({ report1: { advertising } } as unknown as CanonicalExportPayload, 'Public Evidence');

  const surfaceFor = async (subject: SubjectIdentity, subjectLegalNameUsed: string | null) =>
    buildAdvertisingSurface({
      observation: await observePublicAdvertising({
        subject,
        searchNames: ['x'],
        destinationDomain: 'hubspot.com',
        vantage: 'us-west2',
        client: fakeClient({
          searchAdvertisers: async () => [],
          searchByDomain: async () => ({ domainAdCountLabel: '~4K ads', advertiserIds: ['AR_A', 'AR_B'] }),
          openAdvertiser: async (id) => ({
            AR_A: profile({ advertiserId: id, legalName: 'PT Revolusi Cita Edukasi', basedIn: 'Indonesia' }),
            AR_B: profile({ advertiserId: id, legalName: "Lisa O'Connell", basedIn: 'the United States' }),
          }[id] ?? null),
        }),
      }),
      subjectLegalNameUsed,
    });

  it('renders nothing when there is no advertising surface', () => {
    expect(render(null)).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('never states a company ad count from the domain-scoped figure', async () => {
    const html = render(await surfaceFor(HUBSPOT_SUBJECT, null));
    // ~4K may appear, but only inside the third-party paragraph explaining what it covers.
    expect(html).toContain('pointing at this domain in total');
    expect(html).not.toMatch(/your advertising[^<]*~4K/i);
  });

  it('says ownership was not established when the site declares no legal name', async () => {
    const html = render(await surfaceFor(HUBSPOT_SUBJECT, null));
    expect(html).toMatch(/Ownership could not be established/i);
    expect(html).not.toMatch(/does not advertise|no advertising exists/i);
  });

  it('reports unrelated advertisers as a third-party finding, not as the company\'s', async () => {
    const html = render(await surfaceFor(HUBSPOT_SUBJECT, 'HubSpot, Inc.'));
    expect(html).toContain('Other advertisers pointing at your domain');
    expect(html).toContain('it is not your advertising');
  });

  it('renders an access failure without implying absence of advertising', () => {
    const html = render({
      accessState: 'restricted', reason: 'The provider did not serve this surface to the observation vantage.',
      source: 'ads_transparency', provenance: 'PUBLIC_OBSERVED', vantage: 'us-west2',
      observedAt: '2026-09-26T00:00:00.000Z', subjectLegalNameUsed: null,
      companyAdvertisers: [], otherAdvertisers: [],
      counts: { domainAdCountLabel: null, advertiserAccountsDiscovered: 0, matchedAdvertiserAccounts: 0 },
    });
    expect(html).toContain('This is not a finding that the company does not advertise');
    expect(html).not.toMatch(/no ads|zero ads/i);
  });

  it('states a company count only for a MATCHED advertiser', async () => {
    const surface = buildAdvertisingSurface({
      observation: await observePublicAdvertising({
        subject: WIX_SUBJECT, searchNames: ['Wix.com Ltd'], vantage: 'us-west2',
        client: fakeClient({
          searchAdvertisers: async () => [{ advertiserId: 'AR_IL', name: 'WIX.COM LTD', basedIn: 'Israel', verified: true, ambiguityFlagged: false, adCountLabel: '~1 ads' }],
          openAdvertiser: async (id) => profile({ advertiserId: id, legalName: 'WIX.COM LTD', basedIn: 'Israel', adCountLabel: '~1 ads' }),
        }),
      }),
      subjectLegalNameUsed: 'Wix.com Ltd',
    });
    const html = render(surface);
    expect(html).toContain('Your advertising');
    expect(html).toContain('~1 ads observed for this advertiser');
  });
});
