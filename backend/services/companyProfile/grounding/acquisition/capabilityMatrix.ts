/**
 * CPG-002 — the honest evidence-acquisition capability matrix (§2, §3).
 *
 * ⚠️ THIS FILE EXISTS TO PREVENT ONE SPECIFIC LIE: that Omnivyra can retrieve
 * evidence it cannot actually retrieve. Every row is a repository fact, and
 * every claim of availability is resolvable to code.
 *
 * A repository can contain a perfectly good adapter for a provider nobody has
 * bought. `implemented` and `callable` are therefore SEPARATE columns, and only
 * `callable` licenses a claim of verification.
 *
 * CREDENTIAL SAFETY (§16): availability is resolved through
 * `describeProviderCredential`, which returns a shape-only diagnostic. No
 * secret is read, printed, logged or returned by anything in this module.
 */

export type ProviderState =
  | 'production_enabled'   // callable AND wired into a live path
  | 'callable'             // implemented + credential present, but not wired here
  | 'implemented_no_credential'
  | 'implemented_not_wired'
  | 'abstraction_only'     // a preset/contract exists, no company-grounding integration
  | 'unavailable';         // no integration at all

export interface CapabilityRow {
  id: string;
  label: string;
  tierIfUsed: 1 | 2 | 3 | 4;
  implemented: boolean;
  credentialModel: 'keyless' | 'super_admin_managed' | 'environment' | 'none';
  callableForGrounding: boolean;
  tested: boolean;
  productionEnabledForGrounding: boolean;
  state: ProviderState;
  evidence: string;
  note: string;
}

/**
 * The matrix. `productionEnabledForGrounding` is FALSE for every row: CPG-002
 * wires nothing into a production path (§18). That column exists so it cannot be
 * quietly assumed true later.
 */
