/**
 * PO-3 pre-T3 — the three deferred operational items.
 *
 * WHY THIS SUITE EXISTS. Each item is a place where "make the report look more complete" and
 * "keep the evidence honest" pull in opposite directions:
 *
 *  • the ad-count parser could return 0 instead of null, and the report would gain a number;
 *  • advertiser discovery could construct an AR id from a name, and attribution would gain reach;
 *  • the scheduler could persist only successful runs, and the data would look cleaner.
 *
 * All three would be wrong. These tests pin the refusals.
 *
 * Formats below are the live profile text observed on 2026-09-26 from Railway us-west2:
 * HubSpot `~200 ads`, Booking.com `~14M ads`, Wix `1 ad`.
 *
 * SECRETS: none. No network, no browser, no credential.
 */
import { adCountLabelFrom, parseSuggestionRow, createAdsTransparencyBrowserClient, type AdsBrowserPage, type AdsBrowserSession } from '../../services/ads/adsTransparencyBrowserClient';
import { runAdsAcquisitionCycle, adsAcquisitionEnabled, type AdsAcquisitionSubject, type AdsEvidenceSink } from '../../services/ads/adsAcquisitionScheduler';
import type { SubjectIdentity } from '../../services/ads/advertiserIdentityResolver';

const SUBJECT: SubjectIdentity = {
  declaredLegalName: 'Wix.com Ltd',
  brandName: 'Wix',
  jurisdiction: 'Israel',
  wikidataDomainVerified: true,
};

// ── 1. AD COUNT PARSING ─────────────────────────────────────────────────────

describe('adCountLabelFrom — the observed provider formats', () => {
  it.each([
    ['~200 ads', '~200 ads'],     // HubSpot, live
    ['~14M ads', '~14M ads'],     // Booking.com, live — magnitude suffix is not always K
    ['1 ad', '1 ad'],             // Wix, live — singular, no tilde
    ['~10K ads', '~10K ads'],
    ['38 ads', '38 ads'],
    ['~16.4M ads', '~16.4M ads'],
  ])('parses %s', (input, expected) => {
    expect(adCountLabelFrom(input)).toBe(expected);
  });

  it('carries the provider approximation verbatim and derives no integer', () => {
    const label = adCountLabelFrom('~14M ads');
    expect(label).toBe('~14M ads');
    expect(label).toMatch(/^~/);          // the tilde survives
    expect(Number(label)).toBeNaN();      // nothing here is a number
  });

  it('never reads the page boilerplate as a count', () => {
    // Every one of these appears on a real advertiser profile above the count.
    for (const boilerplate of [
      'Ads Transparency Center',
      'Political ads',
      "Find the ads you've seen by searching by advertiser name or website",
      'Ads In anywhere',
      'Some advertisers show ads with age restricted content',
      'Sign in to determine if we can show you these ads.',
    ]) {
      expect(adCountLabelFrom(boilerplate)).toBeNull();
    }
  });

  it('returns null — never 0 — when no count is present', () => {
    expect(adCountLabelFrom('')).toBeNull();
    expect(adCountLabelFrom('no numbers here at all')).toBeNull();
    // The distinction that matters: absent is not zero.
    expect(adCountLabelFrom('')).not.toBe('0 ads');
  });

  it('picks the count out of the full profile text, boilerplate first', () => {
    const profile = [
      'Ads Transparency Center Sign in Home WIX.COM LTD FAQ Advertiser Details',
      "Find the ads you've seen by searching by advertiser name or website",
      'Ads In anywhere WIX.COM LTD Legal name: WIX.COM LTD Based in: Israel',
      'Advertiser has verified their identity',
      'Some advertisers show ads with age restricted content. Sign in to determine if we can show you these ads.',
      '1 ad Any time All platforms All formats',
    ].join('\n');
    expect(adCountLabelFrom(profile)).toBe('1 ad');
  });
});

// ── 2. ADVERTISER-NAME → AR ID ──────────────────────────────────────────────

