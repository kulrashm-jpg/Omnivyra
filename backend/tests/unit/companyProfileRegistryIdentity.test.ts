/**
 * CPG-010 — authoritative registry identity & source authority (B-18, B-14).
 *
 * SYNTHETIC ADVERSARIAL FIXTURES. No network, no database, no LLM. Every
 * registry record, filing and page below is hand-built test data, never
 * presented as retrieved evidence; the live run is reported separately.
 *
 * Under test:
 *   · a registry identifier decides identity (match → DECISIVE, different id in
 *     the same scheme → MISMATCH), a name never does and never overrides one;
 *   · a registry identity is reached only from the company's own statements and
 *     attached only when the registrant side points back (no name lookup);
 *   · source KIND is not authority; authority is per field and per measure;
 *   · identity and field sufficiency are two separate gates for VERIFIED.
 */

import { resolveEntity, normalizeName } from '../../services/companyProfile/grounding/entityResolution';
import { resolve } from '../../services/companyProfile/grounding/claimResolution';
import {
  compareRegistryIds, legalNamesEquivalent, normalizeLegalName, normalizeRegistryId, registryIdPattern,
} from '../../services/companyProfile/grounding/registryIdentity';
// CPG-011: the SEC-/CIN-specific statement extractor became the country-neutral
// reference extractor, and SEC establishment runs through the ONE generic path.
import { extractReferences, establishRegistryIdentities } from '../../services/companyProfile/grounding/registry/establishment';
import { CIN_SCHEME } from '../../services/companyProfile/grounding/registry/providers/mcaProvider';
import { secEdgarProvider } from '../../services/companyProfile/grounding/registry/providers/secEdgarProvider';
import { extractIdentityEvidence } from '../../services/companyProfile/grounding/extraction/identityEvidence';
import {
  findWebsiteStatements, parseSubmissions, parseTickerTable, registrantHeadquarters,
  submissionsUrl, SEC_TICKER_TABLE_URL,
} from '../../services/companyProfile/grounding/acquisition/secEdgar';
import { createRegistryRecordSource as createSecEdgarSource, recordClaims } from '../../services/companyProfile/grounding/acquisition/registryRecordSource';
import type { RegistryRecord } from '../../services/companyProfile/grounding/registry/providerContract';
import { establishIdentity } from '../../services/companyProfile/grounding/acquisition/identityEstablishment';
import { orchestrateGrounding } from '../../services/companyProfile/grounding/acquisition/orchestrator';
import { createWikidataSource } from '../../services/companyProfile/grounding/acquisition/wikidataSource';
import {
  authorityForField, describeSource, hostBoundSource, providerFamily, registrySourceIdFor, SOURCE_REGISTRY,
} from '../../services/companyProfile/grounding/acquisition/sourceRegistry';
import { classifySource } from '../../services/companyProfile/grounding/sourceAuthority';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';
import type { EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type {
  DomainAlias, EntitySignals, EvidenceClaim, ExtractionProvenance, RegistryIdentity,
} from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const FRESH = '2026-08-20T00:00:00.000Z';
const CO = 'Acme Technologies';
const DOMAIN = 'acme.example.com';
const IR_HOST = 'acme-ir.example.net';
const CIK = 'CIK:0001234567';
const OTHER_CIK = 'CIK:0007654321';
const CIN = 'CIN:U72200KA2015PTC123456';

const blank = { domain: null, linkedinUrl: null, location: null, leadership: [] as string[], registryId: null };
const doc = (o: Partial<EntitySignals> = {}): EntitySignals => ({ companyName: CO, ...blank, ...o });

const secIdentity = (id = CIK, legalName = 'Acme Technologies, Inc.'): RegistryIdentity => ({
  scheme: 'CIK', registryId: id, provider: 'sec_edgar', legalName, jurisdiction: 'US-DE', status: null,
  establishedBy: 'listing_mapping', registryVerified: true,
  chain: [{ step: 'registry_record', sourceUrl: submissionsUrl(id.slice(4)), detail: 'fixture' }],
  domainAssociations: [{ legalEntity: legalName, registryId: id, domain: DOMAIN, associationReason: 'official_filing_statement', associationSource: 'fixture', detail: 'fixture' }],
});
const IR_ALIAS: DomainAlias = { domain: IR_HOST, evidence: 'first_party_ir_link', sourceUrl: `https://${DOMAIN}/`, detail: 'links "Investor Relations"' };
const KNOWN: EntitySignals = { companyName: CO, domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null };
const KNOWN_REG: EntitySignals = { ...KNOWN, registryIdentities: [secIdentity()], domainAliases: [IR_ALIAS] };

let n = 0;
const claim = (field: string, value: string, url: string, o: Partial<EvidenceClaim> = {}, sig: Partial<EntitySignals> = {}): EvidenceClaim => ({
  claimId: `c${++n}`, field, value, normalizedValue: value.toLowerCase(),
  sourceType: 'editorial', sourceName: new URL(url).hostname, sourceUrl: url,
  sourcePublishedAt: FRESH, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'crawl',
  entitySignals: doc({ sourceHost: new URL(url).hostname, ...sig }),
  ...o,
});
const extraction = (o: Partial<ExtractionProvenance> = {}): ExtractionProvenance => ({
  sourceStatement: 'fixture statement', temporalType: 'CURRENT', period: null, year: null, currency: 'USD',
  approximation: false, moneyKind: 'funding', method: 'explicit_statement', acceptedBecause: 'fixture', qualifier: null, ...o,
});
const run = (field: string, evidence: EvidenceClaim[], known: EntitySignals = KNOWN_REG) => resolve({
  companyId: 'co-1', field, kind: 'FACT', userClaim: null, evidence, knownEntity: known, companyDomain: DOMAIN, asOf: ASOF,
});

/** FIXTURE fetcher — hand-written test data; records every URL requested. */
function fixtureFetcher(pages: Record<string, string>, log: string[] = []): EvidenceFetcher {
  return async (url, opts) => {
    log.push(url);
    const host = new URL(url).hostname;
    if (opts.allowedHosts && !opts.allowedHosts.includes(host)) throw new Error(`host ${host} not pinned`);
    const body = pages[url];
    return body === undefined ? { ok: false, status: 404, url, text: '' } : { ok: true, status: 200, url, text: body };
  };
}
const submissions = (cik10: string, name: string, o: Record<string, unknown> = {}) => JSON.stringify({
  cik: String(Number(cik10)), name, tickers: ['ACME'], exchanges: ['NYSE'], ein: '123456789', stateOfIncorporation: 'DE',
  website: '', formerNames: [{ name: 'ACME TECH CORP', from: '2010-01-01T00:00:00.000Z', to: '2015-06-30T00:00:00.000Z' }],
  addresses: { business: { street1: '1 Main St', city: 'SAN FRANCISCO', stateOrCountry: 'CA', stateOrCountryDescription: 'CA' } },
  filings: { recent: {
    form: ['8-K', '10-K', '10-Q', '10-K'],
    accessionNumber: ['0001-26-000009', '0001-26-000001', '0001-25-000020', '0001-25-000002'],
    filingDate: ['2026-05-01', '2026-02-20', '2025-11-01', '2025-02-21'],
    reportDate: ['', '2025-12-31', '2025-09-30', '2024-12-31'],
    primaryDocument: ['a.htm', 'acme-20251231.htm', 'q.htm', 'acme-20241231.htm'],
  } },
  ...o,
});
const filingUrl = (cik10: string, doc10k = 'acme-20251231.htm', acc = '000126000001') => `https://www.sec.gov/Archives/edgar/data/${Number(cik10)}/${acc}/${doc10k}`;
const TICKERS = JSON.stringify({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1234567, 'Acme Technologies, Inc.', 'ACME', 'NYSE'], [7654321, 'Acme Holdings Ltd', 'ACMH', 'Nasdaq']] });

