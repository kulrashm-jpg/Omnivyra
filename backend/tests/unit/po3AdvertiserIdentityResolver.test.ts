/**
 * PO-3 — advertiser identity resolution, and the guards that keep it honest.
 *
 * WHY THIS SUITE EXISTS. The feasibility gates produced a concrete, reproducible way to fabricate
 * a customer-facing advertising claim: query Ads Transparency by destination domain and report the
 * count. `?domain=calendly.com` returns `~10K ads` behind four verified advertisers, none of them
 * Calendly; from a second continent it returns four DIFFERENT advertisers, also none of them
 * Calendly. `?domain=hubspot.com` returns `~4K ads` across the genuine advertiser plus an
 * Indonesian education company and a private individual — so "HubSpot runs ~4K ads" would be
 * wrong by roughly 20x.
 *
 * The second way to fabricate one is subtler: match on the brand token. The Ads Transparency
 * search for `Wix` returns SEVEN verified advertisers sharing the token, in seven jurisdictions.
 * A feasibility probe's own heuristic picked the Egyptian one.
 *
 * Every negative control below is a real advertiser observed during PO-3a, not an invention.
 *
 * SECRETS: none. No network, no credential, no fixture host — the resolver is pure.
 */
import {
  normalizeLegalName,
  jurisdictionsAgree,
  resolveAdvertiserIdentity,
  resolveAdvertiserSet,
  type ObservedAdvertiser,
  type SubjectIdentity,
} from '../../services/ads/advertiserIdentityResolver';
import {
  observePublicAdvertising,
  ADS_PLATFORM_GOOGLE,
  type AdsTransparencyClient,
} from '../../services/ads/adsTransparencyObservation';

const advertiser = (over: Partial<ObservedAdvertiser> = {}): ObservedAdvertiser => ({
  advertiserId: 'AR00000000000000000001',
  legalName: 'Wix.com Ltd',
  basedIn: 'Israel',
  verified: true,
  ambiguityFlagged: false,
  ...over,
});

/** Wix — the only PO-3a subject with a Class-A anchor (`Organization.legalName: Wix.com Ltd`). */
const WIX_SUBJECT: SubjectIdentity = {
  declaredLegalName: 'Wix.com Ltd',
  brandName: 'Wix',
  jurisdiction: 'Israel',
  wikidataDomainVerified: true,
};

/** HubSpot — Class B. The site declares an Organization but no `legalName`. */
const HUBSPOT_SUBJECT: SubjectIdentity = {
  declaredLegalName: null,
  brandName: 'HubSpot',
  jurisdiction: 'the United States',
  wikidataDomainVerified: true,
};

describe('normalizeLegalName — deterministic only', () => {
  it('normalises case, punctuation and whitespace', () => {
    expect(normalizeLegalName('WIX.COM LTD')).toBe(normalizeLegalName('Wix.com Ltd'));
    expect(normalizeLegalName('  Booking.com   B.V. ')).toBe('bookingcom bv');
  });

  it('does NOT strip legal suffixes — the suffix carries the meaning', () => {
    // Stripping `Ltd` would make the brand token match the legal entity, which is the exact
    // failure this design refuses.
    expect(normalizeLegalName('Wix')).not.toBe(normalizeLegalName('Wix.com Ltd'));
    expect(normalizeLegalName('Booking.com')).not.toBe(normalizeLegalName('Booking.com B.V.'));
  });

  it('matches the live trailing-period variant observed on the provider', () => {
    // Live 2026-09-26: name search for the legal name surfaced TWO Wix accounts, one of whose
    // verified legal name is "WIX.COM LTD." — with a trailing period. Deterministic punctuation
    // normalisation must equate it to the site-declared "Wix.com Ltd"; anything less would miss
    // the larger of the company's two genuine advertiser accounts (~100K ads vs ~1 ad).
    expect(normalizeLegalName('WIX.COM LTD.')).toBe(normalizeLegalName('Wix.com Ltd'));
  });

  it('returns null for empty input rather than an empty string', () => {
    expect(normalizeLegalName('')).toBeNull();
    expect(normalizeLegalName(null)).toBeNull();
    expect(normalizeLegalName('   ')).toBeNull();
  });
});