export const CAPABILITY_MATRIX: readonly CapabilityRow[] = Object.freeze([
  {
    id: 'first_party_website', label: 'Company website (first-party)', tierIfUsed: 1,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'lib/security/safeFetch.ts + companyProfile/websiteMetadataExtractor.ts',
    note: 'THE ONLY routinely-available Tier-1 evidence source. Retrieval is host-pinned through safeFetch.',
  },
  {
    id: 'user_supplied_url', label: 'User-supplied source reference', tierIfUsed: 4,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'CPG-002 userSuppliedSource.ts (tier assigned by sourceAuthority at classification time)',
    note: 'The user names the document; Omnivyra retrieves and classifies it. Tier is whatever the host earns, not Tier 1 by virtue of being supplied.',
  },
  {
    id: 'wikidata', label: 'Wikidata', tierIfUsed: 2,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: "intelligence/adapters/wikidataAdapter.ts (real HTTP against wikidata.org, ssrf-ok annotated) via getKnowledgeGraphProvider(); providerCredentialResolver.PROVIDER_CREDENTIALS.wikidata (mode 'KEYLESS')",
    note:
      'CORRECTION TO CPG-002: this row previously read implemented_not_wired / callableForGrounding:false. ' +
      'The CPG-003 re-audit found a REAL keyless HTTP adapter that is default-ON (WIKIDATA_ENABLED !== "false") ' +
      'and already has a live production consumer in canonicalReportBuilder. It was callable all along. ' +
      'CPG-003 wires it to grounding via wikidataSource.ts, reusing the adapter rather than duplicating it. ' +
      'Contributes identity + founded_year + employee_count + revenue_range only — never revenue, never positioning.',
  },
  {
    id: 'serpapi_news', label: 'SerpAPI (Google News / Trends engines)', tierIfUsed: 3,
    implemented: true, credentialModel: 'super_admin_managed', callableForGrounding: false, tested: false,
    productionEnabledForGrounding: false, state: 'abstraction_only',
    evidence: "externalApiPresets.ts ('SerpAPI Google News', 'SerpAPI Google Trends'); providerCredentialResolver.serpapi",
    note: 'CORRECTION TO CPG-001: a SerpAPI abstraction DOES exist. But the presets use the google_news / google_trends engines and are wired to the external-APIs trends surface — they are NOT general web search and are not connected to company grounding.',
  },
  {
    id: 'gdelt', label: 'GDELT Events', tierIfUsed: 4,
    implemented: true, credentialModel: 'keyless', callableForGrounding: false, tested: false,
    productionEnabledForGrounding: false, state: 'abstraction_only',
    evidence: "externalApiPresets.ts ('GDELT Events', no api_key_env_name)",
    note: 'Keyless news-event API. Event-level, not company-fact-level; useful for expansion/growth signals rather than identity or financials.',
  },
  {
    id: 'newsapi', label: 'NewsAPI', tierIfUsed: 3,
    implemented: true, credentialModel: 'environment', callableForGrounding: false, tested: false,
    productionEnabledForGrounding: false, state: 'abstraction_only',
    evidence: "externalApiPresets.ts (NEWS_API_KEY)",
    note: 'Trends surface only; no company-grounding integration.',
  },
  // ── vendor adapters: implemented, credential-gated, not wired to grounding ──
  ...(['clearbit', 'apollo', 'peopledatalabs', 'crunchbase', 'hunter', 'builtwith'] as const).map((id) => ({
    id, label: `${id} (enrichment vendor)`, tierIfUsed: 2 as const,
    implemented: true, credentialModel: 'environment' as const,
    callableForGrounding: false, tested: false, productionEnabledForGrounding: false,
    state: 'implemented_no_credential' as ProviderState,
    evidence: 'companyIntelligence/providers/adapters/index.ts + vendorAdapter.ts',
    note: 'Adapter exists and is safeFetch-pinned. Returns unavailable("no_credential") and performs NO network call without its key. Whether a key is set is an environment fact this repository cannot assert. Not wired to company-profile grounding.',
  })),
  // ── CPG-010 ──
  {
    // ⚠️ CPG-010 CORRECTION — this row read 'unavailable / THE PRINCIPAL GAP'
    // after CPG-006 had built keyless discovery.
    id: 'general_web_search', label: 'General public web search (keyless discovery)', tierIfUsed: 3,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'CPG-006 discovery/keylessWebProvider.ts + acquisition/discoveredSource.ts',
    note: 'Keyless HTML search; throttles after ~24 queries. Search rank is recorded, never used as evidence strength. Each publisher is its own provider family.',
  },
  {
    id: 'sec_edgar', label: 'SEC EDGAR (registrant record + filings)', tierIfUsed: 1,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'CPG-011 registry/providers/secEdgarProvider.ts behind the provider contract (data.sec.gov submissions JSON, www.sec.gov/Archives filings, company_tickers_exchange.json)',
    note: 'One provider of the country-neutral registry framework (jurisdiction US, scheme CIK). Identity only: legal name, CIK, headquarters. Reached ONLY through a CIK the company itself states or a first-party listing statement; never by name. Financial values are NOT extracted from filings.',
  },
  {
    id: 'fr_sirene', label: 'Sirene / RNE (France) via API Recherche d\'entreprises', tierIfUsed: 1,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'CPG-011 registry/providers/frSireneProvider.ts (recherche-entreprises.api.gouv.fr, open data, identifier-only)',
    note: 'Jurisdiction FR, scheme SIREN (Luhn-checked). Reached only through a SIREN the company\'s own legal notice states. The register lists no websites: a stated SIREN identifies the SITE PUBLISHER, which is the company only when the register names it.',
  },
  {
    id: 'gleif', label: 'GLEIF Global LEI Index', tierIfUsed: 2,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'CPG-011 registry/providers/gleifProvider.ts (api.gleif.org, CC0, identifier-only)',
    note: 'Jurisdiction GLOBAL, scheme LEI (ISO 7064 checksum). Explicit cross-references to national registries (registeredAs) and reported parents. Never queried by name.',
  },
  // ── CPG-012 — representative providers behind the same contract ──
  {
    id: 'br_receita', label: 'CNPJ register (Brazil) via BrasilAPI mirror', tierIfUsed: 2,
    implemented: true, credentialModel: 'keyless', callableForGrounding: true, tested: true,
    productionEnabledForGrounding: false, state: 'callable',
    evidence: 'CPG-012 registry/providers/brCnpjProvider.ts (brasilapi.com.br, open-source mirror of Receita Federal open data)',
    note: 'LIVE-BUT-LIMITED: a mirror, not the registry (the Receita lookup is CAPTCHA-gated). Scheme CNPJ (two mod-11 check digits; 8-digit root = legal entity). Tier 2.',
  },
  ...([
    ['gb_companies_house', 'Companies House (United Kingdom)', 'implemented_no_credential', 'environment', 'REST API answers HTTP 401 without an API key (live-probed); no key is read or used.'],
    ['jp_nta', 'National Tax Agency corporate number (Japan)', 'implemented_no_credential', 'environment', 'Web-API requires an application ID; none is read or used.'],
    ['de_handelsregister', 'Handelsregister (Germany)', 'unavailable', 'none', 'www.handelsregister.de refused TCP connections from this environment (live-probed); session/form portal.'],
    ['sg_acra', 'ACRA (Singapore)', 'unavailable', 'none', 'data.gov.sg datastore: HTTP 403 + CAPTCHA (live-probed); BizFile+ is paid.'],
    ['za_cipc', 'CIPC (South Africa)', 'unavailable', 'none', 'eservices.cipc.co.za: CAPTCHA + login (live-probed).'],
    ['us_de_corporations', 'Delaware Division of Corporations (US-DE)', 'unavailable', 'none', 'icis.corp.delaware.gov entity search: CAPTCHA (live-probed).'],
  ] as const).map(([id, label, state, cred, why]) => ({
    id, label, tierIfUsed: 1 as const,
    implemented: true, credentialModel: cred as 'environment' | 'none', callableForGrounding: false, tested: true,
    productionEnabledForGrounding: false, state: state as ProviderState,
    evidence: `CPG-012 registry/providers (scheme, first-party statements, GLEIF cross-reference) — registry itself not queried`,
    note: `${why} Identity still flows through the company's own statement and GLEIF's explicit registration-authority cross-reference.`,
  })),
  // ── genuinely absent ──
  {
    id: 'linkedin', label: 'LinkedIn company data', tierIfUsed: 2,
    implemented: false, credentialModel: 'none', callableForGrounding: false, tested: false,
    productionEnabledForGrounding: false, state: 'unavailable',
    evidence: 'no LinkedIn ingestion exists anywhere in the repository',
    note: 'NOT retrievable. LinkedIn is tiered in sourceAuthority for when a reference arrives by another route (e.g. the user supplies a profile URL). Scraping around the restriction is prohibited.',
  },
  {
    id: 'mca_registry', label: 'MCA (India) company master data', tierIfUsed: 1,
    implemented: false, credentialModel: 'none', callableForGrounding: false, tested: true,
    productionEnabledForGrounding: false, state: 'unavailable',
    evidence: 'CPG-010 live probe: www.mca.gov.in answers HTTP 403 to programmatic GET; master data is CAPTCHA-gated',
    note: 'NOT retrievable without bypassing an access control, which is prohibited. CIN normalisation/validation exists (registryIdentity.ts); a CIN the company states on its own site is recorded as first-party (registryVerified=false).',
  },
  {
    id: 'corporate_registry', label: 'Corporate registries (other jurisdictions)', tierIfUsed: 1,
    implemented: false, credentialModel: 'none', callableForGrounding: false, tested: false,
    productionEnabledForGrounding: false, state: 'unavailable',
    evidence: 'no Companies House or other non-US/IN registry connector',
    note: 'Registries live through the provider framework: SEC EDGAR, French Sirene, GLEIF. MCA is represented but inaccessible. Companies House (API requires a key) and every other national registry remain unimplemented.',
  },
]);

