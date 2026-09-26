/**
 * PO-3 — subject-side identity extraction, and the two scoping rules that make it trustworthy.
 *
 * WHY THIS SUITE EXISTS.
 *
 * (1) JSON-LD. Every other static signal in `extractPageSignals` is recovered with a
 *     document-wide regex. For a publication date that is fine. For a LEGAL NAME it is not: a
 *     document-wide `"legalName"` match reads whatever the page happens to contain — a parent
 *     company, a partner, an embedded widget's vendor — and Report 1 would then compare a
 *     Google-verified advertiser against somebody else's entity. The extractor therefore parses
 *     the blocks and reads the field only from an Organization node.
 *
 * (2) Wikidata. `wbsearchentities` ranks by name, so the first hit for `Wix` is `Q1839789` — a
 *     village and civil parish in Essex, England. The company, `Q420506`, is second. Taking hit[0]
 *     put an English village's knowledge-graph entity into a Wix customer's report. Both QIDs and
 *     both descriptions below were observed live on 2026-09-26.
 *
 * SECRETS: none. No network — the extractors under test are pure.
 */
import { extractOrganizationIdentity } from '../../services/crawlerService';
import {
  normalizeIdentityHost,
  selectDomainVerifiedCandidate,
} from '../../services/intelligence/adapters/wikidataAdapter';

describe('extractOrganizationIdentity — Organization-scoped, parsed not regexed', () => {
  it('reads legalName and addressCountry from an Organization node', () => {
    // Shape observed on wix.com: Organization with a declared legal name.
    const block = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Wix.com',
      legalName: 'Wix.com Ltd',
      url: 'https://www.wix.com/',
      address: { '@type': 'PostalAddress', addressCountry: 'IL' },
    });
    expect(extractOrganizationIdentity([block])).toEqual({
      legal_name: 'Wix.com Ltd',
      address_country: 'IL',
    });
  });

  it('IGNORES a legalName that is not on an Organization node', () => {
    // The regex approach would return "Some Other Entity Ltd" here. That is the defect.
    const block = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: 'A post',
      publisher: { '@type': 'Person', name: 'X', legalName: 'Some Other Entity Ltd' },
    });
    expect(extractOrganizationIdentity([block]).legal_name).toBeNull();
  });

  it('takes the FIRST Organization — a later one is typically a partner or publisher', () => {
    const blocks = [
      JSON.stringify({ '@type': 'Organization', name: 'Subject', legalName: 'Subject Ltd' }),
      JSON.stringify({ '@type': 'Organization', name: 'Partner', legalName: 'Partner GmbH' }),
    ];
    expect(extractOrganizationIdentity(blocks).legal_name).toBe('Subject Ltd');
  });

  it('walks @graph, the common CMS shape', () => {
    const block = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'site' },
        { '@type': 'Organization', name: 'Acme', legalName: 'Acme Holdings B.V.' },
      ],
    });
    expect(extractOrganizationIdentity([block]).legal_name).toBe('Acme Holdings B.V.');
  });

  it('accepts Organization sub-types and array @type', () => {
    expect(extractOrganizationIdentity([
      JSON.stringify({ '@type': 'Corporation', legalName: 'Corp Ltd' }),
    ]).legal_name).toBe('Corp Ltd');
    expect(extractOrganizationIdentity([
      JSON.stringify({ '@type': ['Thing', 'LocalBusiness'], legalName: 'Shop Ltd' }),
    ]).legal_name).toBe('Shop Ltd');
  });

  it('recovers nothing from a malformed block rather than falling back to a regex', () => {
    expect(extractOrganizationIdentity(['{ this is not json'])).toEqual({
      legal_name: null,
      address_country: null,
    });
  });

  it('returns null — never an empty string — when the Organization declares no legalName', () => {
    // Shape observed on hubspot.com: Organization present, legalName absent.
    const block = JSON.stringify({
      '@type': 'Organization',
      name: 'HubSpot',
      url: 'https://www.hubspot.com',
      address: { addressCountry: 'US' },
    });
    expect(extractOrganizationIdentity([block])).toEqual({ legal_name: null, address_country: 'US' });
  });

  it('handles a site with no JSON-LD at all', () => {
    // Shape observed on booking.com: zero JSON-LD blocks on the homepage.
    expect(extractOrganizationIdentity([])).toEqual({ legal_name: null, address_country: null });
  });
});