// ── registry model units ─────────────────────────────────────────────────────

describe('CPG-010 registry identifier model', () => {
  it('normalises only FORM — prefix, padding, case — and invents nothing', () => {
    expect(normalizeRegistryId('1477333', 'CIK')!.registryId).toBe('CIK:0001477333');
    expect(normalizeRegistryId('cik: 0001477333')!.registryId).toBe('CIK:0001477333');
    expect(normalizeRegistryId('u72200ka2015ptc123456')!.registryId).toBe('CIN:U72200KA2015PTC123456');
    expect(normalizeRegistryId('EIN 27-0805829')!.registryId).toBe('EIN:270805829');
    expect(normalizeRegistryId('AAB-1234')!.registryId).toBe('LLPIN:AAB-1234');
    // A bare number is not self-evidently a CIK; the scheme must be known.
    expect(normalizeRegistryId('1477333')!.scheme).toBe('RAW');
    expect(normalizeRegistryId('0', 'CIK')).toBeNull();
    expect(normalizeRegistryId('12345678901', 'CIK')).toBeNull();
  });

  it('validates CIN structure (year) and refuses malformed ones', () => {
    // CPG-011: CIN validation now lives in the MCA provider's scheme definition.
    expect(CIN_SCHEME.normalize('L85110KA1981PLC013115')).toBe('L85110KA1981PLC013115');
    expect(CIN_SCHEME.normalize('L85110KA1781PLC013115')).toBeNull();
    expect(CIN_SCHEME.normalize('L85110KA1981PL013115')).toBeNull();
  });

  it('compares scheme by scheme: different schemes neither match nor conflict', () => {
    expect(compareRegistryIds([CIK], ['CIK:1234567'])).toEqual({ matches: [CIK], conflicts: [] });
    expect(compareRegistryIds([CIK], [OTHER_CIK]).conflicts).toHaveLength(1);
    expect(compareRegistryIds([CIK], [CIN])).toEqual({ matches: [], conflicts: [] });
  });

  it('a CIK counts inside a document only in an explicit CIK / EDGAR context', () => {
    const re = registryIdPattern(CIK)!;
    expect(re.test('Call 1234567 today')).toBe(false);
    expect(re.test('CIK: 0001234567')).toBe(true);
    expect(re.test('https://www.sec.gov/Archives/edgar/data/1234567/0001/x.htm')).toBe(true);
    const ev = extractIdentityEvidence('<p>Tel 1234567</p><p>SEC CIK 1234567</p>', { name: CO, canonicalDomain: DOMAIN, registryIds: [CIK] });
    expect(ev.filter((e) => e.kind === 'registry_id').map((e) => e.value)).toEqual([CIK]);
  });
});

// ── §17 adversarial fixtures ─────────────────────────────────────────────────