describe('jurisdictionsAgree', () => {
  it('tolerates the provider\'s definite article', () => {
    expect(jurisdictionsAgree('Netherlands', 'the Netherlands')).toBe(true);
    expect(jurisdictionsAgree('the United States', 'United States')).toBe(true);
  });

  it('treats unknown as disagreement', () => {
    expect(jurisdictionsAgree(null, 'Israel')).toBe(false);
    expect(jurisdictionsAgree('Israel', null)).toBe(false);
  });
});

/**
 * ─── WP-2 — JURISDICTION NORMALISATION ────────────────────────────────────
 *
 * THE DEFECT. The two sides of this comparison have never spoken the same country vocabulary.
 * `loadSubjectIdentity` reads the subject's jurisdiction verbatim from the crawl's JSON-LD
 * `Organization.address.addressCountry`, and in every measured case that is an ISO 3166-1 alpha-2
 * code — `hubspot.com` publishes "US", `wix.com` publishes "IL" (both pinned in
 * po3SubjectIdentityExtraction.test.ts). Google's `Based in:` is always a full English name,
 * "United States" / "Israel". Compared as raw text they never agreed, so a verified advertiser
 * whose legal name matched EXACTLY was downgraded MATCHED -> PROBABLE_MATCH, lost
 * `eligibleForCompanyClaim`, and was partitioned by `advertisingSurface` into `otherAdvertisers`:
 * the company's own advertising reported as somebody else's.
 *
 * THE PERVERSE PART, pinned below. Before this fix a subject could reach MATCHED only by
 * publishing LESS about itself: an `Organization` block with no address at all never reached the
 * jurisdiction comparison, while one that published its country was punished for it.
 *
 * WHAT IS NOT DONE. No substring, prefix or similarity matching. "United States" and "United
 * Kingdom" share a word; "US" occurs inside plenty of strings. Only equality of a canonical key
 * counts, and an unplaceable value on either side abstains rather than agreeing.
 */