describe('normalizeIdentityHost', () => {
  it('normalises scheme, case and a single leading www.', () => {
    expect(normalizeIdentityHost('https://WWW.Wix.com/')).toBe('wix.com');
    expect(normalizeIdentityHost('wix.com')).toBe('wix.com');
  });

  it('treats a subdomain as a DIFFERENT host', () => {
    // `editor.wix.com` is a real second P856 value on Q420506. Collapsing it would widen a
    // verification into a guess.
    expect(normalizeIdentityHost('https://editor.wix.com')).toBe('editor.wix.com');
    expect(normalizeIdentityHost('https://editor.wix.com')).not.toBe('wix.com');
  });

  it('returns null for unusable input', () => {
    expect(normalizeIdentityHost('')).toBeNull();
    expect(normalizeIdentityHost(null)).toBeNull();
  });
});

describe('selectDomainVerifiedCandidate — the Wix defect', () => {
  // Observed live 2026-09-26: the real wbsearchentities ranking for the query `Wix`.
  const WIX_CANDIDATES = [
    { id: 'Q1839789', officialWebsites: [] as string[] },                                // village in Essex — ranked FIRST
    { id: 'Q420506', officialWebsites: ['https://wix.com/', 'https://editor.wix.com'] },  // Wix.com — the company
    { id: 'Q16282649', officialWebsites: [] as string[] },                                // family name
    { id: 'Q54450', officialWebsites: ['http://www.vicques.ch'] },                        // Swiss village
    { id: 'Q591134', officialWebsites: [] as string[] },                                  // Wixford
  ];

  it('rejects the first search hit and selects the domain-declaring entity', () => {
    expect(selectDomainVerifiedCandidate(WIX_CANDIDATES, 'wix.com')).toEqual({ id: 'Q420506' });
  });

  it('matches on ANY P856 value, not only the first', () => {
    const candidates = [{ id: 'Q1', officialWebsites: ['https://other.example', 'https://acme.com'] }];
    expect(selectDomainVerifiedCandidate(candidates, 'acme.com')).toEqual({ id: 'Q1' });
  });

  it('returns null rather than silently selecting hit[0] when nothing matches', () => {
    // The whole point: "we could not verify which organisation this is" must stay distinct from
    // "the first name-search result".
    expect(selectDomainVerifiedCandidate(WIX_CANDIDATES, 'example.com')).toBeNull();
  });

  it('returns null when no domain is available to verify against', () => {
    expect(selectDomainVerifiedCandidate(WIX_CANDIDATES, null)).toBeNull();
    expect(selectDomainVerifiedCandidate(WIX_CANDIDATES, '')).toBeNull();
  });

  it('does not match a subdomain against the registrable host', () => {
    expect(selectDomainVerifiedCandidate(WIX_CANDIDATES, 'editor.wix.com')).toEqual({ id: 'Q420506' });
    const onlySub = [{ id: 'Q9', officialWebsites: ['https://editor.wix.com'] }];
    expect(selectDomainVerifiedCandidate(onlySub, 'wix.com')).toBeNull();
  });

  it('selects correctly for the subjects whose first hit was already right', () => {
    // Booking.com and HubSpot resolved correctly by luck before the fix; they must keep doing so.
    expect(selectDomainVerifiedCandidate(
      [{ id: 'Q4035313', officialWebsites: ['https://www.booking.com/'] }], 'booking.com',
    )).toEqual({ id: 'Q4035313' });
    expect(selectDomainVerifiedCandidate(
      [{ id: 'Q5926631', officialWebsites: ['https://www.hubspot.com'] }], 'hubspot.com',
    )).toEqual({ id: 'Q5926631' });
  });
});
