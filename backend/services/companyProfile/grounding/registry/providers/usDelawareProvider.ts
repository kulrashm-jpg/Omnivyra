/**
 * CPG-012 — a SUB-NATIONAL registry: the Delaware Division of Corporations.
 *
 *   jurisdiction US-DE → registry Delaware Division of Corporations → scheme USDEFN → RegistryProvider
 *
 * Why it is here: the United States has NO national company register.
 * Incorporation is state law (GLEIF lists 66 US registration authorities);
 * the SEC is a securities regulator whose CIK names REGISTRANTS, not
 * incorporations. A Delaware corporation's legal-entity number is its
 * Delaware file number, issued in jurisdiction US-DE. This provider proves
 * the model holds a registry whose jurisdiction is a SUBDIVISION, not a country.
 *
 * IDENTIFIER — the Delaware file number: 6–8 digits, no check digit
 * (structural only). GLEIF files it under RA000602 (e.g. "10752816", live).
 *
 * ACCESS — INACCESSIBLE: the Delaware entity search (icis.corp.delaware.gov)
 * is CAPTCHA-protected (live-probed CPG-012). Not worked around.
 */

import type { IdentifierScheme } from '../schemes';
import type { RegistryProvider } from '../providerContract';
import { simpleExternalMapping } from '../schemes';

const normalizeFileNumber = (raw: string): string | null => { const s = raw.trim().replace(/\s+/g, ''); return /^\d{6,8}$/.test(s) ? s : null; };

export const USDEFN_SCHEME: IdentifierScheme = {
  code: 'USDEFN', name: 'Delaware Division of Corporations file number', jurisdiction: 'US-DE', issuer: 'Delaware Division of Corporations',
  normalize: normalizeFileNumber,
  // A bare number is never self-evident; only a labelled statement counts.
  documentPattern: (v) => new RegExp(`Delaware[^.]{0,40}?file\\s+(?:number|no\\.?)\\s*[:.]?\\s*${v}(?![0-9])`, 'i'),
  firstPartyStatements: [{ label: 'Delaware file number stated by the company', pattern: /\bDelaware\b[^.]{0,40}?\bfile\s+(?:number|no\.?)\s*[:.]?\s*(\d{6,8})(?!\d)/gi }],
  externalReferences: [simpleExternalMapping('gleif_ra', ['RA000602'], normalizeFileNumber, (v) => [v])],
};

export const usDelawareProvider: RegistryProvider = {
  providerId: 'us_de_corporations',
  registryName: 'Delaware Division of Corporations',
  jurisdiction: 'US-DE',
  country: 'US',
  schemes: [USDEFN_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'INACCESSIBLE',
  availabilityDetail: 'icis.corp.delaware.gov entity search is CAPTCHA-protected (live-probed CPG-012). Not worked around.',
  providerFamily: 'us_de_corporations',
  async resolveFromExplicitIdentifier(registryId) {
    return { failure: 'inaccessible', detail: `Delaware record for ${registryId} not retrievable (CAPTCHA) — no request made` };
  },
};