describe('CPG-010 §17 (1-3) registry identity decides; names do not', () => {
  it('(1) exact registry match → DECISIVE (form-normalised)', () => {
    const m = resolveEntity(KNOWN_REG, doc({ registryId: 'CIK:1234567' }));
    expect(m.identity).toBe('DECISIVE');
    expect(m.reason).toMatch(/CIK:0001234567/);
  });

  it('(2) conflicting registry id → MISMATCH, even with the same name and domain link', () => {
    const m = resolveEntity(KNOWN_REG, doc({ registryId: OTHER_CIK, identityEvidence: [{ kind: 'domain_link', value: DOMAIN, detail: 'link' }] }));
    expect(m.identity).toBe('MISMATCH');
    expect(m.reason).toMatch(/different legal entity/);
  });

  it('(3) the SAME legal name with a different id → MISMATCH: a name never overrides a registry id', () => {
    const m = resolveEntity(KNOWN_REG, doc({ registryId: OTHER_CIK, legalEntity: 'Acme Technologies, Inc.', companyName: 'Acme Technologies, Inc.' }));
    expect(m.identity).toBe('MISMATCH');
    // …and a name alone, with no id, is only WEAK.
    expect(resolveEntity(KNOWN_REG, doc({ legalEntity: 'Acme Technologies, Inc.' })).identity).toBe('WEAK');
  });
});

describe('CPG-010 §17 (4-5) legal-name normalisation strips legal FORMS only', () => {
  it('(4) suffix variants of one name are equivalent', () => {
    for (const v of ['Acme Technologies Private Limited', 'ACME TECHNOLOGIES PVT. LTD.', 'Acme Technologies Ltd', 'Acme Technologies, Inc.', 'Acme Technologies LLC', 'Acme Technologies GmbH', 'Acme Technologies LLP', 'Acme Technologies Corporation']) {
      expect(normalizeLegalName(v)).toBe('acme technologies');
    }
    expect(normalizeName('Cloudflare, Inc.')).toBe('cloudflare');
    // Only a TRAILING run is stripped: these words are part of the name here.
    expect(normalizeLegalName('Acme Private Equity Ltd')).toBe('acme private equity');
    expect(normalizeLegalName('Acme Co-operative Society Limited')).toBe('acme co operative society');
    expect(normalizeLegalName('Limited')).toBe('limited');
  });

  it('(5) Holdings / Technologies / Motors / Consulting / Foundation / Services are never stripped', () => {
    const words = ['Holdings', 'Technologies', 'Motors', 'Consulting', 'Foundation', 'Services'];
    for (const a of words) for (const b of words) {
      if (a !== b) expect(legalNamesEquivalent(`Acme ${a} Ltd`, `Acme ${b} Limited`)).toBe(false);
    }
    expect(legalNamesEquivalent('Acme Holdings Ltd', 'ACME HOLDINGS LIMITED')).toBe(true);
    const m = resolveEntity(KNOWN, doc({ companyName: 'Acme Holdings Limited' }));
    expect(m.identity).not.toBe('DECISIVE');
  });
});

describe('CPG-010 §17 (6,12) parent vs subsidiary stay distinct', () => {
  it('(6) an IR page linking the PARENT\'s EDGAR filings does not attach the parent\'s CIK', async () => {
    const parent = '0007654321';
    const log: string[] = [];
    const fetcher = fixtureFetcher({
      [submissionsUrl(parent)]: submissions(parent, 'Acme Holdings Ltd', { tickers: ['ACMH'], exchanges: ['Nasdaq'] }),
      [filingUrl(parent)]: '<p>Our website is located at https://www.acmeholdings.example.org. Nothing else.</p>',
    }, log);
    const pages = [{ url: `https://${DOMAIN}/investors`, html: `<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${parent}">Parent filings</a>` }];
    const r = await establishRegistryIdentities({ pages, canonicalDomain: DOMAIN, ownedHosts: [DOMAIN], companyNames: [CO], jurisdictions: [], knownIdentifiers: [], fetcher, retrievedAt: ASOF });
    expect(r.identities).toEqual([]);
    expect(r.candidates[0]).toMatchObject({ registryId: 'CIK:0007654321', outcome: 'unconfirmed' });
    expect(r.candidates[0].detail).toMatch(/could be a parent, a subsidiary or a partner/);
  });

  it('(12) the SEC record of a subsidiary registrant (different CIK, similar name) is MISMATCH; the registrant\'s own is DECISIVE', async () => {
    const f = fixtureFetcher({
      [submissionsUrl('0007654321')]: submissions('0007654321', 'Acme Technologies Subsidiary Inc'),
      [submissionsUrl('0001234567')]: submissions('0001234567', 'Acme Technologies, Inc.'),
    });
    const pctx = { fetcher: f, retrievedAt: ASOF, canonicalDomain: DOMAIN, ownedHosts: [DOMAIN] };
    const sub = await secEdgarProvider.resolveFromExplicitIdentifier('CIK:0007654321', pctx) as RegistryRecord;
    const own = await secEdgarProvider.resolveFromExplicitIdentifier('CIK:0001234567', pctx) as RegistryRecord;
    const subClaims = recordClaims(sub, secIdentity(), 'SEC EDGAR', ASOF);
    const ownClaims = recordClaims(own, secIdentity(), 'SEC EDGAR', ASOF);
    expect(resolveEntity(KNOWN_REG, subClaims[0].entitySignals).identity).toBe('MISMATCH');
    expect(resolveEntity(KNOWN_REG, ownClaims[0].entitySignals).identity).toBe('DECISIVE');
  });
});

