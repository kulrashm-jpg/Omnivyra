/**
 * CPG-012 — the GLOBAL REGISTRY COVERAGE INVENTORY (machine-readable).
 *
 * Reference data, not resolver code: it records, for representative
 * jurisdictions with materially different registry models, what the registry
 * is, what its identifier looks like, how it can be reached, and what is
 * ACTUALLY implemented and proven here — with the evidence. Nothing in the
 * core reads it; a test holds it consistent with the provider registry (no row
 * may claim more than the registered provider's availability).
 *
 * Status vocabulary:
 *   LIVE-PROVEN                  records fetched live from the registry itself
 *   LIVE-BUT-LIMITED             records fetched live, but from a mirror / partial source
 *   FIXTURE-PROVEN               behaviour proven on fixtures only
 *   IMPLEMENTED-BUT-INACCESSIBLE provider implemented; the registry blocks programmatic access
 *   CREDENTIAL-REQUIRED          provider implemented; the registry needs a key not used here
 *   NOT-IMPLEMENTED              no provider (inventory only)
 * `gleifCrossReference` is separate: whether GLEIF's explicit
 * registration-authority cross-reference for the scheme was proven live.
 */

export type CoverageStatus = 'LIVE-PROVEN' | 'LIVE-BUT-LIMITED' | 'FIXTURE-PROVEN' | 'IMPLEMENTED-BUT-INACCESSIBLE' | 'CREDENTIAL-REQUIRED' | 'NOT-IMPLEMENTED';

export interface CoverageRow {
  country: string | null;
  jurisdiction: string;
  registry: string;
  /** Scheme code in the provider registry (null when not implemented). */
  scheme: string | null;
  identifierFormat: string;
  identifierValidation: string;
  legalEntityCoverage: string;
  access: { mode: 'api' | 'web' | 'bulk' | 'none'; authentication: 'none' | 'api_key' | 'login' | 'captcha' | 'unknown'; evidence: string };
  statusAvailable: boolean | null;
  filingsAvailable: boolean | null;
  domainAssociation: 'registry_record' | 'official_filing' | 'first_party_statement_only' | 'none';
  /** GLEIF registration-authority codes under which the scheme's numbers are filed. */
  gleifAuthorities: readonly string[];
  gleifCrossReference: 'LIVE-PROVEN' | 'FIXTURE-PROVEN' | 'NOT-TESTED' | 'NONE';
  providerId: string | null;
  status: CoverageStatus;
  reason: string;
}