describe('WP-2 — jurisdictionsAgree normalises semantically equivalent countries', () => {
  // (1) The live failing case, with hubspot.com's literal measured `addressCountry`.
  it('agrees on the measured hubspot.com pair: "US" vs the provider\'s "United States"', () => {
    expect(jurisdictionsAgree('US', 'United States')).toBe(true);
    expect(jurisdictionsAgree('US', 'the United States')).toBe(true);
  });

  // (2) Case.
  it('agrees across case variants in either direction', () => {
    expect(jurisdictionsAgree('us', 'UNITED STATES')).toBe(true);
    expect(jurisdictionsAgree('Us', 'united states')).toBe(true);
    expect(jurisdictionsAgree('United States', 'uS')).toBe(true);
  });

  // (3) Whitespace.
  it('agrees across surrounding and internal whitespace', () => {
    expect(jurisdictionsAgree('  US  ', 'United States')).toBe(true);
    expect(jurisdictionsAgree('US', '  United   States ')).toBe(true);
    expect(jurisdictionsAgree('\tus\n', 'the  United  States')).toBe(true);
  });

  // (4) A second ISO-2 / name pair — wix.com's literal measured `addressCountry`.
  it('agrees on the measured wix.com pair, and on other ISO-2/name pairs', () => {
    expect(jurisdictionsAgree('IL', 'Israel')).toBe(true);
    expect(jurisdictionsAgree('NL', 'the Netherlands')).toBe(true);
    expect(jurisdictionsAgree('GB', 'United Kingdom')).toBe(true);
    expect(jurisdictionsAgree('JP', 'Japan')).toBe(true);
    expect(jurisdictionsAgree('EG', 'Egypt')).toBe(true);
  });

  // (5) Genuinely different jurisdictions stay different — including the pair that a prefix or
  //     substring rule would wrongly join.
  it('keeps genuinely different countries apart, with no substring or prefix matching', () => {
    expect(jurisdictionsAgree('US', 'United Kingdom')).toBe(false);
    expect(jurisdictionsAgree('United States', 'United Kingdom')).toBe(false);
    expect(jurisdictionsAgree('GB', 'United States')).toBe(false);
    expect(jurisdictionsAgree('IL', 'Egypt')).toBe(false);
    // "US" is a substring of both of these and must not match either.
    expect(jurisdictionsAgree('US', 'Australia')).toBe(false);
    expect(jurisdictionsAgree('US', 'Austria')).toBe(false);
    expect(jurisdictionsAgree('AT', 'Australia')).toBe(false);
  });

  // (6) Missing subject side.
  it('never turns a missing subject country into agreement', () => {
    expect(jurisdictionsAgree(null, 'United States')).toBe(false);
    expect(jurisdictionsAgree('', 'United States')).toBe(false);
    expect(jurisdictionsAgree('   ', 'US')).toBe(false);
  });

  // (7) Missing provider side.
  it('never turns a missing provider country into agreement', () => {
    expect(jurisdictionsAgree('US', null)).toBe(false);
    expect(jurisdictionsAgree('US', '')).toBe(false);
    expect(jurisdictionsAgree('IL', '   ')).toBe(false);
  });

  it('never turns two UNKNOWN jurisdictions into agreement — absence is not agreement', () => {
    // Identical strings, but neither names a jurisdiction this system can place. Two unknowns are
    // two unknowns, so the canonical key is null on both sides and null equals nothing.
    expect(jurisdictionsAgree('QQ', 'QQ')).toBe(false);
    expect(jurisdictionsAgree('ZZ', 'ZZ')).toBe(false);
    expect(jurisdictionsAgree('Freedonia', 'Freedonia')).toBe(false);
    expect(jurisdictionsAgree(null, null)).toBe(false);
  });

  // (8) No-regression pin: every country representation the provider was already observed to emit
  //     keeps behaving exactly as it did before WP-2.
  it('leaves the exact provider representations already observed behaving as before', () => {
    const PRE_EXISTING: Array<[string, string, boolean]> = [
      ['Netherlands', 'the Netherlands', true],
      ['the United States', 'United States', true],
      ['Israel', 'Israel', true],
      ['United States', 'United States', true],
      ['United Kingdom', 'United Kingdom', true],
      ['Israel', 'Egypt', false],
      ['Israel', 'Japan', false],
      ['Israel', 'United Kingdom', false],
      ['Israel', 'Canada', false],
      ['Israel', 'United States', false],
    ];
    expect(PRE_EXISTING).not.toHaveLength(0);
    for (const [subject, provider, want] of PRE_EXISTING) {
      expect([subject, provider, jurisdictionsAgree(subject, provider)]).toEqual([subject, provider, want]);
    }
  });
});