describe('CPG-010 §17 (7) foundation vs operating company', () => {
  it('a same-brand domain (the Foundation) is affiliation, never company-owned', () => {
    const foundation: DomainAlias = { domain: 'acme.example.org', evidence: 'first_party_same_brand_link', sourceUrl: `https://${DOMAIN}/`, detail: 'same label' };
    const known = { ...KNOWN, domainAliases: [foundation] };
    expect(registrySourceIdFor('acme.example.org', 'acme.example.org', DOMAIN, true, { domainAliases: known.domainAliases })).toBe('general_web_search');
    expect(classifySource('https://acme.example.org/about', 'editorial', DOMAIN, known.domainAliases).tier).toBe(4);
    const m = resolveEntity(known, doc({ sourceHost: 'acme.example.org', companyName: 'Acme Foundation', legalEntity: 'Acme Foundation' }));
    expect(m.identity).not.toBe('DECISIVE');
    expect(legalNamesEquivalent('Acme Foundation', CO)).toBe(false);
  });
});

describe('CPG-010 §17 (8-9, §13) identity and field sufficiency are separate gates', () => {
  it('(8) registry-decisive identity + a WEAK revenue source → not verified (not even effective)', () => {
    // The IR site: tier 1, DECISIVE identity (established IR alias) — and WEAK for revenue.
    const g = run('revenue', [claim('revenue', 'USD 1,000,000,000 (FY2025)', `https://${IR_HOST}/results`, { extraction: extraction({ moneyKind: 'revenue', year: 2025 }) })]);
    expect(g.sourceAttribution![g.evidence[0].claimId]).toMatchObject({ sourceId: 'first_party_ir', tier: 1, authority: 'weak', family: 'company_owned' });
    expect(g.entityMatches![g.evidence[0].claimId].identity).toBe('DECISIVE');
    expect(g.status).not.toBe('PUBLICLY_VERIFIED');
    expect(g.effectiveValue).toBeNull();
    // A registry MASTER RECORD is never evidence of revenue at all.
    const r = run('revenue', [claim('revenue', 'USD 1,000,000,000', 'https://data.sec.gov/submissions/CIK0001234567.json', {}, { registryId: CIK })]);
    expect(r.sourceAttribution![r.evidence[0].claimId].authority).toBe('never');
    expect(r.status).toBe('UNVERIFIED');
  });

  it('(8b) LIVE-FOUND: a document\'s description of a field (<field>_source_statement) is never effective, even from a tier-1 DECISIVE host', () => {
    const e = claim('revenue_source_statement', 'Fourth quarter revenue totaled $614.5 million …', `https://${IR_HOST}/news/q4`);
    const g = run('revenue_source_statement', [e]);
    expect(g.sourceAttribution![e.claimId]).toMatchObject({ sourceId: 'first_party_ir', tier: 1 });
    expect(g.entityMatches![e.claimId].identity).toBe('DECISIVE');
    expect(g.status).toBe('PUBLICLY_REPORTED');
    expect(g.effectiveValue).toBeNull();
    expect(g.adjudication!.reason).toMatch(/pointer to evidence, never a value/);
  });

  it('(9) strong field evidence (a filing) + name-only identity → REPORTED, never VERIFIED', () => {
    const e = claim('revenue', 'USD 1,000,000,000 (FY2025)', 'https://www.sec.gov/Archives/edgar/data/1234567/000126000001/acme-20251231.htm', { extraction: extraction({ moneyKind: 'revenue', year: 2025 }) });
    const g = run('revenue', [e], KNOWN); // no registry identity established
    expect(g.sourceAttribution![e.claimId]).toMatchObject({ sourceId: 'sec_edgar_filing', sourceKind: 'regulatory_filing', authority: 'authoritative' });
    expect(g.entityMatches![e.claimId].identity).toBe('WEAK');
    expect(g.status).toBe('PUBLICLY_REPORTED');
    // The same filing with its CIK decisive → VERIFIED.
    const v = run('revenue', [{ ...e, claimId: 'cv', entitySignals: { ...e.entitySignals, registryId: CIK } }]);
    expect(v.status).toBe('PUBLICLY_VERIFIED');
  });
});

describe('CPG-010 §17 (10-11) Wikidata: one representation, per-field authority', () => {
  const lookup = (websites: string[]) => async () => ({ founded_year: '2015', team_size: null, revenue_range: null, matched_label: CO, qid: 'Q42424242', official_websites: websites });

  it('(10) QID + official website = ours → DECISIVE; one tier (2) whether reached by URL or registry', async () => {
    const r = await createWikidataSource(lookup([`https://www.${DOMAIN}/`]), () => true).acquire({ companyId: 'co-1', knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, fetcher: fixtureFetcher({}) });
    if (r.state !== 'retrieved') throw new Error('expected claims');
    const fy = r.claims.find((c) => c.field === 'founded_year')!;
    expect(fy.sourceUrl).toBe('https://www.wikidata.org/wiki/Q42424242');
    const cls = classifySource(fy.sourceUrl, fy.sourceType, DOMAIN);
    expect(cls).toMatchObject({ tier: 2, sourceKind: 'knowledge_graph' });
    expect(describeSource('wikidata')!.tier).toBe(cls.tier);
    const g = run('founded_year', [fy], KNOWN);
    expect(g.entityMatches![fy.claimId].identity).toBe('DECISIVE');
    expect(g.status).toBe('PUBLICLY_VERIFIED'); // authoritative for founded_year + decisive
    // Per field: legal identity is only supporting; never revenue; never a registry id.
    expect(authorityForField('wikidata', 'legal_name')).toBe('weak');
    expect(authorityForField('wikidata', 'registry_id')).toBe('never');
    expect(authorityForField('wikidata', 'revenue')).toBe('never');
  });

  it('(11) an ambiguous name match: no website → WEAK; another website → MISMATCH', async () => {
    const ctx = { companyId: 'co-1', knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, fetcher: fixtureFetcher({}) };
    for (const [sites, want] of [[[], 'WEAK'], [['https://acme-mining.example.org/'], 'MISMATCH']] as const) {
      const r = await createWikidataSource(lookup([...sites]), () => true).acquire(ctx);
      if (r.state !== 'retrieved') throw new Error('expected claims');
      expect(resolveEntity(KNOWN, r.claims[0].entitySignals).identity).toBe(want);
    }
  });
});

