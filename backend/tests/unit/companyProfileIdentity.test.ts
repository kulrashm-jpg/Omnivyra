/**
 * CPG-009 — deterministic entity identity (B-21).
 *
 * SYNTHETIC ADVERSARIAL FIXTURES. No network, no database, no LLM. Every
 * document and claim below is hand-built test data, never presented as
 * retrieved evidence. The live run is reported separately.
 *
 * What is under test: a public document is attributed to the company only on
 * deterministic identity evidence, and PUBLICLY_VERIFIED needs BOTH sufficient
 * field evidence AND decisive identity — separately.
 */

import { resolveEntity } from '../../services/companyProfile/grounding/entityResolution';
import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import { extractIdentityEvidence } from '../../services/companyProfile/grounding/extraction/identityEvidence';
import { establishDomainAliases } from '../../services/companyProfile/grounding/acquisition/domainIdentity';
import { extractFunding, extractRevenue } from '../../services/companyProfile/grounding/extraction/documentExtractors';
import { ingestUserSuppliedUrls } from '../../services/companyProfile/grounding/acquisition/userSuppliedSource';
import { createWikidataSource } from '../../services/companyProfile/grounding/acquisition/wikidataSource';
import { createDiscoveredWebSource } from '../../services/companyProfile/grounding/acquisition/discoveredSource';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';
import type { DomainAlias, EntitySignals, EvidenceClaim, IdentityEvidence, UserClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const FRESH = '2026-08-20T00:00:00.000Z';
const CO = 'Acme Technologies';
const DOMAIN = 'acme.example.com';
const KNOWN: EntitySignals = { companyName: CO, domain: DOMAIN, linkedinUrl: 'https://www.linkedin.com/company/acme-tech', location: 'Pune, India', leadership: ['Asha Rao'], registryId: 'U72200PN2015PTC123456' };
const blank = { domain: null, linkedinUrl: null, location: null, leadership: [] as string[], registryId: null };
const doc = (o: Partial<EntitySignals> = {}): EntitySignals => ({ companyName: CO, ...blank, ...o });
const site = (host: string): IdentityEvidence => ({ kind: 'labelled_website', value: host, detail: `Website ${host}` });
const jsonld = (host: string): IdentityEvidence => ({ kind: 'json_ld_org_url', value: host, detail: `JSON-LD Organization declares https://${host}/` });
const IR_ALIAS: DomainAlias = { domain: 'acme-investors.example.net', evidence: 'first_party_ir_link', sourceUrl: `https://${DOMAIN}/`, detail: 'links "Investor Relations"' };

describe('CPG-009 (1) the identity hierarchy', () => {
  it('first-party document on the canonical domain → DECISIVE', () => {
    const m = resolveEntity(KNOWN, doc({ domain: DOMAIN, sourceHost: `www.${DOMAIN}` }));
    expect(m.identity).toBe('DECISIVE');
    expect(m.signals!.some((s) => s.signal === 'first_party_host' && s.outcome === 'match')).toBe(true);
  });

  it('an ESTABLISHED secondary domain is DECISIVE, with its evidence in the reason', () => {
    const m = resolveEntity({ ...KNOWN, domainAliases: [IR_ALIAS] }, doc({ sourceHost: 'acme-investors.example.net' }));
    expect(m.identity).toBe('DECISIVE');
    expect(m.reason).toMatch(/established alias acme-investors\.example\.net \(first_party_ir_link/);
  });

  it('the same secondary domain WITHOUT established evidence proves nothing (name only → WEAK)', () => {
    const m = resolveEntity(KNOWN, doc({ sourceHost: 'acme-investors.example.net' }));
    expect(m.identity).toBe('WEAK');
  });

  it('the document\'s own statement of the company\'s website → DECISIVE (JSON-LD or "Website" field)', () => {
    expect(resolveEntity(KNOWN, doc({ identityEvidence: [jsonld(DOMAIN)] })).identity).toBe('DECISIVE');
    expect(resolveEntity(KNOWN, doc({ identityEvidence: [site(`www.${DOMAIN}`)] })).identity).toBe('DECISIVE');
  });

  it('registry identifier and LinkedIn company identifier → DECISIVE', () => {
    expect(resolveEntity(KNOWN, doc({ identityEvidence: [{ kind: 'registry_id', value: 'U72200PN2015PTC123456', detail: 'CIN' }] })).identity).toBe('DECISIVE');
    expect(resolveEntity(KNOWN, doc({ identityEvidence: [{ kind: 'linkedin_company', value: 'acme-tech', detail: 'link' }] })).identity).toBe('DECISIVE');
  });

  it('third-party, name only → WEAK, and the reason says why', () => {
    const m = resolveEntity(KNOWN, doc({ sourceHost: 'news-a.example', publisher: 'News A' }));
    expect(m.identity).toBe('WEAK');
    expect(m.reason).toMatch(/no domain, registry, LinkedIn or website statement/);
  });

  it('leadership or a link to the domain → SUPPORTING — still not decisive', () => {
    expect(resolveEntity(KNOWN, doc({ leadership: ['Asha Rao'] })).identity).toBe('SUPPORTING');
    expect(resolveEntity(KNOWN, doc({ identityEvidence: [{ kind: 'domain_link', value: DOMAIN, detail: 'link' }] })).identity).toBe('SUPPORTING');
  });

  it('publisher ≠ subject: the publisher\'s name is recorded but never compared', () => {
    const m = resolveEntity(KNOWN, doc({ publisher: 'Completely Different Media', sourceHost: 'cdm.example' }));
    expect(m.identity).toBe('WEAK');
    expect(JSON.stringify(m.signals)).not.toContain('Completely Different Media');
  });

  it('nothing comparable → UNKNOWN (absence of evidence is not a mismatch)', () => {
    expect(resolveEntity(KNOWN, { companyName: null, ...blank, publisher: 'Inc42' }).identity).toBe('UNKNOWN');
  });
});

describe('CPG-009 (2) collisions — Cases A–F', () => {
  it('A: an unrelated company with the SAME name — stays WEAK without evidence; MISMATCH when it states another website', () => {
    expect(resolveEntity(KNOWN, doc()).identity).toBe('WEAK');
    const other = resolveEntity(KNOWN, doc({ identityEvidence: [jsonld('acme-tech.io')] }));
    expect(other.identity).toBe('MISMATCH');
    expect(other.reason).toMatch(/DIFFERENT website \(acme-tech\.io\)/);
  });

  it('A: a same-name organisation whose registry id or LinkedIn differs → MISMATCH', () => {
    expect(resolveEntity(KNOWN, doc({ registryId: 'U99999MH2001PTC000001' })).identity).toBe('MISMATCH');
    expect(resolveEntity(KNOWN, doc({ linkedinUrl: 'https://linkedin.com/company/acme-other' })).identity).toBe('MISMATCH');
  });

  it('B: parent / subsidiary — "Acme Holdings" is not "Acme Technologies"', () => {
    // Before CPG-009 both normalised to "acme" and matched perfectly.
    expect(resolveEntity(KNOWN, doc({ companyName: 'Acme Holdings' })).identity).toBe('MISMATCH');
    expect(extractFunding('<p>Acme Holdings raised $20 million in a Series B round.</p>', 'Acme').values).toHaveLength(0);
  });

  it('C: product / company — "Acme Platform" is not the company', () => {
    expect(extractRevenue('<p>Acme Platform revenue was $5 million in 2024.</p>', 'Acme').values).toHaveLength(0);
    expect(extractFunding('<p>Acme Platform raised $5 million in a seed round.</p>', 'Acme').values).toHaveLength(0);
  });

  it('D: similar names — Tata Motors is not Tata Consultancy Services', () => {
    const tcs: EntitySignals = { ...KNOWN, companyName: 'Tata Consultancy Services', domain: 'tcs.com', linkedinUrl: null, registryId: null, leadership: [], location: null };
    expect(resolveEntity(tcs, doc({ companyName: 'Tata Motors' })).identity).toBe('MISMATCH');
  });

  it('E: geography — location supports but never proves, and a different city alone is not a mismatch', () => {
    expect(resolveEntity(KNOWN, doc({ location: 'Pune' })).identity).toBe('WEAK');                // name + location: still weak
    const elsewhere = resolveEntity(KNOWN, doc({ location: 'Austin, Texas' }));
    expect(elsewhere.identity).toBe('WEAK');                                                        // name matches, city conflicts
    expect(elsewhere.signals!.some((s) => s.signal === 'location' && s.outcome === 'conflict')).toBe(true);
    // …and with a decisive identifier, a different city is a note, not a veto.
    expect(resolveEntity(KNOWN, doc({ location: 'Austin, Texas', identityEvidence: [site(DOMAIN)] })).identity).toBe('DECISIVE');
  });

  it('F: a renamed company — the former name counts only when the rename is ESTABLISHED', () => {
    const known = { ...KNOWN, formerNames: [{ name: 'Beta Systems', evidence: 'registry name-change record (fixture)' }] };
    const m = resolveEntity(known, doc({ companyName: 'Beta Systems' }));
    expect(m.identity).toBe('WEAK');
    expect(m.signals!.find((s) => s.signal === 'former_name')!.detail).toMatch(/established: registry name-change record/);
    expect(resolveEntity(KNOWN, doc({ companyName: 'Beta Systems' })).identity).toBe('MISMATCH');   // not established
  });
});

describe('CPG-009 (3) identity evidence read FROM documents', () => {
  const T = { name: CO, canonicalDomain: DOMAIN, registryIds: ['U72200PN2015PTC123456'], linkedinSlugs: ['acme-tech'] };

  it('reads the subject\'s JSON-LD website — and ignores the publisher\'s node', () => {
    const html = `<script type="application/ld+json">[{"@type":"NewsMediaOrganization","name":"News A","url":"https://news-a.example"},
      {"@type":"Organization","name":"Acme Technologies","url":"https://www.acme.example.com/","sameAs":["https://www.linkedin.com/company/acme-tech"]}]</script>`;
    const ev = extractIdentityEvidence(html, T);
    expect(ev.map((e) => [e.kind, e.value])).toEqual([['json_ld_org_url', 'acme.example.com'], ['linkedin_company', 'acme-tech']]);
  });

  it('reads a labelled "Website" field (infobox) — but not a website label pointing elsewhere', () => {
    const infobox = '<tr><th class="infobox-label">Website</th><td><a href="https://www.acme.example.com/">acme.example.com</a></td></tr>';
    expect(extractIdentityEvidence(infobox, T).some((e) => e.kind === 'labelled_website')).toBe(true);
    const nav = '<div>Website <a href="https://news-a.example/about">About News A</a></div><p>Acme Technologies raised money.</p>';
    expect(extractIdentityEvidence(nav, T).some((e) => e.kind === 'labelled_website')).toBe(false);
  });

  it('reads registry ids, LinkedIn company links and links to the domain', () => {
    const html = '<p>CIN: U72200PN2015PTC123456</p><a href="https://linkedin.com/company/acme-tech">LinkedIn</a><a href="https://blog.acme.example.com/post">blog</a>';
    expect(extractIdentityEvidence(html, T).map((e) => e.kind).sort()).toEqual(['domain_link', 'linkedin_company', 'registry_id']);
  });

  it('records brand / ownership relationships, location and rename statements — never collapses them', () => {
    const html = '<p>Acme Technologies is a brand of Zenith Industries Pvt Ltd.</p><p>Acme Technologies is headquartered in Pune, India.</p><p>Acme Technologies (formerly Beta Systems) builds tools.</p>';
    const ev = extractIdentityEvidence(html, T);
    expect(ev.find((e) => e.kind === 'relationship')!.value).toBe('brand_of:Zenith Industries Pvt Ltd');
    expect(ev.find((e) => e.kind === 'location_statement')!.value).toBe('Pune');
    expect(ev.find((e) => e.kind === 'former_name_statement')!.value).toBe('Beta Systems');
  });
});

describe('CPG-009 (4) secondary domains — associated only by explicit first-party evidence', () => {
  const page = (html: string, url = `https://www.${DOMAIN}/`) => [{ url, html }];

  it('an Investor Relations link from the canonical site establishes the IR domain', () => {
    const a = establishDomainAliases(DOMAIN, page('<a href="https://ir.acme-investors.example.net/">Investor Relations</a>'));
    // The EXACT host linked (its subdomains follow) — never widened.
    expect(a).toEqual([expect.objectContaining({ domain: 'ir.acme-investors.example.net', evidence: 'first_party_ir_link' })]);
  });

  it('an IR link on a shared hosting platform is NOT widened to the whole platform', () => {
    const a = establishDomainAliases(DOMAIN, page('<a href="https://acme-ir.azurewebsites.net/">Investors</a>'));
    expect(a.map((x) => x.domain)).toEqual(['acme-ir.azurewebsites.net']);
    const m = resolveEntity({ ...KNOWN, domainAliases: a }, doc({ sourceHost: 'other-company.azurewebsites.net' }));
    expect(m.identity).toBe('WEAK');                        // another tenant of the platform
  });

  it('a sentence ending in an abbreviation ("… Pvt Ltd.") is not dropped (splitter fix)', () => {
    const html = '<p>Acme Technologies is a brand of Zenith Industries Pvt Ltd.</p><p>Other text here, fully terminated.</p>';
    expect(extractIdentityEvidence(html, { name: CO, canonicalDomain: DOMAIN }).some((e) => e.kind === 'relationship')).toBe(true);
    expect(extractFunding('<p>Acme raised $5 million in a seed round from Zenith Ventures Pvt Ltd.</p><p>Unrelated closing words here.</p>', 'Acme').values)
      .toHaveLength(1);
  });

  it('a same-brand-label domain linked from the canonical site (acme.example.com → acme.example.net pattern)', () => {
    const a = establishDomainAliases('cloudflare.com', page('<a href="https://www.cloudflare.net/home">x</a>', 'https://www.cloudflare.com/'));
    expect(a[0]).toMatchObject({ domain: 'cloudflare.net', evidence: 'first_party_same_brand_link' });
  });

  it('the canonical site\'s JSON-LD sameAs, or a redirect from the canonical domain', () => {
    const j = establishDomainAliases(DOMAIN, page('<script type="application/ld+json">{"@type":"Organization","name":"Acme","sameAs":["https://acme-shop.example.org"]}</script>'));
    expect(j[0]).toMatchObject({ domain: 'acme-shop.example.org', evidence: 'first_party_json_ld_sameAs' });
    expect(establishDomainAliases(DOMAIN, [], 'https://acme-global.example.io/home')[0]).toMatchObject({ evidence: 'redirect_from_canonical' });
  });

  it('never: a social/profile link, a partner link, or ANY link from a page not on the canonical domain', () => {
    expect(establishDomainAliases(DOMAIN, page('<a href="https://github.com/acme">GitHub</a><a href="https://partner.example/">Partner</a>'))).toEqual([]);
    expect(establishDomainAliases(DOMAIN, page('<a href="https://ir.other.example/">Investor Relations</a>', 'https://news-a.example/story'))).toEqual([]);
  });
});

// ── the verification gate ────────────────────────────────────────────────────

let seq = 0;
const ev = (value: string, url: string, sig: Partial<EntitySignals> = {}, over: Partial<EvidenceClaim> = {}): EvidenceClaim => ({
  claimId: `id-${++seq}`, field: 'founded_year', value, normalizedValue: value, sourceType: 'editorial',
  sourceName: new URL(url).hostname, sourceUrl: url, sourcePublishedAt: FRESH, sourceAccessedAt: ASOF,
  excerpt: 'FIXTURE', verificationMethod: 'crawl',
  entitySignals: doc({ sourceHost: new URL(url).hostname, ...sig }),
  discovery: { provider: 'keyless_web', query: 'fixture', rank: 1 },
  extraction: { sourceStatement: `FIXTURE: founded in ${value}`, temporalType: 'HISTORICAL', period: null, year: Number(value),
    currency: null, approximation: false, moneyKind: null, method: 'explicit_statement', acceptedBecause: 'fixture', qualifier: null },
  ...over,
});
const decisive = (value: string, url: string) => ev(value, url, { identityEvidence: [site(DOMAIN)] });
const R = (evidence: EvidenceClaim[], user: UserClaim | null = null, field = 'founded_year') =>
  resolve({ companyId: 'c1', field, kind: 'FACT', userClaim: user, evidence, knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF });

describe('CPG-009 (5) PUBLICLY_VERIFIED needs field evidence AND identity — separately', () => {
  it('strong field evidence + WEAK identity → effective but only REPORTED (B-21 prior behaviour is now explicit)', () => {
    const g = R([ev('2015', 'https://a-news.example/1'), ev('2015', 'https://b-news.example/2'), ev('2015', 'https://c-news.example/3')]);
    expect(g.effectiveValue).toBe('2015');
    expect(g.status).toBe('PUBLICLY_REPORTED');
    const c = g.adjudication!.candidates[0];
    expect(c).toMatchObject({ sufficient: true, verified: false, identity: 'WEAK', identityFamilies: [] });
  });

  it('two independent families that DECISIVELY identify the company → VERIFIED', () => {
    const g = R([decisive('2015', 'https://a-news.example/1'), decisive('2015', 'https://b-news.example/2')]);
    expect(g.status).toBe('PUBLICLY_VERIFIED');
    expect(g.adjudication!.verifiedIdentityFamilies).toEqual(['a-news.example', 'b-news.example']);
    expect(g.adjudication!.candidates[0].verifiedBecause).toMatch(/S1: 2 independent families with DECISIVE identity/);
  });

  it('strong identity + INSUFFICIENT field evidence → not verified (not even effective)', () => {
    const g = R([decisive('2015', 'https://a-news.example/1')]);
    expect(g.effectiveValue).toBeNull();
    expect(g.adjudication!.evidenceState).toBe('OBSERVED_ONLY');
    expect(g.adjudication!.candidates[0]).toMatchObject({ identity: 'DECISIVE', verified: false });
  });

  it('value corroboration never manufactures identity: one decisive + one weak family agreeing → REPORTED', () => {
    const g = R([decisive('2015', 'https://a-news.example/1'), ev('2015', 'https://b-news.example/2')]);
    expect(g.effectiveValue).toBe('2015');                           // S1 value corroboration
    expect(g.status).toBe('PUBLICLY_REPORTED');                      // but only one DECISIVE family
    expect(g.adjudication!.candidates[0].identityFamilies).toEqual(['a-news.example']);
  });

  it('two pages of ONE publisher, both decisive, are one identity family', () => {
    const g = R([decisive('2015', 'https://news.indiatimes.com/a'), decisive('2015', 'https://economictimes.indiatimes.com/b')]);
    expect(g.adjudication!.candidates[0].identityFamilies).toEqual(['indiatimes.com']);
    expect(g.status).not.toBe('PUBLICLY_VERIFIED');
  });

  it('a first-party (tier-1) document with decisive identity verifies alone (S2)', () => {
    const g = R([ev('2015', `https://${DOMAIN}/about`, { domain: DOMAIN }, { sourceType: 'company_website', discovery: undefined })]);
    expect(g.status).toBe('PUBLICLY_VERIFIED');
  });

  it('a same-name company\'s claim is REJECTED (mismatch), not a conflict and not corroboration', () => {
    const g = R([decisive('2015', 'https://a-news.example/1'), decisive('2015', 'https://b-news.example/2'),
      ev('1999', 'https://c-news.example/3', { identityEvidence: [jsonld('acme-tech.io')] })]);
    expect(g.status).toBe('PUBLICLY_VERIFIED');
    expect(g.isMaterialConflict).toBe(false);
    expect(g.adjudication!.candidates.map((c) => c.value)).toEqual(['2015']);
    expect(g.evidence.some((e) => e.value === '1999')).toBe(true);    // retained for audit
  });

  it('user value: weak-identity agreement → REPORTED; decisive agreement → VERIFIED', () => {
    const u: UserClaim = { field: 'founded_year', value: '2015', normalizedValue: '2015', assertedAt: '2026-01-01T00:00:00.000Z', assertedBy: 'u1' };
    expect(R([ev('2015', 'https://a-news.example/1'), ev('2015', 'https://b-news.example/2')], u).status).toBe('PUBLICLY_REPORTED');
    expect(R([decisive('2015', 'https://a-news.example/1'), decisive('2015', 'https://b-news.example/2')], u).status).toBe('PUBLICLY_VERIFIED');
  });

  it('leadership-supported identity (SUPPORTING) does not verify', () => {
    const g = R([ev('2015', 'https://a-news.example/1', { leadership: ['Asha Rao'] }), ev('2015', 'https://b-news.example/2', { leadership: ['Asha Rao'] })]);
    expect(g.adjudication!.candidates[0].identity).toBe('SUPPORTING');
    expect(g.status).toBe('PUBLICLY_REPORTED');
  });

  it('neverFor still wins: a decisive first-party revenue claim stays excluded', () => {
    const g = R([ev('INR 5,000,000', `https://${DOMAIN}/about`, { domain: DOMAIN }, { field: 'revenue', normalizedValue: 'INR 5000000', sourceType: 'company_website', discovery: undefined })], null, 'revenue');
    expect(g.effectiveValue).toBeNull();
    expect(g.adjudication!.candidates).toHaveLength(0);
  });

  it('CPG-008 intact: decisive sources that disagree are still a conflict with no winner', () => {
    const g = R([decisive('2015', 'https://a-news.example/1'), decisive('2016', 'https://b-news.example/2')]);
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
  });
});

describe('CPG-009 (6) extraction attribution — related entities stay explicit (§9)', () => {
  it('"ABC, which owns the XYZ brand, reported revenue" is ABC\'s revenue, not XYZ\'s', () => {
    const r = extractRevenue('<p>Zenith Industries, which owns the Acme brand, reported revenue of ₹50 crore in FY2024.</p>', 'Acme');
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/related \(legal\) entity/);
  });

  it('"XYZ, a brand of ABC, reported revenue" — a brand\'s revenue is its legal entity\'s', () => {
    expect(extractRevenue('<p>Acme, a brand of Zenith Industries, reported revenue of ₹50 crore in FY2024.</p>', 'Acme').values).toHaveLength(0);
  });

  it('a subsidiary that itself raised funding IS still the subject', () => {
    expect(extractFunding('<p>Acme, a subsidiary of Zenith Industries, raised $20 million in a Series A round.</p>', 'Acme').values[0])
      .toMatchObject({ value: '20000000', period: 'Series A' });
  });
});

describe('CPG-009 (7) sources no longer use the publisher as the subject', () => {
  const ctx = (fetcher: any, extra: object = {}) => ({ companyId: 'c1', knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, fetcher, ...extra });

  it('user-supplied: no "name" claim from the publisher\'s og:site_name; publisher recorded separately', async () => {
    const html = '<html><head><meta property="og:site_name" content="Inc42"/><meta name="description" content="Acme Technologies builds tools."/></head></html>';
    const out = await ingestUserSuppliedUrls(ctx(async (url: string) => ({ ok: true, status: 200, url, text: html }), { userSuppliedUrls: ['https://inc42.com/acme'] }));
    expect(out[0].claims.map((c) => c.field)).toEqual(['company_description']);
    expect(out[0].claims[0].entitySignals).toMatchObject({ companyName: null, publisher: 'Inc42', sourceHost: 'inc42.com' });
  });

  it('discovered: the extracted claim carries the document\'s identity evidence; the description claim asserts no subject', async () => {
    const page = `<html><head><meta property="og:site_name" content="Wiki"/><meta name="description" content="About Acme."/></head><body>
      <table><tr><th>Website</th><td><a href="https://www.acme.example.com/">acme.example.com</a></td></tr></table>
      <p>Acme Technologies was founded in 2015 by Asha Rao.</p></body></html>`;
    const src = createDiscoveredWebSource({ provider: { id: 'keyless_web', isAvailable: () => true, async search() { return [{ url: 'https://wiki.example/Acme', rank: 1 }]; } }, fields: ['founded_year'] });
    const res = await src.acquire(ctx(async (url: string) => ({ ok: true, status: 200, url, text: page })) as any);
    if (res.state !== 'retrieved') throw new Error('expected claims');
    const fy = res.claims.find((c) => c.field === 'founded_year')!;
    expect(fy.entitySignals.identityEvidence!.some((e) => e.kind === 'labelled_website')).toBe(true);
    expect(fy.entitySignals.publisher).toBe('Wiki');
    expect(resolveEntity(KNOWN, fy.entitySignals).identity).toBe('DECISIVE');
    expect(res.claims.find((c) => c.field === 'founded_year_source_statement')!.entitySignals.companyName).toBeNull();
  });

  it('Wikidata: matched by LABEL, attributed only through its official website — ours → DECISIVE, another → MISMATCH', async () => {
    const look = (w: string[]) => async () => ({ founded_year: '2015', team_size: null, revenue_range: null, matched_label: 'Acme Technologies', qid: 'Q999', official_websites: w });
    const ours = await createWikidataSource(look(['https://www.acme.example.com/']), () => true).acquire(ctx(null) as any);
    const theirs = await createWikidataSource(look(['https://acme-tech.io/']), () => true).acquire(ctx(null) as any);
    if (ours.state !== 'retrieved' || theirs.state !== 'retrieved') throw new Error('expected claims');
    expect(ours.claims[0].sourceUrl).toBe('https://www.wikidata.org/wiki/Q999');       // the matched entity, not a search
    expect(resolveEntity(KNOWN, ours.claims[0].entitySignals).identity).toBe('DECISIVE');
    expect(resolveEntity(KNOWN, theirs.claims[0].entitySignals).identity).toBe('MISMATCH');
    const none = await createWikidataSource(look([]), () => true).acquire(ctx(null) as any);
    if (none.state !== 'retrieved') throw new Error('expected claims');
    expect(resolveEntity(KNOWN, none.claims[0].entitySignals).identity).toBe('WEAK');
  });
});

/** Each case reproduces a structure the CPG-009 live run exposed (2026-09-10). */
describe('CPG-009 (9) live-run defects — pinned', () => {
  const CF: EntitySignals = { companyName: 'Cloudflare', domain: 'cloudflare.com', linkedinUrl: null, location: null, leadership: [], registryId: null };

  it('TRACXN: a publisher\'s JSON-LD url pointing at its OWN profile page is self-reference, not a conflicting website', () => {
    const html = '<script type="application/ld+json">{"@type":"Organization","name":"CloudFlare","url":"https://tracxn.com/d/companies/cloudflare/__IL42"}</script><p>CloudFlare was founded in 2009.</p>';
    const evid = extractIdentityEvidence(html, { name: 'Cloudflare', canonicalDomain: 'cloudflare.com' });
    const m = resolveEntity(CF, { companyName: 'Cloudflare', ...blank, sourceHost: 'tracxn.com', identityEvidence: evid });
    expect(m.identity).toBe('WEAK');                        // was MISMATCH → valid evidence discarded
  });

  it('IR FOOTER: "website" inside a URL ("website-terms/") is not a website statement', () => {
    const html = '<footer><a href="https://www.cloudflare.com/website-terms/">Terms of Use</a> <a href="https://www.cloudflare.com/">Home</a></footer>';
    expect(extractIdentityEvidence(html, { name: 'Cloudflare', canonicalDomain: 'cloudflare.com' }).some((e) => e.kind === 'labelled_website')).toBe(false);
  });

  it('WIKIPEDIA: "website" inside a data-mw JSON attribute is not a website statement', () => {
    const html = `<span data-mw='{"parts":[{"template":{"params":{"website":{"wt":"Bloomberg"}}}}]}'></span> <a href="https://stripe.com/newsroom">Stripe</a>`;
    expect(extractIdentityEvidence(html, { name: 'Stripe', canonicalDomain: 'stripe.com' }).some((e) => e.kind === 'labelled_website')).toBe(false);
  });

  it('STRIPE: the company\'s JSON-LD sameAs Bloomberg / Yahoo Finance PROFILES are not Stripe domains', () => {
    const html = '<script type="application/ld+json">{"@type":"Organization","name":"Stripe","sameAs":["https://www.bloomberg.com/profile/company/0170016D:US","https://finance.yahoo.com/quote/STRI.PVT/","https://stripe.dev/"]}</script>';
    const a = establishDomainAliases('stripe.com', [{ url: 'https://stripe.com/in', html }]);
    expect(a.map((x) => x.domain)).toEqual(['stripe.dev']);  // only the site ROOT counts
  });

  it('INFOSYS: a same-brand-label domain (infosys.org = the Infosys Foundation) is AFFILIATION — supporting, never decisive', () => {
    const a = establishDomainAliases('infosys.com', [{ url: 'https://www.infosys.com/', html: '<a href="https://www.infosys.org/infosys-foundation.html">Foundation</a>' }]);
    expect(a[0]).toMatchObject({ domain: 'infosys.org', evidence: 'first_party_same_brand_link' });
    const m = resolveEntity({ ...CF, companyName: 'Infosys', domain: 'infosys.com', domainAliases: a }, { companyName: 'Infosys', ...blank, sourceHost: 'www.infosys.org' });
    expect(m.identity).toBe('SUPPORTING');
  });

  it('WIKIDATA: its founding year now meets the documents\' founding years (same comparability class)', () => {
    const wd: EvidenceClaim = {
      claimId: 'wd', field: 'founded_year', value: '2009', normalizedValue: '2009', sourceType: 'business_intelligence', sourceName: 'Wikidata',
      sourceUrl: 'https://www.wikidata.org/wiki/Q4778915', sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'provider_api',
      entitySignals: { companyName: 'Cloudflare', ...blank, sourceHost: 'wikidata.org', identityEvidence: [{ kind: 'structured_official_website', value: 'https://www.cloudflare.com/', detail: 'P856' }] },
    };
    const doc9: EvidenceClaim = { ...ev('2009', 'https://en.wikipedia.org/wiki/Cloudflare'), entitySignals: { companyName: 'Cloudflare', ...blank, sourceHost: 'en.wikipedia.org' } };
    const g = resolve({ companyId: 'c1', field: 'founded_year', kind: 'FACT', userClaim: null, evidence: [wd, doc9], knownEntity: CF, companyDomain: 'cloudflare.com', asOf: ASOF });
    expect(g.adjudication!.candidates).toHaveLength(1);       // was two classes: "default" vs "current"
    expect(g.adjudication!.candidates[0].families).toEqual(['wikidata', 'wikipedia.org']);
    expect(g.status).toBe('PUBLICLY_VERIFIED');               // S3: authoritative + decisive (Wikidata P856)
  });
});

describe('CPG-009 (8) persistence explains every attribution', () => {
  it('each claim row keeps ITS OWN identity decision and the document provenance it came from', async () => {
    const store = createInMemoryStore();
    const g = R([decisive('2015', 'https://a-news.example/1'), decisive('2015', 'https://b-news.example/2'), ev('2015', 'https://c-news.example/3')]);
    await persistGrounding(store, { companyId: 'c1', companyDomain: DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    const rows = await store.listClaims('c1');
    const weak = rows.find((r) => r.sourceUrl === 'https://c-news.example/3')!;
    const strong = rows.find((r) => r.sourceUrl === 'https://a-news.example/1')!;
    expect(weak.identity).toMatchObject({ identityClass: 'WEAK', sourceHost: 'c-news.example' });
    expect(weak.entityMatchStatus).toBe('weak');                     // was: the field's best match
    expect(strong.identity!.identityClass).toBe('DECISIVE');
    expect(strong.identity!.evidence[0]).toMatchObject({ kind: 'labelled_website' });
    const f = (await store.getField('c1', 'founded_year'))!;
    expect(f).toMatchObject({ status: 'PUBLICLY_VERIFIED', identityFamilies: 2 });
  });
});
