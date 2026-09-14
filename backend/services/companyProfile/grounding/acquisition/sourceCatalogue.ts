/**
 * CPG-003 / CPG-010 — the source catalogue: WHAT each evidence source is (§2).
 *
 * Split out of sourceRegistry.ts (CPG-016) along the boundary between the
 * catalogue and the rules applied to it: this module holds the descriptor
 * vocabulary and the declared entry for every source (host bindings, tiers,
 * field authority, restrictions); sourceRegistry.ts decides authority for a
 * field, a host or a provider family from these entries. Moved verbatim — no
 * descriptor, tier or authority changed. sourceRegistry.ts re-exports everything
 * here, so every existing import is unchanged.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import type { SourceKind, SourceTier } from '../types';

export type SourceCategory =
  | 'first_party' | 'government_registry' | 'business_intelligence'
  | 'editorial' | 'structured_open' | 'user_reference' | 'aggregator';

/**
 * CPG-010 §3 — WHAT KIND OF SOURCE a document is. This is a description, not a
 * grade: a regulatory filing is not "true", a knowledge graph is not "wrong".
 * Authority stays FIELD-specific (`authoritativeFor` / `weakFor` / `neverFor`).
 *
 *   corporate_registry  a registry's master record of a legal entity (SEC EDGAR
 *                       registrant data, MCA master data) — who the entity IS;
 *   regulatory_filing   a document the entity filed under legal obligation
 *                       (10-K, 20-F) — what the entity REPORTED;
 *   company_owned       published by the company itself (website, IR site);
 *   financial_database  a commercial company/funding database (Tracxn, Crunchbase);
 *   news_media          editorial reporting;
 *   knowledge_graph     a structured open knowledge base (Wikidata);
 *   other               anything else (search results, user references, government
 *                       pages that are neither a registry nor a filing).
 */
export type { SourceKind } from '../types';

/** A host (suffix-matched) and optional path prefix that identify a source's documents. */
export interface HostBinding { host: string; pathPrefix?: string }

export type RetrievalMechanism =
  | 'first_party_crawl' | 'provider_api' | 'user_supplied_url'
  | 'structured_api' | 'none';

export type AvailabilityState =
  | 'callable'                  // usable right now
  | 'implemented_no_credential' // code exists, key absent
  | 'implemented_not_wired'     // callable but not connected to grounding
  | 'abstraction_only'          // a preset/contract, no grounding integration
  | 'unavailable';              // nothing exists

/** How quickly a source's content goes out of date, by field class. */
export type FreshnessProfile = 'volatile' | 'moderate' | 'durable' | 'event_dated';

export interface SourceDescriptor {
  id: string;
  name: string;
  category: SourceCategory;
  /** CPG-010 §3 — what kind of document this source publishes. Not authority. */
  kind: SourceKind;
  tier: SourceTier;
  /**
   * CPG-010 — the hosts whose documents ARE this source. The ONE place a host is
   * bound to a source: `classifySource` reads its tier from here and
   * `registrySourceIdFor` its id, so a host can no longer carry one tier by URL
   * and another by registry (Wikidata was tier 4 by URL, tier 2 here).
   */
  hosts?: readonly HostBinding[];
  /**
   * CPG-010 §10 — for fields whose value comes in distinct MEASURES, the
   * measures this source is authoritative for. A measure not listed is `weak`:
   * a funding database is authoritative for a stated round or a total raised,
   * not for an unqualified "raised $X" mention.
   */
  measureScoped?: Readonly<Record<string, readonly string[]>>;
  /**
   * CPG-011 §7 — the REGISTRY PROVIDER (registry/builtins.ts) whose records
   * this source is. Provider identity, source kind, jurisdiction, tier and
   * field authority are five separate attributes: none implies another.
   */
  registryProviderId?: string;
  /** CPG-011 — jurisdiction the source covers ("US", "FR", "GLOBAL"); absent = not jurisdiction-bound. */
  jurisdiction?: string;
  /** First-party = published by the company itself. */
  firstParty: boolean;
  retrieval: RetrievalMechanism;
  credential: 'none' | 'keyless' | 'environment' | 'super_admin_managed';
  availability: AvailabilityState;
  /** Fields this source is PARTICULARLY authoritative for. */
  authoritativeFor: readonly string[];
  /** Fields it can speak to, but weakly. */
  weakFor: readonly string[];
  /** Fields it must NEVER be treated as evidence for. */
  neverFor: readonly string[];
  freshness: FreshnessProfile;
  /** Entity-resolution signals this source can supply. */
  entitySignals: readonly string[];
  /** Legal or technical restriction that constrains use. */
  restriction: string | null;
  evidence: string;
}