describe('CPG-010 §17 (13) MCA: legal entity vs brand', () => {
  const known: EntitySignals = { ...KNOWN, registryIdentities: [{
    scheme: 'CIN', registryId: CIN, provider: 'mca', legalName: null, establishedBy: 'first_party_statement', registryVerified: false,
    chain: [], domainAssociations: [],
  }] };
  it('the same CIN → DECISIVE even though the legal name differs from the brand; a different CIN → MISMATCH', () => {
    const same = resolveEntity(known, doc({ companyName: 'Acme Technologies Private Limited', legalEntity: 'Acme Technologies Private Limited', identityEvidence: [{ kind: 'registry_id', value: 'U72200KA2015PTC123456', detail: 'CIN' }] }));
    expect(same.identity).toBe('DECISIVE');
    const brand = resolveEntity(known, doc({ companyName: 'Acme', legalEntity: 'Acme Software Services Private Limited', registryId: CIN }));
    expect(brand.identity).toBe('DECISIVE');
    expect(brand.signals!.find((s) => s.signal === 'legal_name')!.outcome).toBe('note');
    expect(resolveEntity(known, doc({ registryId: 'CIN:U72200KA2016PTC999999' })).identity).toBe('MISMATCH');
  });

  it('a labelled CIN on first-party pages is found; two different CINs are ambiguous and attach nothing', async () => {
    const st = extractReferences([{ url: `https://${DOMAIN}/`, html: '<footer>CIN: <b>U72200KA2015PTC123456</b></footer>' }]);
    expect(st).toEqual([expect.objectContaining({ kind: 'identifier_statement', scheme: 'CIN', value: CIN, providerId: 'mca' })]);
    const two = `<footer>CIN: U72200KA2015PTC123456 | Group company CIN: U72200KA2016PTC999999</footer>`;
    const rep = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: two }) });
    expect(rep.registry!.ambiguity.join(' ')).toMatch(/2 different CIN identifiers as site_publisher/);
    expect(rep.registryIdentities).toEqual([]);
    const one = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: '<footer>CIN: U72200KA2015PTC123456</footer>' }) });
    // CPG-011: a CIN on the company's own page names the SITE PUBLISHER; MCA cannot
    // be read, so nothing shows it is the company → site_publisher, unverified.
    expect(one.registryIdentities[0]).toMatchObject({ registryId: CIN, provider: 'mca', registryVerified: false, establishedBy: 'first_party_statement', role: 'site_publisher' });
  });

  it('MCA is represented, unavailable, and never promoted', () => {
    const m = describeSource('mca_registry')!;
    expect(m).toMatchObject({ kind: 'corporate_registry', availability: 'unavailable', retrieval: 'none' });
    expect(m.restriction).toMatch(/403/);
    expect(hostBoundSource('www.mca.gov.in')!.id).toBe('mca_registry');
  });
});

describe('CPG-010 §17 (14-15, §10) Tracxn: authoritative for funding measures only', () => {
  const T = (field: string, value: string, x?: Partial<ExtractionProvenance>) =>
    claim(field, value, 'https://tracxn.com/d/companies/acme/__abc', { discovery: { provider: 'fixture', query: 'q', rank: 1 }, extraction: x ? extraction(x) : undefined },
      { identityEvidence: [{ kind: 'labelled_website', value: DOMAIN, detail: `Website ${DOMAIN}` }] });

  it('(14) a total-raised claim is authoritative, its own family, and verifies with decisive identity', () => {
    const e = T('funding', 'USD 332,000,000', { qualifier: 'total raised' });
    const g = run('funding', [e], KNOWN);
    expect(g.sourceAttribution![e.claimId]).toMatchObject({ sourceId: 'tracxn', sourceKind: 'financial_database', family: 'tracxn', authority: 'authoritative', measure: 'total raised' });
    expect(g.status).toBe('PUBLICLY_VERIFIED');
  });

  it('(15) non-funding claims and unqualified funding mentions are not promoted', () => {
    expect(authorityForField('tracxn', 'revenue')).toBe('never');
    expect(authorityForField('tracxn', 'legal_name')).toBe('never');
    expect(authorityForField('tracxn', 'founded_year')).toBe('weak');
    expect(authorityForField('tracxn', 'funding', 'event')).toBe('weak');
    expect(authorityForField('tracxn', 'funding', null)).toBe('weak');
    const rev = run('revenue', [T('revenue', 'USD 50,000,000', { moneyKind: 'revenue', year: 2025 })], KNOWN);
    expect(rev.status).toBe('UNVERIFIED'); // excluded: never for revenue
    const ev = T('funding', 'USD 10,000,000', { qualifier: null, period: null });
    const g = run('funding', [ev], KNOWN);
    expect(g.sourceAttribution![ev.claimId].authority).toBe('weak');
    expect(g.status).not.toBe('PUBLICLY_VERIFIED');
  });
});

// ── §11 orchestration: company → first party → IR alias → SEC → DECISIVE ─────