describe('WP-2 — the resolver outcome the normalisation exists to correct', () => {
  /** wix.com as the crawl actually stores it: `addressCountry: "IL"`, not the English name. */
  const WIX_SUBJECT_AS_CRAWLED: SubjectIdentity = { ...WIX_SUBJECT, jurisdiction: 'IL' };

  // (9)
  it('reaches MATCHED for a verified exact legal name whose jurisdiction is the same country in another notation', () => {
    const r = resolveAdvertiserIdentity(
      WIX_SUBJECT_AS_CRAWLED,
      advertiser({ legalName: 'WIX.COM LTD', basedIn: 'Israel', verified: true }),
    );
    expect(r.state).toBe('MATCHED');
    expect(r.eligibleForCompanyClaim).toBe(true);
    // The basis must still cite the provider's own wording, not a normalised internal key.
    expect(r.basis).toContain('Israel');
  });

  it('reaches MATCHED on the hubspot.com country pair once a legal name is declared', () => {
    // The measured subject value is "US"; the provider says "the United States". Before WP-2 this
    // exact pair produced PROBABLE_MATCH on a verified, exactly-matching legal name.
    const declared: SubjectIdentity = {
      declaredLegalName: 'HubSpot, Inc.',
      brandName: 'HubSpot',
      jurisdiction: 'US',
      wikidataDomainVerified: true,
    };
    const r = resolveAdvertiserIdentity(
      declared,
      advertiser({ advertiserId: 'AR10072600183532683265', legalName: 'Hubspot, Inc.', basedIn: 'the United States' }),
    );
    expect(r.state).toBe('MATCHED');
    expect(r.eligibleForCompanyClaim).toBe(true);
  });

  // (10)
  it('does NOT reach MATCHED for a verified exact legal name in a genuinely different jurisdiction', () => {
    const r = resolveAdvertiserIdentity(
      WIX_SUBJECT_AS_CRAWLED,
      advertiser({ legalName: 'WIX.COM LTD', basedIn: 'Egypt', verified: true }),
    );
    expect(r.state).toBe('PROBABLE_MATCH');
    expect(r.eligibleForCompanyClaim).toBe(false);
  });

  it('does not let normalisation weaken any other gate', () => {
    // Verification, the ambiguity flag and the Class-A anchor are untouched by WP-2: an agreeing
    // jurisdiction must not rescue an advertiser that fails any of them.
    const base = { legalName: 'WIX.COM LTD', basedIn: 'Israel' };
    expect(resolveAdvertiserIdentity(WIX_SUBJECT_AS_CRAWLED, advertiser({ ...base, verified: false })).state)
      .toBe('PROBABLE_MATCH');
    expect(resolveAdvertiserIdentity(WIX_SUBJECT_AS_CRAWLED, advertiser({ ...base, ambiguityFlagged: true })).state)
      .toBe('PROBABLE_MATCH');
    expect(
      resolveAdvertiserIdentity(
        { ...WIX_SUBJECT_AS_CRAWLED, declaredLegalName: null },
        advertiser({ ...base }),
      ).eligibleForCompanyClaim,
    ).toBe(false);
    // A different verified legal name in the SAME jurisdiction is still a separate entity.
    expect(resolveAdvertiserIdentity(WIX_SUBJECT_AS_CRAWLED, advertiser({ legalName: 'WIX.EG', basedIn: 'Israel' })).state)
      .toBe('NOT_MATCHED');
  });

  it('no longer rewards a site for publishing LESS identity information', () => {
    // THE SHAPE OF THE BUG. Same subject, same advertiser, one difference: whether the site's
    // Organization block declares a country at all. Before WP-2 the silent site reached MATCHED
    // and the forthcoming one did not. Now they agree, and they agree on MATCHED.
    const silent: SubjectIdentity = { ...WIX_SUBJECT, jurisdiction: null };
    const observed = advertiser({ legalName: 'WIX.COM LTD', basedIn: 'Israel' });
    expect(resolveAdvertiserIdentity(silent, observed).state).toBe('MATCHED');
    expect(resolveAdvertiserIdentity(WIX_SUBJECT_AS_CRAWLED, observed).state).toBe('MATCHED');
  });

  it('corrects the partition for a whole observed set without widening it', () => {
    // The eight PO-3a Wix-token advertisers, resolved against the subject AS CRAWLED ("IL").
    const OBSERVED: Array<{ legalName: string; basedIn: string; ambiguity?: boolean }> = [
      { legalName: 'WIX.COM LTD', basedIn: 'Israel' },
      { legalName: 'WIX.EG', basedIn: 'Egypt' },
      { legalName: 'Jason Wix', basedIn: 'United States' },
      { legalName: 'WIXI株式会社', basedIn: 'Japan' },
      { legalName: 'Wixdek LTD', basedIn: 'United Kingdom' },
      { legalName: 'LE PRO WIX', basedIn: 'Canada' },
      { legalName: 'Wix Games', basedIn: 'United Kingdom' },
      { legalName: 'Wix.com Inc.', basedIn: 'United States', ambiguity: true },
    ];
    const results = resolveAdvertiserSet(
      WIX_SUBJECT_AS_CRAWLED,
      OBSERVED.map((o, i) => advertiser({
        advertiserId: `AR${String(i).padStart(20, '0')}`,
        legalName: o.legalName,
        basedIn: o.basedIn,
        ambiguityFlagged: Boolean(o.ambiguity),
      })),
    );
    // NON-VACUITY: the set really was resolved, and exactly one account is claimable.
    expect(results).toHaveLength(OBSERVED.length);
    const eligible = results.filter((r) => r.eligibleForCompanyClaim);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].advertiserId).toBe('AR00000000000000000000');
    expect(eligible[0].state).toBe('MATCHED');
  });
});