const IDENTITY = ['name', 'legal_name', 'industry', 'headquarters', 'geography'];
const OFFERING = ['products_services', 'company_description'];
const POSITIONING = ['unique_value', 'brand_positioning', 'brand_voice', 'content_themes'];
const AUDIENCE = ['ideal_customer_profile', 'target_audience', 'pain_symptoms'];
const FINANCIAL = ['revenue', 'annual_revenue', 'funding', 'valuation', 'employee_count'];
const PEOPLE = ['ceo', 'founder', 'leadership'];

export const SOURCE_REGISTRY: readonly SourceDescriptor[] = Object.freeze([
  {
    id: 'first_party_website', name: 'Company website', category: 'first_party', kind: 'company_owned', tier: 1,
    firstParty: true, retrieval: 'first_party_crawl', credential: 'keyless', availability: 'callable',
    authoritativeFor: [...IDENTITY, ...OFFERING, ...POSITIONING],
    weakFor: [...AUDIENCE, 'expansion'],
    // A company's own site is marketing, not an audited statement.
    neverFor: ['revenue', 'annual_revenue', 'valuation'],
    freshness: 'moderate',
    entitySignals: ['domain', 'companyName'],
    restriction: null,
    evidence: 'CPG-002 firstPartySource.ts + safeFetch',
  },
  {
    id: 'first_party_leadership', name: 'Company leadership/team page', category: 'first_party', kind: 'company_owned', tier: 1,
    firstParty: true, retrieval: 'first_party_crawl', credential: 'keyless', availability: 'callable',
    authoritativeFor: [...PEOPLE],
    weakFor: ['headquarters'],
    neverFor: [...FINANCIAL],
    // Leadership pages are the first thing to go stale after a departure.
    freshness: 'volatile',
    entitySignals: ['domain', 'leadership'],
    restriction: null,
    evidence: 'CPG-003 firstPartySource leadership extraction',
  },
  {
    id: 'first_party_newsroom', name: 'Company newsroom / press release', category: 'first_party', kind: 'company_owned', tier: 1,
    firstParty: true, retrieval: 'first_party_crawl', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['funding', 'expansion', 'growth_signal', ...PEOPLE],
    weakFor: [...OFFERING],
    neverFor: ['annual_revenue'],
    // A press release describes an EVENT on a date; it does not decay, it dates.
    freshness: 'event_dated',
    entitySignals: ['domain'],
    restriction: null,
    evidence: 'CPG-002 firstPartySource /press /news paths',
  },
  {
    // CPG-010 §9 — an investor-relations site on a DECISIVELY established
    // secondary domain (cloudflare.net). Company-owned, so the SAME provider
    // family as the website — IR + website are one voice, not corroboration.
    // Distinguished from marketing: it publishes the company's reported results,
    // so revenue is `weak` here (a company statement, not a filing) where the
    // marketing site is `never`.
    id: 'first_party_ir', name: 'Company investor-relations site', category: 'first_party', kind: 'company_owned', tier: 1,
    firstParty: true, retrieval: 'first_party_crawl', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['name', 'legal_name', 'registry_id', 'stock_ticker'],
    weakFor: ['revenue', 'annual_revenue', 'headquarters', ...PEOPLE],
    neverFor: [...POSITIONING, ...AUDIENCE, 'valuation'],
    freshness: 'event_dated',
    entitySignals: ['domain', 'registryId'],
    restriction: 'Only a host whose association is DECISIVE (IR link, JSON-LD site root, redirect, official filing). A same-brand-label domain is affiliation, not ownership.',
    evidence: 'CPG-009 domainIdentity.establishDomainAliases; CPG-010 orchestrator identity pre-step',
  },
  {
    // ⚠️ CPG-010 §9 — ONE representation. The host binding makes the URL
    // classification and this descriptor the same thing (it was tier 4 by URL).
    // `legal_name` is WEAK: Wikidata's label is community-edited and names the
    // brand as often as the legal entity; its QID is a knowledge-graph id, not a
    // registry id, so it can never be decisive for LEGAL identity.
    id: 'wikidata', name: 'Wikidata', category: 'structured_open', kind: 'knowledge_graph', tier: 2,
    hosts: [{ host: 'wikidata.org' }],
    firstParty: false, retrieval: 'structured_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['founded_year', 'name'],
    weakFor: ['legal_name', 'employee_count', 'revenue_range', 'industry', 'headquarters'],
    neverFor: [...POSITIONING, ...AUDIENCE, 'revenue', 'annual_revenue', 'registry_id'],
    freshness: 'durable',
    entitySignals: ['companyName', 'officialWebsite'],
    restriction: null,
    // ⚠️ CPG-002 CORRECTION — see note in capabilityMatrix.
    evidence: 'intelligence/adapters/wikidataAdapter.ts (real HTTP, keyless, WIKIDATA_ENABLED defaults ON)',
  },
  {
    // CPG-010 §4 — the SEC's master record of a REGISTRANT (data.sec.gov
    // submissions JSON): who the legal entity is. It states identity; it does
    // not state revenue, so it is `never` for revenue — a registry match is not
    // a financial fact.
    id: 'sec_edgar_registrant', name: 'SEC EDGAR registrant record', category: 'government_registry', kind: 'corporate_registry', tier: 1,
    registryProviderId: 'sec_edgar', jurisdiction: 'US',
    hosts: [{ host: 'data.sec.gov' }, { host: 'sec.gov', pathPrefix: '/cgi-bin/browse-edgar' }],
    firstParty: false, retrieval: 'structured_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['legal_name', 'registry_id', 'headquarters', 'stock_ticker', 'incorporation_jurisdiction'],
    weakFor: ['industry'],
    neverFor: [...POSITIONING, ...AUDIENCE, ...OFFERING, 'revenue', 'annual_revenue', 'funding', 'valuation', 'employee_count'],
    freshness: 'durable',
    entitySignals: ['registryId', 'legalName', 'formerNames'],
    restriction: 'Keyless, subject to SEC fair-access (declared User-Agent, ≤10 req/s). The registrant is reached ONLY through a CIK the company itself states (EDGAR link) or a first-party ticker statement mapped via SEC company_tickers.json — never by name search.',
    evidence: 'CPG-011 registry/providers/secEdgarProvider.ts via acquisition/registryRecordSource.ts; live 200 from data.sec.gov/submissions',
  },
  {
    // CPG-010 §4 — a document the registrant FILED (10-K, 20-F) under legal
    // obligation: what the entity reported. Authoritative for reported revenue.
    id: 'sec_edgar_filing', name: 'SEC EDGAR filing', category: 'government_registry', kind: 'regulatory_filing', tier: 1,
    registryProviderId: 'sec_edgar', jurisdiction: 'US',
    hosts: [{ host: 'sec.gov', pathPrefix: '/Archives/' }],
    firstParty: false, retrieval: 'structured_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['revenue', 'annual_revenue', 'legal_name', 'headquarters', 'employee_count'],
    weakFor: [...OFFERING, ...PEOPLE],
    neverFor: [...POSITIONING, ...AUDIENCE],
    freshness: 'event_dated',
    entitySignals: ['registryId', 'legalName', 'officialWebsite'],
    restriction: 'Fetched only by accession path from the registrant record. Financial VALUES are not extracted from filings (no XBRL reader) — the filing is used for the website association only.',
    evidence: 'CPG-011 secEdgarProvider.verifyDomainAssociation (annual-report website statement)',
  },
  {
    // CPG-010 §5 — India's Ministry of Corporate Affairs master data.
    // Programmatic GET returns HTTP 403 (live-probed); the portal gates master
    // data behind CAPTCHA. NOT bypassed, NOT emulated. The contract (CIN
    // normalisation/validation) exists; no adapter does.
    id: 'mca_registry', name: 'MCA (India) company master data', category: 'government_registry', kind: 'corporate_registry', tier: 1,
    registryProviderId: 'mca', jurisdiction: 'IN',
    hosts: [{ host: 'mca.gov.in' }],
    firstParty: false, retrieval: 'none', credential: 'none', availability: 'unavailable',
    // ⚠️ CPG-012 FIX — founded_year was authoritative here while every other
    // registry marks it weak: a registry states the INCORPORATION date, which is
    // not the founding year of a company that incorporated later (or re-formed).
    authoritativeFor: ['legal_name', 'registry_id', 'headquarters', 'incorporation_jurisdiction'],
    weakFor: ['founded_year'],
    neverFor: [...POSITIONING, ...AUDIENCE, ...OFFERING, 'revenue', 'annual_revenue', 'funding', 'valuation'],
    freshness: 'durable',
    entitySignals: ['registryId', 'legalName'],
    restriction: 'www.mca.gov.in answers HTTP 403 to programmatic GET; master data is CAPTCHA-gated. No bypass. A CIN the company states on its own site is recorded as first-party (registryVerified=false).',
    evidence: 'CPG-010 live probe 2026-09-10: 403 on /content/mca/global/en/home.html and /mca/master-data/MDS.html',
  },
  {
    // CPG-010 §9 — a commercial financial database. Authoritative for funding
    // ONLY in the measures it structures (§10); identity fields are weak (its
    // pages name brands, not verified legal entities); never revenue.
    id: 'tracxn', name: 'Tracxn', category: 'business_intelligence', kind: 'financial_database', tier: 2,
    hosts: [{ host: 'tracxn.com' }],
    firstParty: false, retrieval: 'none', credential: 'none', availability: 'abstraction_only',
    authoritativeFor: ['funding'],
    measureScoped: { funding: ['total raised', 'largest round', 'latest round', 'round'] },
    weakFor: ['founded_year', 'employee_count', 'headquarters', 'name', 'industry', 'valuation', ...PEOPLE],
    neverFor: ['revenue', 'annual_revenue', 'legal_name', 'registry_id', ...POSITIONING, ...AUDIENCE],
    freshness: 'moderate',
    entitySignals: ['companyName', 'officialWebsite'],
    restriction: 'No Tracxn API. Its public company pages arrive only through keyless public-web discovery (CPG-006).',
    evidence: 'CPG-010: previously only a tier-2 host row in sourceAuthority; discovered pages were general_web_search',
  },
  {
    // CPG-011 §11 — France's company register (Sirene / RNE) through the
    // State's open-data API. Registry master data: WHO the entity is.
    id: 'fr_sirene', name: 'Sirene / RNE (France)', category: 'government_registry', kind: 'corporate_registry', tier: 1,
    registryProviderId: 'fr_sirene', jurisdiction: 'FR',
    hosts: [{ host: 'recherche-entreprises.api.gouv.fr' }, { host: 'annuaire-entreprises.data.gouv.fr' }],
    firstParty: false, retrieval: 'structured_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['legal_name', 'registry_id', 'headquarters', 'incorporation_jurisdiction'],
    weakFor: ['industry', 'founded_year'],
    // The API returns a `finances` block; it is NOT consumed — master data is not a financial statement here.
    neverFor: [...POSITIONING, ...AUDIENCE, ...OFFERING, 'revenue', 'annual_revenue', 'funding', 'valuation', 'employee_count'],
    freshness: 'durable',
    entitySignals: ['registryId', 'legalName'],
    restriction: 'Queried only by SIREN; a result is accepted only when its siren equals the SIREN asked for. Never by name.',
    evidence: 'CPG-011 registry/providers/frSireneProvider.ts; live 200 from recherche-entreprises.api.gouv.fr',
  },
  {
    // CPG-012 — Brazil's CNPJ register, read through a keyless open-source
    // MIRROR (BrasilAPI) of the Receita Federal's open data. A mirror is not
    // the registry: tier 2, and only the identifier itself is authoritative.
    id: 'br_receita', name: 'CNPJ register (Brazil) via BrasilAPI mirror', category: 'government_registry', kind: 'corporate_registry', tier: 2,
    registryProviderId: 'br_receita', jurisdiction: 'BR',
    hosts: [{ host: 'brasilapi.com.br', pathPrefix: '/api/cnpj/' }],
    firstParty: false, retrieval: 'structured_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['registry_id'],
    weakFor: ['legal_name', 'headquarters', 'incorporation_jurisdiction', 'founded_year', 'industry'],
    neverFor: [...POSITIONING, ...AUDIENCE, ...OFFERING, 'revenue', 'annual_revenue', 'funding', 'valuation', 'employee_count'],
    freshness: 'moderate',
    entitySignals: ['registryId', 'legalName'],
    restriction: 'Queried only by CNPJ (checksum-validated); a record is accepted only when its cnpj equals the CNPJ asked for. Mirror, not the registry.',
    evidence: 'CPG-012 registry/providers/brCnpjProvider.ts; live 200 from brasilapi.com.br',
  },
  {
    // CPG-011 §17 — GLEIF: a GLOBAL legal-entity registry. Its records state
    // explicit national-registry cross-references and reported parents.
    // Tier 2: entity data is self-reported, validated by LEI issuers.
    id: 'gleif', name: 'GLEIF Global LEI Index', category: 'government_registry', kind: 'corporate_registry', tier: 2,
    registryProviderId: 'gleif', jurisdiction: 'GLOBAL',
    hosts: [{ host: 'api.gleif.org' }, { host: 'search.gleif.org' }],
    firstParty: false, retrieval: 'structured_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: ['registry_id', 'legal_name'],
    weakFor: ['headquarters', 'incorporation_jurisdiction'],
    neverFor: [...POSITIONING, ...AUDIENCE, ...OFFERING, 'revenue', 'annual_revenue', 'funding', 'valuation', 'employee_count'],
    freshness: 'durable',
    entitySignals: ['registryId', 'legalName', 'crossReference', 'parent'],
    restriction: 'Queried only by LEI, or by registeredAs = a national registry number; exactly one match or none.',
    evidence: 'CPG-011 registry/providers/gleifProvider.ts; live 200 from api.gleif.org',
  },
  {
    id: 'user_supplied_url', name: 'User-supplied source reference', category: 'user_reference', kind: 'other', tier: 4,
    firstParty: false, retrieval: 'user_supplied_url', credential: 'keyless', availability: 'callable',
    // Tier is assigned by the HOST at classification time, not by being supplied.
    authoritativeFor: [], weakFor: [...IDENTITY, ...OFFERING, ...FINANCIAL, ...PEOPLE],
    neverFor: [],
    freshness: 'moderate',
    entitySignals: ['companyName'],
    restriction: 'LinkedIn/Facebook/Instagram hosts are referenced but never fetched.',
    evidence: 'CPG-002 userSuppliedSource.ts',
  },
  {
    // ⚠️ CPG-010 — the generic registry placeholder (Companies House and other
    // jurisdictions). It used to be authoritative for REVENUE: that is true of
    // a regulatory FILING and false of a registry's master record, which states
    // who an entity is, not what it earned. Registry master data and filings are
    // now separate descriptors (sec_edgar_registrant / sec_edgar_filing).
    id: 'corporate_registry', name: 'Corporate registry (other jurisdictions)', category: 'government_registry', kind: 'corporate_registry', tier: 1,
    hosts: [{ host: 'companieshouse.gov.uk' }, { host: 'find-and-update.company-information.service.gov.uk' }],
    firstParty: false, retrieval: 'none', credential: 'none', availability: 'unavailable',
    authoritativeFor: ['legal_name', 'registry_id', 'headquarters', 'incorporation_jurisdiction'],
    weakFor: [...PEOPLE],
    // CPG-012 DEFECT FIX: was 'unrated' for funding / valuation (every named registry is 'never') —
    // a registry page could have counted towards corroborating a funding amount.
    neverFor: [...POSITIONING, ...AUDIENCE, 'revenue', 'annual_revenue', 'funding', 'valuation'],
    freshness: 'durable',
    entitySignals: ['registryId', 'legalName'],
    restriction: 'No record is read for other jurisdictions: CPG-012 represents GB/DE/JP/SG/ZA/US-DE as providers (identity via first-party statement and GLEIF cross-reference) but their registries are credential-gated or inaccessible.',
    evidence: 're-audited CPG-012',
  },
  {
    id: 'linkedin', name: 'LinkedIn', category: 'business_intelligence', kind: 'other', tier: 2,
    firstParty: false, retrieval: 'none', credential: 'none', availability: 'unavailable',
    authoritativeFor: [...PEOPLE, 'employee_count'], weakFor: [...IDENTITY],
    neverFor: ['revenue', 'annual_revenue'],
    freshness: 'volatile',
    entitySignals: ['linkedinUrl', 'leadership'],
    restriction: 'No approved retrieval mechanism. Scraping around access controls is prohibited.',
    evidence: 're-audited CPG-003: no LinkedIn ingestion anywhere',
  },
  {
    // ⚠️ CPG-010 — availability was stale: CPG-006 built keyless public-web
    // discovery (createKeylessWebProvider → discoveredSource), and it is the
    // route every third-party document in the live runs arrived by.
    id: 'general_web_search', name: 'General public web search', category: 'editorial', kind: 'news_media', tier: 3,
    firstParty: false, retrieval: 'provider_api', credential: 'keyless', availability: 'callable',
    authoritativeFor: [], weakFor: [...FINANCIAL, 'expansion', 'growth_signal'], neverFor: [],
    freshness: 'moderate',
    entitySignals: ['companyName'],
    restriction: 'Keyless HTML search endpoint; throttles after ~24 queries. Search rank is recorded, never used as evidence strength.',
    evidence: 'CPG-006 discovery/keylessWebProvider + acquisition/discoveredSource.ts',
  },
  ...(['clearbit', 'apollo', 'peopledatalabs', 'crunchbase', 'hunter', 'builtwith'] as const).map((id) => ({
    id, name: id, category: 'business_intelligence' as const,
    kind: (id === 'crunchbase' ? 'financial_database' : 'other') as SourceKind, tier: 2 as SourceTier,
    firstParty: false, retrieval: 'provider_api' as const, credential: 'environment' as const,
    availability: 'implemented_no_credential' as AvailabilityState,
    authoritativeFor: id === 'crunchbase' ? ['funding', 'valuation'] : ['employee_count', 'industry'],
    // CPG-010 §10 — the same measure discipline as Tracxn.
    ...(id === 'crunchbase' ? { measureScoped: { funding: ['total raised', 'largest round', 'latest round', 'round'] } } : {}),
    weakFor: [...IDENTITY], neverFor: [...POSITIONING, ...AUDIENCE],
    freshness: 'moderate' as FreshnessProfile,
    entitySignals: ['domain', 'companyName'],
    restriction: 'Returns unavailable("no_credential") and makes NO network call without its key.',
    evidence: 'companyIntelligence/providers/adapters',
  })),
]);