const HOME = `<html><body><a href="https://${IR_HOST}/">Investor Relations</a>
  <a href="https://github.com/acme">GitHub</a><a href="https://partner.example.org/">Our partner</a></body></html>`;
const IR_HOME = `<html><body><h1>Acme Technologies (NYSE: ACME)</h1><p>Acme partners with Globex (NASDAQ: GLBX).</p></body></html>`;
function secFixtures(o: { website?: string; filing?: string } = {}) {
  return {
    [`https://${DOMAIN}/`]: HOME,
    [`https://${IR_HOST}/`]: IR_HOME,
    [SEC_TICKER_TABLE_URL]: TICKERS,
    [submissionsUrl('0001234567')]: submissions('0001234567', 'Acme Technologies, Inc.', { website: o.website ?? '' }),
    [filingUrl('0001234567')]: o.filing ?? '<p>Additional Information. Our website is located at https://www.acme.example.com, and our investor relations website is located at https://acme-ir.example.net. Information on our website is not part of this report.</p>',
  };
}

describe('CPG-010 §17 (16-18) the identity pre-step (B-14 wiring)', () => {
  it('(16) IR alias via first-party evidence → ticker → SEC registrant confirmed by its own filing → DECISIVE', async () => {
    const log: string[] = [];
    const r = await orchestrateGrounding({
      companyId: 'co-1', knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [], fieldsOfInterest: [],
      sources: [createSecEdgarSource()], fetcher: fixtureFetcher(secFixtures(), log), asOf: ASOF,
    });
    expect(r.identity!.aliases.find((a) => a.domain === IR_HOST)).toMatchObject({ evidence: 'first_party_ir_link' });
    const id = r.knownEntity.registryIdentities![0];
    expect(id).toMatchObject({ registryId: CIK, provider: 'sec_edgar', legalName: 'Acme Technologies, Inc.', establishedBy: 'listing_mapping', registryVerified: true, role: 'subject', jurisdiction: 'US-DE' });
    expect(id.domainAssociations[0]).toMatchObject({ domain: DOMAIN, associationReason: 'official_filing_statement' });
    expect(id.chain.map((c) => c.step)).toEqual(['listing_mapping', 'registry_record', 'official_filing_statement']);
    // The partner's ticker on the same page was mapped nowhere (not in the table) and attached nothing.
    expect(r.identity!.registry!.candidates.filter((c) => c.providerId === 'sec_edgar').map((c) => c.registryId)).toEqual([CIK]);
    // Registry claims are DECISIVE by CIK, and legal_name verifies on registry authority.
    const legal = r.fields.find((f) => f.field === 'legal_name')!;
    expect(legal.status).toBe('PUBLICLY_VERIFIED');
    expect(legal.effectiveValue).toBe('Acme Technologies, Inc.');
    expect(Object.values(legal.entityMatches!)[0].identity).toBe('DECISIVE');
    expect(r.fields.find((f) => f.field === 'headquarters')!.effectiveValue).toBe('San Francisco, California');
    // An IR-hosted claim now attributes to the company-owned IR source.
    const ir = run('name', [claim('name', CO, `https://${IR_HOST}/about`)], r.knownEntity);
    expect(ir.sourceAttribution![ir.evidence[0].claimId]).toMatchObject({ sourceId: 'first_party_ir', family: 'company_owned', tier: 1 });
    expect(ir.sourceAttribution![ir.evidence[0].claimId].domainAssociation).toMatchObject({ domain: IR_HOST, reason: 'first_party_ir_link' });
    // Never a name search: every SEC URL requested is a ticker table, a CIK record or an accession path.
    for (const u of log.filter((x) => x.includes('sec.gov'))) expect(u).toMatch(/company_tickers_exchange\.json$|\/submissions\/CIK\d{10}\.json$|\/Archives\/edgar\/data\/\d+\/\d+\//);
  });

  it('(16b) the same ticker path WITHOUT the filing pointing back attaches nothing', async () => {
    const r = await orchestrateGrounding({
      companyId: 'co-1', knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [], fieldsOfInterest: [],
      sources: [createSecEdgarSource()], asOf: ASOF,
      fetcher: fixtureFetcher(secFixtures({ filing: '<p>Our website is located at https://www.someone-else.example.org.</p>' })),
    });
    expect(r.knownEntity.registryIdentities ?? []).toEqual([]);
    expect(r.identity!.registry!.candidates.find((c) => c.providerId === 'sec_edgar')!.outcome).toBe('unconfirmed');
    expect(r.sourceOutcomes.find((o) => o.sourceId === 'registry_records')!.reason).toBe('no_coverage');
  });

  it('(17) an arbitrary outbound domain is neither an alias nor ever fetched', async () => {
    const log: string[] = [];
    const rep = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, fetcher: fixtureFetcher(secFixtures(), log) });
    expect(rep.aliases.map((a) => a.domain)).not.toContain('partner.example.org');
    expect(rep.aliases.map((a) => a.domain)).not.toContain('github.com');
    expect(log.some((u) => /partner\.example\.org|github\.com/.test(u))).toBe(false);
    expect(registrySourceIdFor('partner.example.org', 'partner.example.org', DOMAIN, true, { domainAliases: rep.aliases })).toBe('general_web_search');
  });

  it('(17b) LIVE-FOUND: a depository / exchange / quote page linked as "investor" material is never an IR alias', async () => {
    // zerodha.com's investor charter links https://investor.nsdl.com/… with the URL as anchor text.
    const home = '<a href="https://investor.nsdl.com/portal/en/home">https://investor.nsdl.com/portal/en/home</a>'
      + '<a href="https://www.nseindia.com/invest">Investor awareness</a>'
      + '<a href="https://www.nasdaq.com/market-activity/stocks/acme">Investors</a>'
      + '<a href="https://scores.sebi.gov.in/">Investor grievances</a>';
    const rep = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: home }) });
    expect(rep.aliases).toEqual([]);
  });

  it('(18) an IR site on a shared hosting platform: the exact host only, never the platform', async () => {
    const home = '<a href="https://acme.azurewebsites.net/">Investors</a>';
    const rep = await establishIdentity({ canonicalDomain: DOMAIN, retrievedAt: ASOF, fetcher: fixtureFetcher({ [`https://${DOMAIN}/`]: home }) });
    expect(rep.aliases.map((a) => a.domain)).toEqual(['acme.azurewebsites.net']);
    expect(registrySourceIdFor('acme.azurewebsites.net', 'x', DOMAIN, true, { domainAliases: rep.aliases })).toBe('first_party_ir');
    expect(registrySourceIdFor('evil.azurewebsites.net', 'x', DOMAIN, true, { domainAliases: rep.aliases })).toBe('general_web_search');
    expect(classifySource('https://evil.azurewebsites.net/x', 'editorial', DOMAIN, rep.aliases).tier).toBe(4);
  });
});