describe('MATCHED requires a Class-A subject anchor', () => {
  it('matches an exact normalised legal name against a verified advertiser', () => {
    const r = resolveAdvertiserIdentity(WIX_SUBJECT, advertiser({ legalName: 'WIX.COM LTD' }));
    expect(r.state).toBe('MATCHED');
    expect(r.eligibleForCompanyClaim).toBe(true);
  });

  it('cannot reach MATCHED when the site declares no legal name', () => {
    // HubSpot's advertiser legal name IS literally `HubSpot` and is verified — so a brand-token
    // rule would fire here. Without a declared legal name the ceiling stays PROBABLE_MATCH.
    const r = resolveAdvertiserIdentity(
      HUBSPOT_SUBJECT,
      advertiser({ advertiserId: 'AR13611357312189988865', legalName: 'HubSpot', basedIn: 'the United States' }),
    );
    expect(r.state).toBe('PROBABLE_MATCH');
    expect(r.eligibleForCompanyClaim).toBe(false);
  });

  it('never lets a brand name reach MATCHED even when it equals the advertiser name', () => {
    const brandOnly: SubjectIdentity = { ...WIX_SUBJECT, declaredLegalName: null };
    const r = resolveAdvertiserIdentity(brandOnly, advertiser({ legalName: 'Wix' }));
    expect(r.eligibleForCompanyClaim).toBe(false);
    expect(['PROBABLE_MATCH', 'UNRESOLVED']).toContain(r.state);
  });

  it('cannot reach MATCHED when the provider flags name ambiguity', () => {
    const r = resolveAdvertiserIdentity(WIX_SUBJECT, advertiser({ ambiguityFlagged: true }));
    expect(r.state).toBe('PROBABLE_MATCH');
    expect(r.eligibleForCompanyClaim).toBe(false);
  });

  it('cannot reach MATCHED when the advertiser identity is unverified', () => {
    const r = resolveAdvertiserIdentity(WIX_SUBJECT, advertiser({ verified: false }));
    expect(r.eligibleForCompanyClaim).toBe(false);
  });

  it('withholds MATCHED when both jurisdictions are known and disagree', () => {
    const r = resolveAdvertiserIdentity(WIX_SUBJECT, advertiser({ basedIn: 'Egypt' }));
    expect(r.state).toBe('PROBABLE_MATCH');
  });

  it('still matches when jurisdiction is simply unknown — absence is not contradiction', () => {
    const noJur: SubjectIdentity = { ...WIX_SUBJECT, jurisdiction: null };
    expect(resolveAdvertiserIdentity(noJur, advertiser()).state).toBe('MATCHED');
  });

  it('reports INSUFFICIENT_EVIDENCE when the profile exposed no legal name', () => {
    const r = resolveAdvertiserIdentity(WIX_SUBJECT, advertiser({ legalName: null }));
    expect(r.state).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('MANDATORY NEGATIVE CONTROLS — the seven verified Wix-token advertisers (PO-3a)', () => {
  // Every row was observed in one Ads Transparency search for `Wix`. All are Google-verified.
  const OBSERVED: Array<{ legalName: string; basedIn: string; expect: string; ambiguity?: boolean }> = [
    { legalName: 'WIX.COM LTD', basedIn: 'Israel', expect: 'MATCHED' },
    { legalName: 'WIX.EG', basedIn: 'Egypt', expect: 'NOT_MATCHED' },
    { legalName: 'Jason Wix', basedIn: 'United States', expect: 'NOT_MATCHED' },
    { legalName: 'WIXI株式会社', basedIn: 'Japan', expect: 'NOT_MATCHED' },
    { legalName: 'Wixdek LTD', basedIn: 'United Kingdom', expect: 'NOT_MATCHED' },
    { legalName: 'LE PRO WIX', basedIn: 'Canada', expect: 'NOT_MATCHED' },
    { legalName: 'Wix Games', basedIn: 'United Kingdom', expect: 'NOT_MATCHED' },
    // A plausible sibling entity, provider-flagged as ambiguous. Correctly withheld, not merged.
    { legalName: 'Wix.com Inc.', basedIn: 'United States', expect: 'UNRESOLVED', ambiguity: true },
  ];

  it.each(OBSERVED)('$legalName ($basedIn) → $expect', ({ legalName, basedIn, expect: want, ambiguity }) => {
    const r = resolveAdvertiserIdentity(
      WIX_SUBJECT,
      advertiser({ legalName, basedIn, ambiguityFlagged: Boolean(ambiguity) }),
    );
    expect(r.state).toBe(want);
    expect(r.eligibleForCompanyClaim).toBe(want === 'MATCHED');
  });

  it('exactly one of the eight observed advertisers is eligible for a company claim', () => {
    const results = resolveAdvertiserSet(
      WIX_SUBJECT,
      OBSERVED.map((o, i) => advertiser({
        advertiserId: `AR${String(i).padStart(20, '0')}`,
        legalName: o.legalName,
        basedIn: o.basedIn,
        ambiguityFlagged: Boolean(o.ambiguity),
      })),
    );
    expect(results.filter((r) => r.eligibleForCompanyClaim)).toHaveLength(1);
  });
});

describe('MANDATORY NEGATIVE CONTROL — HubSpot domain result (PO-3a)', () => {
  // `?domain=hubspot.com` → ~4K ads across these three verified advertisers.
  const DOMAIN_RESULT = [
    advertiser({ advertiserId: 'AR10072600183532683265', legalName: 'Hubspot, Inc.', basedIn: 'the United States', ambiguityFlagged: true }),
    advertiser({ advertiserId: 'AR17621460850743181313', legalName: 'PT Revolusi Cita Edukasi', basedIn: 'Indonesia' }),
    advertiser({ advertiserId: 'AR00306548136791244801', legalName: "Lisa O'Connell", basedIn: 'the United States' }),
  ];

  it('attributes none of them to HubSpot, because HubSpot declares no legal name', () => {
    const results = resolveAdvertiserSet(HUBSPOT_SUBJECT, DOMAIN_RESULT);
    expect(results.some((r) => r.eligibleForCompanyClaim)).toBe(false);
  });

  it('keeps the unrelated advertisers as reportable third-party findings, not discards', () => {
    const declared: SubjectIdentity = { ...HUBSPOT_SUBJECT, declaredLegalName: 'HubSpot, Inc.' };
    const results = resolveAdvertiserSet(declared, DOMAIN_RESULT);
    const byId = Object.fromEntries(results.map((r) => [r.advertiserId, r]));
    expect(byId['AR17621460850743181313'].state).toBe('NOT_MATCHED');
    expect(byId['AR00306548136791244801'].state).toBe('NOT_MATCHED');
    // Even with the legal name declared, the provider's ambiguity flag still blocks attribution.
    expect(byId['AR10072600183532683265'].eligibleForCompanyClaim).toBe(false);
  });

  it('exposes no parameter through which a destination domain or an ad count could reach the decision', () => {
    // Structural guarantee: the resolver's inputs are the subject identity and ONE observed
    // advertiser. Neither carries a destination domain or any ad count, so there is no path by
    // which "~4K ads point at hubspot.com" could become "HubSpot runs ~4K ads".
    //
    // Asserted as an exact key allowlist rather than a name pattern: a pattern both over-matches
    // (`wikidataDomainVerified` is a boolean about entity verification, not a destination domain)
    // and under-matches (a future `destinationHost` would slip past `/domain/`).
    expect(Object.keys(HUBSPOT_SUBJECT).sort()).toEqual(
      ['brandName', 'declaredLegalName', 'jurisdiction', 'wikidataDomainVerified'],
    );
    expect(Object.keys(advertiser()).sort()).toEqual(
      ['advertiserId', 'ambiguityFlagged', 'basedIn', 'legalName', 'verified'],
    );
    // And the one field whose name mentions a domain carries a boolean, never a host string.
    expect(typeof HUBSPOT_SUBJECT.wikidataDomainVerified).toBe('boolean');
  });
});

describe('multiple legitimate advertiser accounts', () => {
  it('resolves each account independently and does not collapse the set', () => {
    const results = resolveAdvertiserSet(WIX_SUBJECT, [
      advertiser({ advertiserId: 'AR_IL', legalName: 'WIX.COM LTD', basedIn: 'Israel' }),
      advertiser({ advertiserId: 'AR_US', legalName: 'Wix.com Inc.', basedIn: 'United States', ambiguityFlagged: true }),
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].state).toBe('MATCHED');
    expect(results[1].state).toBe('UNRESOLVED');
  });
});

/**
 * WP-2 — the same correction, observed through the GOOGLE path rather than the pure function.
 *
 * The resolver is reached in production only from `observePublicAdvertising`, which stamps every
 * observation with the platform the injected client DECLARES. Asserting the fix here proves it
 * lands on the live Google surface — the only platform this build can observe — and not merely in
 * a function someone might call. Still no network: the provider seam is injected, as it is in
 * production on the Railway plane.
 */
describe('WP-2 — the fix lands on the Google identity-resolution path', () => {
  /** hubspot.com exactly as measured: JSON-LD says "US", the provider profile says the name. */
  const SUBJECT: SubjectIdentity = {
    declaredLegalName: 'HubSpot, Inc.',
    brandName: 'HubSpot',
    jurisdiction: 'US',
    wikidataDomainVerified: true,
  };

  const GOOGLE_CLIENT: AdsTransparencyClient = {
    platform: ADS_PLATFORM_GOOGLE,
    async searchAdvertisers() {
      return [{
        advertiserId: 'AR10072600183532683265',
        name: 'Hubspot, Inc.',
        basedIn: 'the United States',
        verified: true,
        ambiguityFlagged: false,
        adCountLabel: '~4K ads',
      }];
    },
    async openAdvertiser(advertiserId: string) {
      return {
        advertiserId,
        legalName: 'Hubspot, Inc.',
        basedIn: 'the United States',
        verified: true,
        ambiguityFlagged: false,
        adCountLabel: '~4K ads',
        creativeIds: [],
        profileUrl: `https://adstransparency.google.com/advertiser/${advertiserId}`,
      };
    },
  };

  it('attributes the verified advertiser to the company on an ISO-2 vs country-name jurisdiction', async () => {
    const result = await observePublicAdvertising({
      subject: SUBJECT,
      searchNames: ['HubSpot, Inc.'],
      client: GOOGLE_CLIENT,
      vantage: 'test-vantage',
      now: () => new Date('2026-10-02T00:00:00.000Z'),
    });

    // The observation is a GOOGLE observation, by the client's own declaration.
    expect(result.platform).toBe('google');
    expect(result.accessState).toBe('observed');

    // NON-VACUITY: discovery really produced a candidate and the resolver really ran on it.
    // Without these, every assertion below would also hold for an empty advertiser list.
    expect(result.advertisers.length).toBeGreaterThan(0);
    expect(result.counts.candidateAdvertisers).toBeGreaterThan(0);
    expect(result.advertisers.map((a) => a.observation.advertiserId))
      .toContain('AR10072600183532683265');

    const record = result.advertisers.find((a) => a.observation.advertiserId === 'AR10072600183532683265');
    expect(record).toBeDefined();
    expect(record!.resolution.state).toBe('MATCHED');
    expect(record!.resolution.eligibleForCompanyClaim).toBe(true);
    expect(result.counts.matchedAdvertiserAccounts).toBe(1);
  });

  it('still refuses attribution on the same Google path when the jurisdictions genuinely differ', async () => {
    const elsewhere: AdsTransparencyClient = {
      ...GOOGLE_CLIENT,
      async openAdvertiser(advertiserId: string) {
        const profile = await GOOGLE_CLIENT.openAdvertiser(advertiserId);
        return profile ? { ...profile, basedIn: 'Indonesia' } : null;
      },
    };
    const result = await observePublicAdvertising({
      subject: SUBJECT,
      searchNames: ['HubSpot, Inc.'],
      client: elsewhere,
      vantage: 'test-vantage',
      now: () => new Date('2026-10-02T00:00:00.000Z'),
    });

    expect(result.platform).toBe('google');
    expect(result.advertisers.length).toBeGreaterThan(0);
    expect(result.advertisers[0].resolution.state).toBe('PROBABLE_MATCH');
    expect(result.counts.matchedAdvertiserAccounts).toBe(0);
  });
});
