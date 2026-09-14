/**
 * CPG-011 §10 — India's Ministry of Corporate Affairs as a registry provider.
 *
 *   jurisdiction IN → registry MCA → schemes CIN, LLPIN → RegistryProvider
 *
 * availability = INACCESSIBLE: www.mca.gov.in answers HTTP 403 to programmatic
 * GET and gates master data behind CAPTCHA (live-probed CPG-010 and CPG-011).
 * Nothing here bypasses that. `resolveFromExplicitIdentifier` makes NO network
 * call and reports the block. The provider existing is not evidence that MCA
 * acquisition works.
 *
 * What still works without MCA: the schemes are defined (structure-validated),
 * a CIN the company states on its own pages is recognised, and another
 * registry that cross-references a CIN explicitly (GLEIF registeredAs, RA000394)
 * can verify the legal entity — see providers/gleifProvider.ts.
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';
import { exactTokenPattern, simpleExternalMapping } from '../schemes';

const CIN_RE = /^([LU])(\d{5})([A-Z]{2})(\d{4})([A-Z]{3})(\d{6})$/;

/** CIN: L/U, NIC code, state, year of incorporation, ownership class, number. Structure only. */
export const CIN_SCHEME: IdentifierScheme = {
  code: 'CIN', name: 'Corporate Identification Number (India)', jurisdiction: 'IN', issuer: 'Ministry of Corporate Affairs, India',
  normalize: (raw) => {
    const s = raw.trim().toUpperCase().replace(/\s+/g, '');
    const m = CIN_RE.exec(s);
    if (!m) return null;
    const year = Number(m[4]);
    return year >= 1850 && year <= 2100 ? s : null;
  },
  selfEvident: CIN_RE,
  documentPattern: exactTokenPattern,
  // CPG-012: GLEIF files CINs under RA000394 (Ministry of Corporate Affairs), verified live.
  get externalReferences() { return [simpleExternalMapping('gleif_ra', ['RA000394'], (raw) => CIN_SCHEME.normalize(raw), (v) => [v])]; },
  firstPartyStatements: [{
    label: 'CIN stated on the company\'s own page',
    pattern: /\b(?:CIN|Corporate\s+Identi(?:ty|fication)\s+(?:Number|No\.?))\s*[:\-–]?\s*([LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})\b/g,
  }],
};

export const LLPIN_SCHEME: IdentifierScheme = {
  code: 'LLPIN', name: 'LLP Identification Number (India)', jurisdiction: 'IN', issuer: 'Ministry of Corporate Affairs, India',
  normalize: (raw) => { const s = raw.trim().toUpperCase().replace(/\s+/g, ''); return /^[A-Z]{3}-\d{4}$/.test(s) ? s : null; },
  selfEvident: /^[A-Z]{3}-\d{4}$/,
  documentPattern: exactTokenPattern,
  firstPartyStatements: [{ label: 'LLPIN stated on the company\'s own page', pattern: /\bLLPIN\s*[:\-–]?\s*([A-Z]{3}-\d{4})\b/g }],
};

export const mcaProvider: RegistryProvider = {
  providerId: 'mca',
  registryName: 'Ministry of Corporate Affairs (MCA21) master data',
  jurisdiction: 'IN',
  country: 'IN',
  schemes: [CIN_SCHEME, LLPIN_SCHEME],
  // What the registry would establish, were it accessible. Availability decides whether any of it is used.
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'INACCESSIBLE',
  availabilityDetail: 'www.mca.gov.in: HTTP 403 to programmatic GET; master data CAPTCHA-gated. Not bypassed.',
  providerFamily: 'mca',
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'inaccessible', detail: `MCA master data for ${registryId} not retrievable (HTTP 403, CAPTCHA-gated) — no request made` };
  },
};