describe('CPG-010 §17 (19-20) independence and order', () => {
  it('(19) provider families: IR + website are ONE family; SEC record + SEC filing are ONE family; Tracxn and Wikidata are independent', () => {
    expect(providerFamily('first_party_ir', IR_HOST)).toBe(providerFamily('first_party_website', DOMAIN));
    expect(providerFamily('sec_edgar_registrant', 'data.sec.gov')).toBe(providerFamily('sec_edgar_filing', 'sec.gov'));
    expect(providerFamily('tracxn', 'tracxn.com')).not.toBe(providerFamily('wikidata', 'wikidata.org'));
    // Website + IR agreeing on a weak field is one family — not S1 corroboration.
    const g = run('target_audience', [
      claim('target_audience', 'Developers', `https://${DOMAIN}/about`, {}, { domain: DOMAIN }),
      claim('target_audience', 'Developers', `https://${IR_HOST}/about`),
    ]);
    expect(g.adjudication!.candidates[0].families).toEqual(['company_owned']);
    expect(g.status).not.toBe('PUBLICLY_VERIFIED');
  });

  it('(20) evidence order never changes the decision', () => {
    const ev = [
      claim('funding', 'USD 332,000,000', 'https://tracxn.com/d/companies/acme/__abc', { extraction: extraction({ qualifier: 'total raised' }) }, { identityEvidence: [{ kind: 'labelled_website', value: DOMAIN, detail: 'w' }] }),
      claim('funding', 'USD 300,000,000', 'https://news.example.org/acme', { extraction: extraction({ qualifier: 'total raised' }) }),
      claim('funding', 'USD 332,000,000', 'https://www.sec.gov/Archives/edgar/data/1234567/000126000001/acme-20251231.htm', { extraction: extraction({ qualifier: 'total raised' }) }, { registryId: CIK }),
    ];
    const a = run('funding', ev);
    const b = run('funding', [...ev].reverse());
    expect({ s: b.status, v: b.effectiveValue, o: b.adjudication!.outcome, c: b.adjudication!.candidates })
      .toEqual({ s: a.status, v: a.effectiveValue, o: a.adjudication!.outcome, c: a.adjudication!.candidates });
  });
});

// ── SEC parsing units ────────────────────────────────────────────────────────

describe('CPG-010 SEC parsing', () => {
  it('picks the latest annual report by filing DATE, not array position; amendments and quarterlies are ignored', () => {
    const r = parseSubmissions(JSON.parse(submissions('0001234567', 'Acme Technologies, Inc.')), submissionsUrl('0001234567'))!;
    expect(r.latestAnnual).toMatchObject({ form: '10-K', filingDate: '2026-02-20', url: filingUrl('0001234567') });
    expect(r.formerNames[0]).toEqual({ name: 'ACME TECH CORP', from: '2010-01-01', to: '2015-06-30' });
    expect(registrantHeadquarters(r)).toBe('San Francisco, California');
  });

  it('LIVE-FOUND: a foreign registrant\'s country comes from `country` (Infosys: stateOrCountry null)', () => {
    const r = parseSubmissions(JSON.parse(submissions('0001067491', 'Infosys Ltd', {
      addresses: { business: { city: 'BANGALORE', stateOrCountry: null, stateOrCountryDescription: null, country: 'India', countryCode: 'K7' } },
    })), submissionsUrl('0001067491'))!;
    expect(registrantHeadquarters(r)).toBe('Bangalore, India');
  });

  it('reads only first-person website statements, never the SEC\'s own', () => {
    const s = findWebsiteStatements('<p>The SEC maintains an internet site at www.sec.gov. Our website address is www.acme.example.com. Visit globex.example.org for fun.</p>');
    expect(s.map((x) => x.host)).toEqual(['acme.example.com']);
  });

  it('maps a ticker only with an agreeing exchange; two CIKs confirmed is ambiguity, never a pick', async () => {
    const table = parseTickerTable(JSON.parse(TICKERS));
    expect(table.get('ACME')![0]).toMatchObject({ cik10: '0001234567', exchange: 'NYSE' });
    const pages = [{ url: `https://${DOMAIN}/ir`, html:
      `<p>(NYSE: ACME)</p><a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0007654321">x</a>` }];
    const base = { canonicalDomain: DOMAIN, ownedHosts: [DOMAIN], companyNames: [CO], jurisdictions: [], knownIdentifiers: [], retrievedAt: ASOF };
    const both = fixtureFetcher({
      [SEC_TICKER_TABLE_URL]: TICKERS,
      [submissionsUrl('0001234567')]: submissions('0001234567', 'Acme Technologies, Inc.', { website: `https://www.${DOMAIN}` }),
      [submissionsUrl('0007654321')]: submissions('0007654321', 'Acme Holdings Ltd', { website: `https://${DOMAIN}`, tickers: ['ACMH'] }),
    });
    const r = await establishRegistryIdentities({ ...base, pages, fetcher: both });
    expect(r.identities.filter((i) => i.scheme === 'CIK')).toEqual([]);
    expect(r.ambiguity.join(' ')).toMatch(/2 different CIK identifiers as subject/);
    // A ticker stated on an exchange the table disagrees with maps to nothing.
    const r2 = await establishRegistryIdentities({ ...base, pages: [{ url: `https://${DOMAIN}/ir`, html: '<p>NASDAQ: ACME</p>' }], fetcher: both });
    expect(r2.candidates).toEqual([]);
  });

  it('Indian exchange tickers are not SEC listings and are not extracted', () => {
    expect(extractReferences([{ url: `https://${DOMAIN}/`, html: '<p>NSE: INFY | BSE: 500209 | NYSE: INFY</p>' }])
      .filter((s) => s.kind === 'listing_statement').map((s) => `${s.exchange}:${s.value}`)).toEqual(['NYSE:INFY']);
  });
});

