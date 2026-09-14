/**
 * CPG-012 — United Kingdom: Companies House, behind the provider contract.
 *
 *   jurisdiction GB → registry Companies House → scheme GBCRN → RegistryProvider
 *
 * IDENTIFIER — the company registration number: 8 characters, either 8 digits
 * ("00445790"; shorter forms are zero-padded) or a 2-letter prefix and 6 digits
 * ("SC123456" Scotland, "NI…" Northern Ireland, "OC…" LLPs…). No check digit:
 * validation is structural only, and a typo is a DIFFERENT well-formed number,
 * never "corrected". The prefix determines the nation, and GLEIF files each
 * nation under its own registration authority (RA000585 England & Wales,
 * RA000586 Northern Ireland, RA000587 Scotland — GLEIF's official list).
 *
 * ACCESS — CREDENTIAL_REQUIRED. The Companies House REST API answers
 * HTTP 401 "Empty Authorization header" without an API key (live-probed
 * CPG-012). No key is read or used, so no record is ever fetched here.
 * Identity still flows: a UK company states its number on its own site
 * (Companies Act 2006 / Company, LLP and Business Names Regs 2015), and GLEIF
 * cross-references the number explicitly.
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';

const PREFIXES = new Set(['SC', 'NI', 'OC', 'SO', 'NC', 'LP', 'SL', 'NL', 'FC', 'SF', 'NF', 'GE', 'GS', 'GN', 'IP', 'SP', 'NP',
  'IC', 'SI', 'NO', 'RC', 'SR', 'NR', 'CE', 'CS', 'CN', 'RS', 'SA', 'NA', 'ZC', 'SZ', 'NZ', 'LL']);
const SCOTLAND = /^(SC|SO|SL|SF|GS|SP|SI|SR|CS|SA|SZ)/;
const NORTHERN_IRELAND = /^(NI|NC|NL|NF|GN|NP|NO|NR|CN|NA|NZ)/;
const RA = { EAW: 'RA000585', NIR: 'RA000586', SCT: 'RA000587' } as const;

function normalizeCrn(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{1,8}$/.test(s)) return /^0+$/.test(s) ? null : s.padStart(8, '0');
  const m = /^([A-Z]{2})(\d{6})$/.exec(s);
  return m && PREFIXES.has(m[1]) ? s : null;
}
const nationRa = (v: string) => (SCOTLAND.test(v) ? RA.SCT : NORTHERN_IRELAND.test(v) ? RA.NIR : RA.EAW);

export const GBCRN_SCHEME: IdentifierScheme = {
  code: 'GBCRN', name: 'Companies House company registration number', jurisdiction: 'GB', issuer: 'Companies House',
  normalize: normalizeCrn,
  // Bare 8-digit numbers are everywhere; only a labelled statement counts.
  documentPattern: (v) => new RegExp(`(?:company\\s+(?:registration\\s+)?(?:number|no\\.?)|registered\\s+(?:number|no\\.?)|registration\\s+(?:number|no\\.?))\\s*[:.]?\\s*0*${v.replace(/^0+/, '')}(?![0-9])`, 'i'),
  // English wording is not UK-specific ("Company number 123456" is also how an
  // Irish CRO number is stated): a statement counts only WITH UK context —
  // "registered in England and Wales / Scotland / Northern Ireland" or
  // "Companies House" in the same sentence.
  firstPartyStatements: [
    { label: 'UK "registered in England and Wales / Scotland / Northern Ireland … number" statement',
      pattern: /\b(?:registered\s+in\s+(?:england(?:\s+and\s+|\s*&\s*)wales|england|wales|scotland|northern\s+ireland)|companies\s+house)\b[^.]{0,60}?\b(?:no\.?|number)\s*[:.]?\s*([A-Z]{2}\d{6}|\d{6,8})\b/gi },
    { label: 'UK company number followed by "registered in England and Wales / Scotland / Northern Ireland"',
      pattern: /\b(?:company|registration|registered)\s+(?:number|no\.?)\s*[:.]?\s*([A-Z]{2}\d{6}|\d{6,8})\b[^.]{0,60}?\b(?:registered\s+in\s+(?:england|wales|scotland|northern\s+ireland)|companies\s+house)\b/gi },
  ],
  externalReferences: [{
    namespace: 'gleif_ra',
    authorityCodes: [RA.EAW, RA.NIR, RA.SCT],
    fromExternal: (code, raw) => { const v = normalizeCrn(raw); return v && nationRa(v) === code ? v : null; },
    toExternal: (v) => ({ authorityCodes: [nationRa(v)], raw: [...new Set([v, v.replace(/^0+/, '')])] }),
  }],
};

export const gbCompaniesHouseProvider: RegistryProvider = {
  providerId: 'gb_companies_house',
  registryName: 'Companies House (United Kingdom)',
  jurisdiction: 'GB',
  country: 'GB',
  schemes: [GBCRN_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION', 'CAN_PROVIDE_FILINGS'],
  lookupModes: ['by_identifier'],
  availability: 'CREDENTIAL_REQUIRED',
  availabilityDetail: 'Companies House REST API: HTTP 401 without an API key (live-probed CPG-012). No key is read or used.',
  providerFamily: 'gb_companies_house',
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'auth_required', detail: `Companies House record for ${registryId} requires an API key — not used; no request made` };
  },
};
