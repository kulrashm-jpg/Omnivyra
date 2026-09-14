/**
 * CPG-012 — Japan: the corporate number (法人番号), behind the provider contract.
 *
 *   jurisdiction JP → registry National Tax Agency → scheme JPCN (+ JPREG) → RegistryProvider
 *
 * IDENTIFIER SEMANTICS — two schemes, one derived from the other BY DEFINITION:
 *   JPREG  会社法人等番号 — the 12-digit company registration number issued by
 *          the Legal Affairs Bureau (written "1803-01-018771");
 *   JPCN   法人番号 — the 13-digit corporate number: a CHECK DIGIT FIRST, then,
 *          for a registered company, the same 12 digits. Check digit
 *          = 9 − (Σ Pn·Qn mod 9), Pn the n-th of the 12 digits counted from the
 *          right, Qn = 1 for odd n, 2 for even n (NTA, Corporate Number Act).
 * So a JPREG determines its JPCN (definedEquivalents) — a published rule, not
 * an inference. The reverse is NOT assumed: entities without a bureau
 * registration (e.g. state bodies) receive NTA-assigned base numbers.
 * GLEIF files JPREG under RA000412 (Legal Affairs Bureau) and JPCN under
 * RA001075 (National Tax Agency) — GLEIF's official list.
 *
 * ACCESS — CREDENTIAL_REQUIRED: the NTA Web-API requires an application ID
 * issued on registration; none is read or used, so no record is fetched.
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';
import { simpleExternalMapping } from '../schemes';

/** NTA check digit for a 12-digit base number. */
export function jpCheckDigit(base12: string): number {
  let sum = 0;
  for (let n = 1; n <= 12; n++) sum += Number(base12[12 - n]) * (n % 2 === 1 ? 1 : 2);
  return 9 - (sum % 9);
}
function normalizeJpcn(raw: string): string | null {
  const s = raw.trim().replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(s)) return null;
  return jpCheckDigit(s.slice(1)) === Number(s[0]) ? s : null;
}
function normalizeJpreg(raw: string): string | null {
  const s = raw.trim().replace(/[\s-]/g, '');
  return /^\d{12}$/.test(s) ? s : null;
}
const jpregDisplay = (v: string) => `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}`;

export const JPCN_SCHEME: IdentifierScheme = {
  code: 'JPCN', name: 'Corporate Number (Japan, 法人番号)', jurisdiction: 'JP', issuer: 'National Tax Agency, Japan',
  normalize: normalizeJpcn,
  documentPattern: (v) => new RegExp(`(?<![0-9])${v}(?![0-9])`),
  firstPartyStatements: [{ label: 'Japanese corporate number stated by the company', pattern: /(?:法人番号|Corporate\s+Number)\s*[:：]?\s*(\d{13})(?!\d)/g }],
  externalReferences: [simpleExternalMapping('gleif_ra', ['RA001075'], normalizeJpcn, (v) => [v])],
};

export const JPREG_SCHEME: IdentifierScheme = {
  code: 'JPREG', name: 'Company registration number (Japan, 会社法人等番号)', jurisdiction: 'JP', issuer: 'Legal Affairs Bureau, Japan',
  normalize: normalizeJpreg,
  documentPattern: (v) => new RegExp(`(?<![0-9])${v.slice(0, 4)}-?${v.slice(4, 6)}-?${v.slice(6)}(?![0-9])`),
  display: jpregDisplay,
  firstPartyStatements: [{ label: 'Japanese company registration number stated by the company', pattern: /(?:会社法人等番号)\s*[:：]?\s*(\d{4}-?\d{2}-?\d{6})(?!\d)/g }],
  definedEquivalents: (v) => [{ registryId: `JPCN:${jpCheckDigit(v)}${v}`, detail: 'NTA rule: a registered company\'s corporate number is its check digit followed by its 12-digit registration number' }],
  externalReferences: [simpleExternalMapping('gleif_ra', ['RA000412'], normalizeJpreg, (v) => [jpregDisplay(v), v])],
};

export const jpCorporateNumberProvider: RegistryProvider = {
  providerId: 'jp_nta',
  registryName: 'National Tax Agency — Corporate Number Publication Site (Japan)',
  jurisdiction: 'JP',
  country: 'JP',
  // JPREG is issued by the Legal Affairs Bureau, but it only resolves through the
  // corporate number it defines, so it is held by this module (CPG-012 finding:
  // a scheme no provider holds never becomes an identity, so its definition is unreachable).
  schemes: [JPCN_SCHEME, JPREG_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'CREDENTIAL_REQUIRED',
  availabilityDetail: 'NTA Web-API requires an application ID issued on registration; none is read or used.',
  providerFamily: 'jp_nta',
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'auth_required', detail: `NTA corporate-number record for ${registryId} requires an application ID — not used; no request made` };
  },
};