// ── §3 / §9 source model ─────────────────────────────────────────────────────

describe('CPG-010 §3/§9 source kind is not authority', () => {
  it('every descriptor declares a kind; registry and filing are separate descriptors with different field authority', () => {
    for (const s of SOURCE_REGISTRY) expect(s.kind).toBeTruthy();
    expect(authorityForField('sec_edgar_registrant', 'legal_name')).toBe('authoritative');
    expect(authorityForField('sec_edgar_registrant', 'revenue')).toBe('never');
    expect(authorityForField('sec_edgar_filing', 'revenue')).toBe('authoritative');
    expect(authorityForField('corporate_registry', 'revenue')).toBe('never');
    expect(authorityForField('first_party_ir', 'revenue')).toBe('weak');
    expect(authorityForField('first_party_website', 'revenue')).toBe('never');
  });

  it('host binding: data.sec.gov is the registrant record, /Archives/ is a filing, other government pages are unrecognised (not tier 1)', () => {
    expect(classifySource('https://data.sec.gov/submissions/CIK0001234567.json', 'editorial', DOMAIN)).toMatchObject({ tier: 1, sourceKind: 'corporate_registry' });
    expect(classifySource('https://www.sec.gov/Archives/edgar/data/1/2/x.htm', 'editorial', DOMAIN)).toMatchObject({ tier: 1, sourceKind: 'regulatory_filing' });
    // CPG-011: no country's government hosts carry a tier of their own — every unbound
    // government page (US, IN, UK, FR alike) is simply unrecognised (tier 4).
    for (const u of ['https://www.sec.gov/news/press-release/2026-1', 'https://tourism.example.gov.in/acme', 'https://www.example.gov.uk/x', 'https://www.example.gouv.fr/x']) {
      expect(classifySource(u, 'editorial', DOMAIN)).toMatchObject({ tier: 4, sourceKind: 'other' });
    }
    expect(classifySource('https://tracxn.com/d/companies/acme', 'editorial', DOMAIN)).toMatchObject({ tier: 2, sourceKind: 'financial_database' });
  });
});

// ── §15 persistence of the registry identity ─────────────────────────────────

describe('CPG-010 §15 persistence', () => {
  it('stores the declared registry identity, its association chain, source kind and domain association', async () => {
    const r = await orchestrateGrounding({
      companyId: 'co-1', knownEntity: KNOWN, companyDomain: DOMAIN, userClaims: [], fieldsOfInterest: [],
      sources: [createSecEdgarSource()], fetcher: fixtureFetcher(secFixtures()), asOf: ASOF,
    });
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'co-1', companyDomain: DOMAIN, fields: r.fields, sourceOutcomes: r.sourceOutcomes, actor: 'test', asOf: ASOF });
    const c = (await store.listClaims('co-1', 'legal_name'))[0];
    expect(c).toMatchObject({ sourceRegistryId: 'sec_edgar_registrant', sourceKind: 'corporate_registry', sourceTier: 1, providerFamily: 'sec_edgar', fieldAuthority: 'authoritative' });
    expect(c.registry).toMatchObject({ provider: 'sec_edgar', registryId: CIK, legalEntity: 'Acme Technologies, Inc.' });
    expect(c.registry!.association).toMatchObject({ establishedBy: 'listing_mapping', registryVerified: true });
    expect(c.registry).toMatchObject({ scheme: 'CIK', jurisdiction: 'US-DE', role: 'subject' });
    expect(c.domainAssociation).toMatchObject({ domain: DOMAIN, reason: 'official_filing_statement' });
    expect(c.identity!.identityClass).toBe('DECISIVE');
    // Idempotent: a second persist re-observes, never duplicates.
    await persistGrounding(store, { companyId: 'co-1', companyDomain: DOMAIN, fields: r.fields, sourceOutcomes: r.sourceOutcomes, actor: 'test', asOf: ASOF });
    expect((await store.listClaims('co-1', 'legal_name'))).toHaveLength(1);
  });
});