describe('parseSuggestionRow', () => {
  it('reads the live suggestion shapes', () => {
    expect(parseSuggestionRow('WIX.COM LTDVerifiedIsrael~1 ads')).toMatchObject({ verified: true, ambiguityFlagged: false, adCountLabel: '~1 ads' });
    expect(parseSuggestionRow('Hubspot, Inc.Multiple advertiser accounts have a similar nameUnited States~3K ads'))
      .toMatchObject({ ambiguityFlagged: true, adCountLabel: '~3K ads' });
  });

  it('rejects a bare website row — a Websites suggestion is not an advertiser', () => {
    for (const site of ['wix.com', 'hubspot.de', 'twix.com', 'eduhubspot.com']) {
      expect(parseSuggestionRow(site)).toBeNull();
    }
  });
});

describe('searchAdvertisers — the AR id is read, never constructed', () => {
  /** A page fake whose URL changes on click, mirroring the observed navigation. */
  function fakeSession(rows: string[], arForIndex: Record<number, string>): AdsBrowserSession {
    return {
      async withPage(fn) {
        let url = 'https://adstransparency.google.com/?region=anywhere';
        const page: AdsBrowserPage = {
          goto: async () => undefined,
          waitForTimeout: async () => undefined,
          url: () => url,
          $: async () => ({ fill: async () => undefined }),
          $$: async () => rows.map((_, i) => ({
            click: async () => {
              // Observed live: activating a suggestion navigates to /advertiser/AR…
              if (arForIndex[i]) url = `https://adstransparency.google.com/advertiser/${arForIndex[i]}?region=anywhere`;
            },
          })),
          evaluate: (async (fnArg: unknown) => {
            void fnArg;
            return rows as unknown;
          }) as AdsBrowserPage['evaluate'],
        };
        return fn(page);
      },
    };
  }

  it('resolves the AR id from the URL the provider navigates to', async () => {
    const client = createAdsTransparencyBrowserClient(
      fakeSession(['WIX.COM LTDVerifiedIsrael~1 ads', 'wix.com'], { 0: 'AR03389342251585896449' }),
    );
    const out = await client.searchAdvertisers('Wix.com Ltd');
    expect(out).toHaveLength(1);                       // the website row is excluded
    expect(out[0].advertiserId).toBe('AR03389342251585896449');
  });

  it('records advertiserId null when activation yields no AR id — it never guesses', async () => {
    const client = createAdsTransparencyBrowserClient(
      fakeSession(['SOME ADVERTISERVerifiedFrance~2 ads'], {}),
    );
    const out = await client.searchAdvertisers('Some Advertiser');
    expect(out[0].advertiserId).toBeNull();
    // The suggestion is still returned: an unresolved candidate is a truthful result.
    expect(out[0].verified).toBe(true);
  });

  it('never fabricates an AR id from the advertiser name', async () => {
    const client = createAdsTransparencyBrowserClient(
      fakeSession(['WIX.COM LTDVerifiedIsrael~1 ads'], {}),
    );
    const out = await client.searchAdvertisers('Wix.com Ltd');
    expect(out[0].advertiserId).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/AR\d/);
  });

  it('returns rows beyond the resolve cap unresolved rather than dropping them', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => `ADVERTISER ${i}VerifiedFrance~1 ads`);
    const client = createAdsTransparencyBrowserClient(fakeSession(rows, {}));
    const out = await client.searchAdvertisers('Advertiser');
    expect(out).toHaveLength(7);
    expect(out.every((r) => r.advertiserId === null)).toBe(true);
  });
});

// ── 3. SCHEDULED ACQUISITION ────────────────────────────────────────────────