export const COVERAGE_INVENTORY: readonly CoverageRow[] = Object.freeze([
  {
    country: 'US', jurisdiction: 'US', registry: 'SEC EDGAR (securities registrants — NOT a company register)', scheme: 'CIK',
    identifierFormat: '1–10 digits, zero-padded to 10', identifierValidation: 'structural (no check digit)',
    legalEntityCoverage: 'SEC registrants only (listed / reporting entities); the US has no national company register',
    access: { mode: 'api', authentication: 'none', evidence: 'data.sec.gov submissions JSON 200 keyless (CPG-010/011 live)' },
    statusAvailable: false, filingsAvailable: true, domainAssociation: 'official_filing',
    gleifAuthorities: [], gleifCrossReference: 'NONE', providerId: 'sec_edgar', status: 'LIVE-PROVEN',
    reason: 'Live: Cloudflare, Infosys, Mercury Systems established through first-party references and registrant point-back.',
  },
  {
    country: 'US', jurisdiction: 'US-DE', registry: 'Delaware Division of Corporations (sub-national incorporation register)', scheme: 'USDEFN',
    identifierFormat: 'file number, 6–8 digits', identifierValidation: 'structural (no check digit)',
    legalEntityCoverage: 'entities incorporated in Delaware (one of 66 US registration authorities GLEIF lists)',
    access: { mode: 'web', authentication: 'captcha', evidence: 'icis.corp.delaware.gov entity search 200 with CAPTCHA (CPG-012 probe)' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'none',
    gleifAuthorities: ['RA000602'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'us_de_corporations', status: 'IMPLEMENTED-BUT-INACCESSIBLE',
    reason: 'CAPTCHA; not worked around. GLEIF files Delaware file numbers under RA000602. Live (CPG-012): file number 10752816 → GLEIF LEI 984500F9E3FU70E00767 (mechanism proof, no company context).',
  },
  {
    country: 'IN', jurisdiction: 'IN', registry: 'Ministry of Corporate Affairs (MCA21)', scheme: 'CIN',
    identifierFormat: '21 chars: L/U + NIC + state + year + class + number', identifierValidation: 'structural (year range)',
    legalEntityCoverage: 'companies (CIN) and LLPs (LLPIN)',
    access: { mode: 'web', authentication: 'captcha', evidence: 'www.mca.gov.in HTTP 403 to programmatic GET (CPG-010/011/012 probes)' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA000394'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'mca', status: 'IMPLEMENTED-BUT-INACCESSIBLE',
    reason: '403 + CAPTCHA; not worked around. Live: Zerodha CIN cross-referenced by GLEIF (RA000394).',
  },
  {
    country: 'FR', jurisdiction: 'FR', registry: 'Sirene / RNE (INSEE, INPI) via API Recherche d\'entreprises', scheme: 'SIREN',
    identifierFormat: '9 digits', identifierValidation: 'Luhn check digit (La Poste exception)',
    legalEntityCoverage: 'all French legal units (companies, associations, public bodies)',
    access: { mode: 'api', authentication: 'none', evidence: 'recherche-entreprises.api.gouv.fr 200 keyless (CPG-011 live)' },
    statusAvailable: true, filingsAvailable: false, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA000189', 'RA000192'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'fr_sirene', status: 'LIVE-PROVEN',
    reason: 'Live: TotalEnergies (subject) and Sanofi Winthrop Industrie (site publisher).',
  },
  {
    country: 'GB', jurisdiction: 'GB', registry: 'Companies House', scheme: 'GBCRN',
    identifierFormat: '8 chars: 8 digits, or 2-letter prefix + 6 digits (SC, NI, OC…)', identifierValidation: 'structural (no check digit)',
    legalEntityCoverage: 'UK companies and LLPs (England & Wales, Scotland, Northern Ireland)',
    access: { mode: 'api', authentication: 'api_key', evidence: 'api.company-information.service.gov.uk HTTP 401 "Empty Authorization header" (CPG-012 probe)' },
    statusAvailable: true, filingsAvailable: true, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA000585', 'RA000586', 'RA000587'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'gb_companies_house', status: 'CREDENTIAL-REQUIRED',
    reason: 'API key required; no key read or used. Live (CPG-012): Tesco 00445790 → GLEIF RA000585 → LEI 2138002P5RNKC5W2JZ46 "TESCO PLC".',
  },
  {
    country: 'DE', jurisdiction: 'DE', registry: 'Handelsregister (≈147 register courts)', scheme: 'DEHR',
    identifierFormat: 'court + register (HRA/HRB/GnR/PR/VR) + number — unique only per court', identifierValidation: 'structural; court qualification MANDATORY',
    legalEntityCoverage: 'merchants, companies, cooperatives, partnerships, associations',
    access: { mode: 'web', authentication: 'unknown', evidence: 'www.handelsregister.de: TCP connection failed on every probe (CPG-012)' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['147 court RAs (RA000197…RA000371)'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'de_handelsregister', status: 'IMPLEMENTED-BUT-INACCESSIBLE',
    reason: 'Connection refused from this environment; portal is session/form based. Court table generated from GLEIF\'s RA list. Live (CPG-012): bmwgroup.com imprint "München HRB 42243" → court RA000304 → LEI YEH5ZCD6E441RHVHD759 (site publisher: brand ≠ legal name).',
  },
  {
    country: 'JP', jurisdiction: 'JP', registry: 'National Tax Agency (corporate number) + Legal Affairs Bureau (registration number)', scheme: 'JPCN',
    identifierFormat: '13 digits, check digit FIRST; derived from the 12-digit registration number', identifierValidation: 'NTA check digit (mod 9)',
    legalEntityCoverage: 'all corporations (and state bodies)',
    access: { mode: 'api', authentication: 'api_key', evidence: 'NTA Web-API requires an application ID (CPG-012 probe: 404 without one)' },
    statusAvailable: true, filingsAvailable: false, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA001075 (JPCN)', 'RA000412 (JPREG)'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'jp_nta', status: 'CREDENTIAL-REQUIRED',
    reason: 'Application ID required; none read or used. JPREG → JPCN by the NTA derivation rule. Live (CPG-012): Toyota 1803-01-018771 → RA000412 → LEI 5493006W3QUS5LMH6R84; GLEIF does not index Toyota by its JPCN.',
  },
  {
    country: 'SG', jurisdiction: 'SG', registry: 'ACRA', scheme: 'UEN',
    identifierFormat: 'alphanumeric: ########X, YYYY#####X, [TSR]YYPQ####X', identifierValidation: 'structural only (check-letter rule not public for all families)',
    legalEntityCoverage: 'businesses, companies, other registered entities',
    access: { mode: 'api', authentication: 'captcha', evidence: 'data.gov.sg datastore HTTP 403 with CAPTCHA (CPG-012 probe); BizFile+ paid' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA000523'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'sg_acra', status: 'IMPLEMENTED-BUT-INACCESSIBLE',
    reason: 'CAPTCHA / paid access; not worked around. Live (CPG-012): DBS 196800306E → RA000523 → LEI ATUEL7OJR5057F2PV266 "DBS BANK LTD." (homepage unreachable).',
  },
  {
    country: 'BR', jurisdiction: 'BR', registry: 'Receita Federal CNPJ register (via BrasilAPI mirror)', scheme: 'CNPJ',
    identifierFormat: '14 digits AA.AAA.AAA/BBBB-CC; 8-digit root = legal entity, BBBB = establishment', identifierValidation: 'two mod-11 check digits',
    legalEntityCoverage: 'all legal entities and their establishments',
    access: { mode: 'api', authentication: 'none', evidence: 'brasilapi.com.br 200 keyless; invalid check digit → 400 (CPG-012 probe); Receita lookup itself CAPTCHA-gated' },
    statusAvailable: true, filingsAvailable: false, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA000681', 'RA000036…RA000062 (27 state boards of trade)'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'br_receita', status: 'LIVE-BUT-LIMITED',
    reason: 'Live records come from an open-source mirror of official open data, not the registry itself. Live (CPG-012): Petrobras 33.000.167/0001-01 record + RA000681 → LEI 5493000J801JZRCMFE49 (GLEIF matches only the formatted number).',
  },
  {
    country: 'ZA', jurisdiction: 'ZA', registry: 'CIPC', scheme: 'ZACRN',
    identifierFormat: 'YYYY/NNNNNN/TT (year / sequence / entity type)', identifierValidation: 'structural (year range, entity-type code)',
    legalEntityCoverage: 'companies, close corporations, co-operatives',
    access: { mode: 'web', authentication: 'captcha', evidence: 'eservices.cipc.co.za 200 with CAPTCHA + login (CPG-012 probe)' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'first_party_statement_only',
    gleifAuthorities: ['RA000531'], gleifCrossReference: 'LIVE-PROVEN', providerId: 'za_cipc', status: 'IMPLEMENTED-BUT-INACCESSIBLE',
    reason: 'CAPTCHA + login; not worked around. Live (CPG-012): Sasol 1979/003231/06 → RA000531 → LEI 378900F4544561A97588 "Sasol Limited"; sasol.com also states Sasol Financing Limited (kept as site publisher).',
  },
  {
    country: 'CA', jurisdiction: 'CA', registry: 'Corporations Canada (federal) + 13 provincial/territorial registries', scheme: null,
    identifierFormat: 'federal corporation number "930982-9"; Business Number 9 digits (Luhn)', identifierValidation: 'n/a (not implemented)',
    legalEntityCoverage: 'federal corporations; provincial registries separate (GLEIF: RA000072 federal, RA000079 Ontario …)',
    access: { mode: 'web', authentication: 'none', evidence: 'ised-isde.canada.ca federal search page 200; its data API is undocumented and was not used' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'none',
    gleifAuthorities: ['RA000072', 'RA000079'], gleifCrossReference: 'NOT-TESTED', providerId: null, status: 'NOT-IMPLEMENTED',
    reason: 'Selected out: federal/provincial split already represented by the US state model; no documented keyless API.',
  },
  {
    country: 'AU', jurisdiction: 'AU', registry: 'ASIC company register (ACN) / Australian Business Register (ABN)', scheme: null,
    identifierFormat: 'ACN 9 digits (check digit); ABN 11 digits (mod-89)', identifierValidation: 'n/a (not implemented)',
    legalEntityCoverage: 'companies (ACN); all businesses (ABN)',
    access: { mode: 'api', authentication: 'api_key', evidence: 'ABN Lookup web services require a registered GUID; abr.business.gov.au returned 406 to a plain GET (CPG-012 probe)' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'none',
    gleifAuthorities: ['RA000014'], gleifCrossReference: 'NOT-TESTED', providerId: null, status: 'NOT-IMPLEMENTED',
    reason: 'Not selected; credential-gated API. GLEIF files ACNs under RA000014 ("001 129 031").',
  },
  {
    country: 'AE', jurisdiction: 'AE', registry: 'Ministry of Economy National Economic Register + emirate DEDs + ~40 free-zone authorities', scheme: null,
    identifierFormat: 'varies by authority (e.g. 19-digit national economic register number)', identifierValidation: 'n/a (not implemented)',
    legalEntityCoverage: 'fragmented across federal, emirate and free-zone authorities',
    access: { mode: 'web', authentication: 'unknown', evidence: 'moec.gov.ae redirected to moet.gov.ae (outside the pinned host; not followed) (CPG-012 probe)' },
    statusAvailable: null, filingsAvailable: null, domainAssociation: 'none',
    gleifAuthorities: ['RA000752', 'RA001119 (Umm Al Quwain FTZ)'], gleifCrossReference: 'NOT-TESTED', providerId: null, status: 'NOT-IMPLEMENTED',
    reason: 'Multi-authority model; no single keyless registry. Representable as one provider per authority.',
  },
  {
    country: null, jurisdiction: 'GLOBAL', registry: 'GLEIF Global LEI Index', scheme: 'LEI',
    identifierFormat: '20 alphanumeric', identifierValidation: 'ISO 7064 MOD 97-10',
    legalEntityCoverage: 'entities that hold an LEI (financial-market participants mainly; not all companies)',
    access: { mode: 'api', authentication: 'none', evidence: 'api.gleif.org 200 keyless, CC0, robots allows all (CPG-011/012 live)' },
    statusAvailable: true, filingsAvailable: false, domainAssociation: 'none',
    gleifAuthorities: [], gleifCrossReference: 'LIVE-PROVEN', providerId: 'gleif', status: 'LIVE-PROVEN',
    reason: 'Live: cross-references to FR, IN, GB, DE, JP, SG, BR, ZA, US-DE registration authorities; reported parents.',
  },
]);
