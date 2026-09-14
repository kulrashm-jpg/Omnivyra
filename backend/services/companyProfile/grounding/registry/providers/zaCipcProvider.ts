/**
 * CPG-012 — South Africa: CIPC, behind the provider contract.
 *
 *   jurisdiction ZA → registry CIPC → scheme ZACRN → RegistryProvider
 *
 * IDENTIFIER SEMANTICS — a STRUCTURED composite "YYYY/NNNNNN/TT": year of
 * registration / sequence / entity-type code (06 public company, 07 private
 * company, 08 non-profit company, 10 external company, 21 personal-liability
 * company, 23 close corporation, 30 state-owned company, …). No check digit:
 * structural validation only (year range, known entity-type code).
 * GLEIF files these under RA000531 (CIPC) — e.g. "1979/003231/06", live.
 *
 * ACCESS — INACCESSIBLE: eservices.cipc.co.za presents CAPTCHA and login
 * (live-probed CPG-012). Not worked around.
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';
import { simpleExternalMapping } from '../schemes';

/** CIPC entity-type codes (the third segment). */
const ENTITY_TYPES = new Set(['06', '07', '08', '09', '10', '11', '12', '20', '21', '22', '23', '24', '25', '26', '30', '31']);

function normalizeZacrn(raw: string): string | null {
  const m = /^(\d{4})\s*\/\s*(\d{6})\s*\/\s*(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1850 || year > 2100 || !ENTITY_TYPES.has(m[3])) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

export const ZACRN_SCHEME: IdentifierScheme = {
  code: 'ZACRN', name: 'CIPC registration number (South Africa)', jurisdiction: 'ZA', issuer: 'Companies and Intellectual Property Commission',
  normalize: normalizeZacrn,
  selfEvident: /^\d{4}\/\d{6}\/\d{2}$/,
  documentPattern: (v) => new RegExp(`(?<![0-9])${v.replace(/\//g, '\\s*/\\s*')}(?![0-9])`),
  firstPartyStatements: [{
    label: 'South African registration number stated by the company',
    pattern: /\b(?:Registration\s+(?:number|no\.?)|Reg\.?\s*No\.?|Company\s+registration\s+number)\s*[:.]?\s*(\d{4}\s*\/\s*\d{6}\s*\/\s*\d{2})(?!\d)/gi,
  }],
  externalReferences: [simpleExternalMapping('gleif_ra', ['RA000531'], normalizeZacrn, (v) => [v])],
};

export const zaCipcProvider: RegistryProvider = {
  providerId: 'za_cipc',
  registryName: 'CIPC (South Africa)',
  jurisdiction: 'ZA',
  country: 'ZA',
  schemes: [ZACRN_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'INACCESSIBLE',
  availabilityDetail: 'eservices.cipc.co.za: CAPTCHA + login (live-probed CPG-012). Not worked around.',
  providerFamily: 'za_cipc',
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'inaccessible', detail: `CIPC record for ${registryId} not retrievable (CAPTCHA / login) — no request made` };
  },
};
