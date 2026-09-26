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

  it('does not expand country codes, and treats unknown as disagreement', () => {
    expect(jurisdictionsAgree('NL', 'the Netherlands')).toBe(false);
    expect(jurisdictionsAgree(null, 'Israel')).toBe(false);
    expect(jurisdictionsAgree('Israel', null)).toBe(false);
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