export interface CoverageSummary {
  callableNow: string[];
  implementedButUncredentialed: string[];
  abstractionOnly: string[];
  absent: string[];
  productionEnabledForGrounding: string[];
  /** The honest one-line statement for any report or UI. */
  statement: string;
}

export function coverageSummary(): CoverageSummary {
  const by = (p: (r: CapabilityRow) => boolean) => CAPABILITY_MATRIX.filter(p).map((r) => r.id);
  const callableNow = by((r) => r.callableForGrounding);
  return {
    callableNow,
    implementedButUncredentialed: by((r) => r.state === 'implemented_no_credential'),
    abstractionOnly: by((r) => r.state === 'abstraction_only'),
    absent: by((r) => r.state === 'unavailable'),
    productionEnabledForGrounding: by((r) => r.productionEnabledForGrounding),
    statement:
      `Evidence acquisition for company-profile grounding is currently limited to ${callableNow.length} source(s): ` +
      `${callableNow.join(', ')}. Registry identity comes through ONE provider framework (live: SEC EDGAR, French ` +
      `Sirene, GLEIF; live via mirror: Brazil CNPJ; represented but inaccessible or credential-gated: MCA, Companies ` +
      `House, Handelsregister, NTA, ACRA, CIPC, Delaware). A registry is reached only through an ` +
      `identifier or reference the company itself states — never by name — so many companies have no registry ` +
      `identity and are grounded on other identity evidence. LinkedIn and other registries are NOT available. Field ` +
      `coverage will therefore be sparse, and sparse coverage is reported as UNVERIFIED rather than filled in.`,
  };
}