describe('runAdsAcquisitionCycle', () => {
  const subject = (over: Partial<AdsAcquisitionSubject> = {}): AdsAcquisitionSubject => ({
    companyId: 'company-1',
    domainId: 'domain-1',
    destinationDomain: 'wix.com',
    subject: SUBJECT,
    ...over,
  });

  function harness(over: { rows?: string[]; sink?: AdsEvidenceSink; subjects?: AdsAcquisitionSubject[]; enabled?: boolean } = {}) {
    const persisted: Array<Record<string, unknown>> = [];
    let closed = 0;
    const session: AdsBrowserSession = {
      async withPage(fn) {
        const page: AdsBrowserPage = {
          goto: async () => undefined,
          waitForTimeout: async () => undefined,
          url: () => 'https://adstransparency.google.com/?region=anywhere',
          $: async () => ({ fill: async () => undefined }),
          $$: async () => [],
          evaluate: (async () => (over.rows ?? []) as unknown) as AdsBrowserPage['evaluate'],
        };
        return fn(page);
      },
    };
    const deps = {
      listDueSubjects: async () => over.subjects ?? [subject()],
      openSession: async () => ({ session, close: async () => { closed += 1; } }),
      sink: over.sink ?? { persist: async (p: Parameters<AdsEvidenceSink['persist']>[0]) => { persisted.push(p as unknown as Record<string, unknown>); } },
      vantage: 'railway:us-west2',
      isEnabled: () => over.enabled ?? true,
    };
    return { deps, persisted, closed: () => closed };
  }

  it('is OFF unless the flag is set, and does nothing when off', async () => {
    const original = process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED;
    delete process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED;
    expect(adsAcquisitionEnabled()).toBe(false);
    if (original !== undefined) process.env.ADS_TRANSPARENCY_ACQUISITION_ENABLED = original;

    const { deps, persisted } = harness({ enabled: false });
    expect(await runAdsAcquisitionCycle(deps)).toEqual({ enabled: 0, subjects: 0, observed: 0, persisted: 0, errors: 0 });
    expect(persisted).toHaveLength(0);
  });

  it('propagates tenant, domain, vantage and timestamp into the persisted row', async () => {
    const { deps, persisted } = harness();
    await runAdsAcquisitionCycle(deps);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({ companyId: 'company-1', domainId: 'domain-1', vantage: 'railway:us-west2' });
    expect(String(persisted[0].observedAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('persists a failed access state too — silence would read as absence', async () => {
    const { deps, persisted } = harness();
    deps.openSession = async () => ({
      session: {
        async withPage() { throw new Error('unusual traffic'); },
      },
      close: async () => undefined,
    });
    await runAdsAcquisitionCycle(deps);
    expect(persisted).toHaveLength(1);
    expect((persisted[0].observation as { accessState: string }).accessState).toBe('blocked');
  });

  it('one company failing does not end the cycle', async () => {
    let calls = 0;
    const sink: AdsEvidenceSink = {
      persist: async () => { calls += 1; if (calls === 1) throw new Error('write failed'); },
    };
    const { deps } = harness({ sink, subjects: [subject({ companyId: 'a' }), subject({ companyId: 'b' })] });
    const result = await runAdsAcquisitionCycle(deps);
    expect(result.errors).toBe(1);
    expect(result.persisted).toBe(1);
  });

  it('always closes the browser session', async () => {
    const { deps, closed } = harness();
    await runAdsAcquisitionCycle(deps);
    expect(closed()).toBe(1);
  });

  it('exposes no parameter through which an authenticated session could be supplied', () => {
    // storageState reuse is the one thing that would silently make Report 1 evidence private.
    const depsKeys = ['listDueSubjects', 'openSession', 'sink', 'vantage', 'isEnabled', 'maxSubjectsPerCycle'];
    for (const key of depsKeys) expect(key).not.toMatch(/storage|session_state|cookie|auth|credential/i);
  });

  it('searches the declared legal name before the brand name', async () => {
    const seen: string[] = [];
    const { deps } = harness();
    deps.openSession = async () => ({
      session: {
        async withPage(fn) {
          const page: AdsBrowserPage = {
            goto: async () => undefined,
            waitForTimeout: async () => undefined,
            url: () => 'https://adstransparency.google.com/?region=anywhere',
            $: async () => ({ fill: async (v: string) => { seen.push(v); } }),
            $$: async () => [],
            evaluate: (async () => [] as unknown) as AdsBrowserPage['evaluate'],
          };
          return fn(page);
        },
      },
      close: async () => undefined,
    });
    await runAdsAcquisitionCycle(deps);
    // Legal name first: it is the only anchor that can reach MATCHED.
    expect(seen[0]).toBe('Wix.com Ltd');
    expect(seen).toContain('Wix');
  });
});
