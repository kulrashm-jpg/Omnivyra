/**
 * CPG-012 — Singapore: ACRA, behind the provider contract.
 *
 *   jurisdiction SG → registry ACRA → scheme UEN → RegistryProvider
 *
 * IDENTIFIER SEMANTICS — the Unique Entity Number is ALPHANUMERIC with a
 * trailing check LETTER, in three structurally different families:
 *   ########X        businesses (8 digits + letter)
 *   YYYY#####X       local companies (year of registration + 5 digits + letter)
 *   [TSR]YYPQ####X   other entities (T/S/R + year + 2-letter entity type + 4 digits + letter)
 * The check-letter algorithm is not publicly specified for all families, so
 * validation here is STRUCTURAL ONLY — honestly weaker than a checksum. A
 * sub-identifier such as a VCC sub-fund ("T20VC0006B-SF005", seen in GLEIF) is
 * not a UEN and is refused rather than truncated.
 *
 * ACCESS — INACCESSIBLE: the data.gov.sg datastore API answered HTTP 403 with a
 * CAPTCHA challenge (live-probed CPG-012); ACRA's BizFile+ is a paid, logged-in
 * service. Not worked around. GLEIF files UENs under RA000523 (ACRA).
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';
import { simpleExternalMapping } from '../schemes';

const UEN = /^(?:\d{8}[A-Z]|(?:18|19|20)\d{7}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])$/;
function normalizeUen(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '');
  return UEN.test(s) ? s : null;
}

export const UEN_SCHEME: IdentifierScheme = {
  code: 'UEN', name: 'Unique Entity Number (Singapore)', jurisdiction: 'SG', issuer: 'ACRA and other Singapore registration agencies',
  normalize: normalizeUen,
  documentPattern: (v) => new RegExp(`(?<![A-Za-z0-9])${v}(?![A-Za-z0-9-])`, 'i'),
  firstPartyStatements: [{
    label: 'Singapore UEN / company registration number stated by the company',
    pattern: /\b(?:UEN|Co\.?\s*Reg(?:istration)?\.?\s*No\.?|Company\s+Registration\s+(?:No\.?|Number))\s*[:.]?\s*((?:18|19|20)\d{7}[A-Z]|\d{8}[A-Z]|[TSR]\d{2}[A-Z]{2}\d{4}[A-Z])(?![A-Za-z0-9-])/gi,
  }],
  externalReferences: [simpleExternalMapping('gleif_ra', ['RA000523'], normalizeUen, (v) => [v])],
};

export const sgAcraProvider: RegistryProvider = {
  providerId: 'sg_acra',
  registryName: 'ACRA (Singapore)',
  jurisdiction: 'SG',
  country: 'SG',
  schemes: [UEN_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'INACCESSIBLE',
  availabilityDetail: 'data.gov.sg datastore API: HTTP 403 + CAPTCHA (live-probed CPG-012); BizFile+ is paid/login. Not worked around.',
  providerFamily: 'sg_acra',
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'inaccessible', detail: `ACRA record for ${registryId} not retrievable (CAPTCHA / paid access) — no request made` };
  },
};
