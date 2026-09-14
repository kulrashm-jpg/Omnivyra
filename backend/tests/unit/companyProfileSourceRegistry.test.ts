/**
 * CPG-003 — source registry, field-specific authority, retrieval policy,
 * field-sensitive freshness, and the Wikidata source.
 *
 * NO NETWORK CALL IS MADE. The Wikidata source receives an injected FIXTURE
 * lookup; every other source receives a fixture fetcher. All fixture data is
 * hand-written and is never presented as retrieved evidence.
 */

import {
  SOURCE_REGISTRY, describeSource, authorityForField, rankSourcesForField,
  providerFamily, countIndependentFamilies, registrableDomain,
} from '../../services/companyProfile/grounding/acquisition/sourceRegistry';
import {
  selectSources, assessFieldFreshness, describeFreshness, EVENT_DATED_FIELDS,
  type AvailableIdentifiers,
} from '../../services/companyProfile/grounding/acquisition/retrievalPolicy';
import { createWikidataSource } from '../../services/companyProfile/grounding/acquisition/wikidataSource';
import { orchestrateGrounding } from '../../services/companyProfile/grounding/acquisition/orchestrator';
import { normalizeValue, type AcquisitionContext, type EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import { filterReadable } from '../../services/companyProfile/grounding/groundingAccess';
import type { EntitySignals, UserClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const COMPANY = 'company-001';
const DOMAIN = 'secureitsimply.com';

const KNOWN: EntitySignals = {
  companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: null,
  location: 'India', leadership: ['Jitesh Midha'], registryId: null,
};

const fixtureFetcher: EvidenceFetcher = async (url) => ({ ok: false, status: 404, url, text: '' });

const ctx = (over: Partial<AcquisitionContext> = {}): AcquisitionContext => ({
  companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, fetcher: fixtureFetcher, ...over,
});

const ids = (over: Partial<AvailableIdentifiers> = {}): AvailableIdentifiers => ({
  companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: null,
  knownPeople: ['Jitesh Midha'], industry: 'Cybersecurity', location: 'India',
  userSuppliedUrls: [], ...over,
});

const uc = (field: string, value: string): UserClaim => ({
  field, value, normalizedValue: normalizeValue(value), assertedAt: '2026-08-01T00:00:00.000Z', assertedBy: 'u1',
});

describe('CPG-003 (1) provider/source registry', () => {
  it('every descriptor is fully specified', () => {
    for (const s of SOURCE_REGISTRY) {
      expect(s.id).toBeTruthy();
      expect(s.category).toBeTruthy();
      expect(s.retrieval).toBeTruthy();
      expect(s.credential).toBeTruthy();
      expect(s.availability).toBeTruthy();
      expect(s.freshness).toBeTruthy();
      expect(s.evidence).toBeTruthy();
      expect(Array.isArray(s.authoritativeFor)).toBe(true);
      expect(Array.isArray(s.neverFor)).toBe(true);
    }
  });

  it('records first-party vs independent honestly', () => {
    expect(describeSource('first_party_website')!.firstParty).toBe(true);
    expect(describeSource('wikidata')!.firstParty).toBe(false);
    expect(describeSource('user_supplied_url')!.firstParty).toBe(false);
  });

  it('keeps unavailable sources listed with their restriction rather than hidden', () => {
    // CPG-010: general_web_search left this list (CPG-006 built keyless
    // discovery — the pin was stale); mca_registry joined it (live 403).
    expect(describeSource('general_web_search')!.availability).toBe('callable');
    for (const id of ['linkedin', 'corporate_registry', 'mca_registry']) {
      const s = describeSource(id)!;
      expect(s.availability).toBe('unavailable');
      expect(s.restriction).toBeTruthy();
    }
  });

  it('CORRECTS CPG-002: Wikidata is callable and keyless', () => {
    const w = describeSource('wikidata')!;
    expect(w.availability).toBe('callable');
    expect(w.credential).toBe('keyless');
    expect(w.evidence).toMatch(/wikidataAdapter/);
  });
});

describe('CPG-003 (2) field-specific authority', () => {
  it('a company website is authoritative for identity but NEVER for revenue', () => {
    expect(authorityForField('first_party_website', 'products_services')).toBe('authoritative');
    expect(authorityForField('first_party_website', 'revenue')).toBe('never');
  });

  it('a leadership page outranks Wikidata for CEO', () => {
    const ranked = rankSourcesForField('ceo', ['wikidata', 'first_party_leadership', 'first_party_website']);
    expect(ranked[0].id).toBe('first_party_leadership');
  });

  it('a regulatory FILING outranks a website for revenue, and the website is excluded entirely', () => {
    // CPG-010: this pinned the generic registry as revenue-authoritative. A
    // registry MASTER RECORD states who an entity is, not what it earned; the
    // filing (10-K / 20-F) is the revenue authority.
    const ranked = rankSourcesForField('revenue', ['first_party_website', 'sec_edgar_filing', 'corporate_registry', 'sec_edgar_registrant', 'user_supplied_url']);
    expect(ranked[0].id).toBe('sec_edgar_filing');
    expect(ranked.map((s) => s.id)).not.toContain('first_party_website');
    expect(ranked.map((s) => s.id)).not.toContain('corporate_registry');
    expect(ranked.map((s) => s.id)).not.toContain('sec_edgar_registrant');
  });

  it('Wikidata is authoritative for founded_year but never for positioning', () => {
    expect(authorityForField('wikidata', 'founded_year')).toBe('authoritative');
    expect(authorityForField('wikidata', 'brand_positioning')).toBe('never');
    expect(authorityForField('wikidata', 'revenue')).toBe('never');
  });

  it('ranking is deterministic', () => {
    const a = rankSourcesForField('ceo', ['wikidata', 'first_party_leadership']).map((s) => s.id);
    const b = rankSourcesForField('ceo', ['first_party_leadership', 'wikidata']).map((s) => s.id);
    expect(a).toEqual(b);
  });
});

describe('CPG-003 (3,5,6) retrieval policy — smallest sufficient source set', () => {
  it('selects only callable sources we hold identifiers for', () => {
    const { selected, skipped } = selectSources(['name', 'industry'], ids());
    const sel = selected.map((s) => s.id);
    expect(sel).toContain('first_party_website');
    expect(sel).toContain('wikidata');
    expect(sel).not.toContain('linkedin');
    expect(skipped.find((s) => s.id === 'linkedin')!.reason).toMatch(/not callable/);
  });

  it('skips first-party crawl when no domain is known', () => {
    const { selected, skipped } = selectSources(['name'], ids({ domain: null }));
    expect(selected.map((s) => s.id)).not.toContain('first_party_website');
    expect(skipped.find((s) => s.id === 'first_party_website')!.reason).toMatch(/company domain/);
  });

  it('skips user-supplied source when no URL was given, and includes it when one was', () => {
    expect(selectSources(['name'], ids()).selected.map((s) => s.id)).not.toContain('user_supplied_url');
    expect(selectSources(['name'], ids({ userSuppliedUrls: ['https://inc42.com/x'] })).selected.map((s) => s.id))
      .toContain('user_supplied_url');
  });

  it('records uncredentialed vendors as skipped, not silently dropped', () => {
    const { skipped } = selectSources(['employee_count'], ids());
    expect(skipped.find((s) => s.id === 'crunchbase')!.reason).toMatch(/implemented_no_credential/);
  });

  it('does not query a source that is never permitted for any requested field', () => {
    const { selected } = selectSources(['revenue'], ids());
    expect(selected.map((s) => s.id)).not.toContain('first_party_website');
  });
});

describe('CPG-003 (9) corroboration independence', () => {
  it('two pages of the same website are ONE family', () => {
    expect(countIndependentFamilies([
      { sourceId: 'first_party_website', host: DOMAIN },
      { sourceId: 'first_party_leadership', host: DOMAIN },
      { sourceId: 'first_party_newsroom', host: DOMAIN },
    ])).toBe(1);
  });

  it('genuinely distinct providers count separately', () => {
    expect(countIndependentFamilies([
      { sourceId: 'first_party_website', host: DOMAIN },
      { sourceId: 'wikidata', host: 'wikidata.org' },
      { sourceId: 'crunchbase', host: 'api.crunchbase.com' },
    ])).toBe(3);
  });

  // CPG-008: this test's NAME said "distinct" but its assertion was `toBe` —
  // it pinned the defect that collapsed every user-referenced publisher into
  // one "user_reference" family. The assertion now matches the name.
  it('user-supplied articles from different hosts are distinct families', () => {
    expect(providerFamily('user_supplied_url', 'inc42.com'))
      .not.toBe(providerFamily('user_supplied_url', 'yourstory.com'));
  });

  it('CPG-008: families are PUBLISHER-level — subdomains of one publisher are one family', () => {
    expect(providerFamily('general_web_search', 'en.wikipedia.org')).toBe(providerFamily('general_web_search', 'hi.wikipedia.org'));
    expect(providerFamily('general_web_search', 'economictimes.indiatimes.com'))
      .toBe(providerFamily('general_web_search', 'timesofindia.indiatimes.com'));
    expect(registrableDomain('www.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(providerFamily('general_web_search', 'livemint.com')).not.toBe(providerFamily('general_web_search', 'forbes.com'));
  });
});

describe('CPG-003 (10,11) field-sensitive freshness and historical validity', () => {
  const at = (days: number) => new Date(Date.parse(ASOF) - days * 86_400_000).toISOString();

  it('CEO evidence goes stale far faster than a founding year', () => {
    expect(assessFieldFreshness('ceo', at(200), ASOF, ASOF).freshness).toBe('aging');
    expect(assessFieldFreshness('founded_year', at(3000), ASOF, ASOF).freshness).toBe('fresh');
  });

  it('stale evidence stays historically valid and is never discarded', () => {
    const f = assessFieldFreshness('revenue', at(1200), ASOF, ASOF);
    expect(f.freshness).toBe('stale');
    expect(f.historicallyValid).toBe(true);
    expect(f.presentation).toBe('historical_only');
    expect(describeFreshness('revenue', f)).toMatch(/must NOT be presented as current/);
  });

  it('funding is event-dated: it does not decay', () => {
    expect(EVENT_DATED_FIELDS.has('funding')).toBe(true);
    const f = assessFieldFreshness('funding', at(2000), ASOF, ASOF);
    expect(f.eventDated).toBe(true);
    expect(f.freshness).toBe('fresh');
    expect(f.presentation).toBe('event_on_date');
    expect(describeFreshness('funding', f)).toMatch(/permanently valid as history/);
  });

  it('undateable evidence is undated, not assumed fresh', () => {
    const f = assessFieldFreshness('ceo', null, 'not-a-date', ASOF);
    expect(f.freshness).toBe('unknown');
    expect(f.presentation).toBe('undated');
  });
});

describe('CPG-003 (4,18) Wikidata source — reuse, no fabrication', () => {
  const lookup = (over: Partial<{ founded_year: string; team_size: string; revenue_range: string; matched_label: string }> = {}) =>
    async () => ({ founded_year: null, team_size: null, revenue_range: null, matched_label: null, ...over });

  it('maps a matched entity to claims with a traceable URL', async () => {
    const src = createWikidataSource(lookup({ matched_label: 'Secure IT Simply', founded_year: '2016', team_size: '25' }), () => true);
    const res = await src.acquire(ctx());
    expect(res.state).toBe('retrieved');
    if (res.state !== 'retrieved') return;
    expect(res.claims.map((c) => c.field).sort()).toEqual(['employee_count', 'founded_year', 'name']);
    expect(res.claims.every((c) => c.sourceUrl?.startsWith('https://www.wikidata.org'))).toBe(true);
    expect(res.claims.every((c) => c.sourceName === 'Wikidata')).toBe(true);
  });

  it('a measured absence is no_coverage, never a fabricated value', async () => {
    const res = await createWikidataSource(lookup(), () => true).acquire(ctx());
    expect(res.state).toBe('unavailable');
    if (res.state === 'unavailable') expect(res.reason).toBe('no_coverage');
  });

  it('revenue_range is NOT mapped onto revenue', async () => {
    const src = createWikidataSource(lookup({ matched_label: 'X', revenue_range: '10M-50M' }), () => true);
    const res = await src.acquire(ctx());
    if (res.state !== 'retrieved') throw new Error('expected retrieved');
    expect(res.claims.map((c) => c.field)).toContain('revenue_range');
    expect(res.claims.map((c) => c.field)).not.toContain('revenue');
    expect(res.claims.map((c) => c.field)).not.toContain('annual_revenue');
  });

  it('never claims the company domain as its own entity signal', async () => {
    const src = createWikidataSource(lookup({ matched_label: 'X' }), () => true);
    const res = await src.acquire(ctx());
    if (res.state !== 'retrieved') throw new Error('expected retrieved');
    expect(res.claims.every((c) => c.entitySignals.domain === null)).toBe(true);
  });

  it('respects the kill switch', async () => {
    expect(await createWikidataSource(lookup({ matched_label: 'X' }), () => false).isAvailable()).toBe(false);
  });

  it('is unavailable without a company name', async () => {
    const res = await createWikidataSource(lookup({ matched_label: 'X' }), () => true)
      .acquire(ctx({ knownEntity: { ...KNOWN, companyName: null } }));
    expect(res.state).toBe('unavailable');
  });
});

describe('CPG-003 (7,8,12,13,16,17,19) end-to-end through the CPG-001 resolver', () => {
  const wikidata = (label: string, founded: string | null = null) =>
    createWikidataSource(async () => ({ founded_year: founded, team_size: null, revenue_range: null, matched_label: label }), () => true);

  const run = (over: Parameters<typeof orchestrateGrounding>[0] extends infer T ? Partial<T> : never = {}) =>
    orchestrateGrounding({
      companyId: COMPANY, knownEntity: KNOWN, companyDomain: DOMAIN,
      userClaims: [], fieldsOfInterest: [], sources: [], fetcher: fixtureFetcher, asOf: ASOF,
      ...over,
    } as Parameters<typeof orchestrateGrounding>[0]);

  it('(7) entity mismatch — a foreign Wikidata match is retained, never effective', async () => {
    const foreign = createWikidataSource(
      async () => ({ founded_year: '1999', team_size: null, revenue_range: null, matched_label: 'Spetrol International' }),
      () => true,
    );
    const r = await run({
      knownEntity: { ...KNOWN, companyName: 'Secure IT Simply', domain: DOMAIN },
      sources: [foreign], fieldsOfInterest: ['founded_year'],
    });
    const f = r.fields.find((x) => x.field === 'founded_year')!;
    // Name-only signals can never exceed a weak match, so this is at best reported.
    expect(['PUBLICLY_REPORTED', 'UNVERIFIED']).toContain(f.status);
    expect(f.confidence.band).not.toBe('VERIFIED_CANDIDATE');
  });

  it('(12,19) a user claim is never overwritten by Wikidata', async () => {
    const r = await run({
      userClaims: [uc('name', 'Secure IT Simply Pvt Ltd')],
      sources: [wikidata('Secure IT Simply')],
    });
    const f = r.fields.find((x) => x.field === 'name')!;
    expect(f.effectiveValue).toBe('Secure IT Simply Pvt Ltd');
    expect(f.effectiveValueSource).toBe('user');
  });

  it('(16) a throwing source does not fail the profile', async () => {
    const boom = { id: 'boom', label: 'boom', isAvailable: () => true, async acquire(): Promise<never> { throw new Error('kaboom'); } };
    const r = await run({ sources: [boom, wikidata('Secure IT Simply', '2016')], fieldsOfInterest: ['founded_year'] });
    expect(r.sourceOutcomes.find((o) => o.sourceId === 'boom')!.state).toBe('errored');
    expect(r.fields.find((f) => f.field === 'founded_year')?.evidence.length).toBeGreaterThan(0);
  });

  it('(17) orchestration with the registry sources is deterministic', async () => {
    const once = await run({ sources: [wikidata('Secure IT Simply', '2016')] });
    const twice = await run({ sources: [wikidata('Secure IT Simply', '2016')] });
    expect(JSON.stringify(once)).toBe(JSON.stringify(twice));
  });

  it('(13) financial measures stay distinct end-to-end', async () => {
    const r = await run({
      userClaims: [uc('revenue', '₹10 Cr+ revenue')],
      sources: [{
        id: 'ref', label: 'ref', isAvailable: () => true,
        async acquire() {
          return {
            state: 'retrieved' as const, documentsFetched: 1,
            claims: [{
              claimId: 'c1', field: 'revenue', value: '₹40 Cr order book', normalizedValue: '₹40 cr order book',
              sourceType: 'editorial' as const, sourceName: 'CEO Insider', sourceUrl: 'https://ceoinsider.io/x',
              sourcePublishedAt: '2026-08-01T00:00:00.000Z', sourceAccessedAt: ASOF, excerpt: null,
              verificationMethod: 'crawl' as const,
              entitySignals: { companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
            }],
          };
        },
      }],
    });
    const f = r.fields.find((x) => x.field === 'revenue')!;
    expect(f.isMaterialConflict).toBe(false);   // order book ≠ revenue
    expect(f.conflictingEvidence.map((e) => e.value)).toContain('₹40 Cr order book'); // retained
  });

  it('(14,15) provenance and source URLs survive to the grounded field', async () => {
    const r = await run({ sources: [wikidata('Secure IT Simply', '2016')], fieldsOfInterest: ['founded_year'] });
    const f = r.fields.find((x) => x.field === 'founded_year')!;
    expect(f.evidence[0].sourceUrl).toMatch(/^https:\/\/www\.wikidata\.org/);
    expect(f.evidence[0].sourceAccessedAt).toBe(ASOF);
  });

  it('(20) tenant isolation holds for registry-sourced output', async () => {
    const mine = (await run({ sources: [wikidata('Secure IT Simply')] })).fields;
    const theirs = (await run({ companyId: 'other-co', sources: [wikidata('Secure IT Simply')] } as never)).fields;
    const visible = filterReadable({ userId: 'u1', memberships: [{ companyId: COMPANY, role: 'viewer' }] }, [...mine, ...theirs]);
    expect(visible.every((f) => f.companyId === COMPANY)).toBe(true);
  });
});
