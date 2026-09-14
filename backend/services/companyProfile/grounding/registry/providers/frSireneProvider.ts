/**
 * CPG-011 §11 — France's company register as a registry provider.
 *
 *   jurisdiction FR → registry Sirene / RNE → scheme SIREN → RegistryProvider
 *
 * Access: the State's open-data "API Recherche d'entreprises"
 * (recherche-entreprises.api.gouv.fr, DINUM / Etalab), which republishes INSEE
 * Sirene and the RNE. Keyless, designed for programmatic use (published limit
 * 7 requests/s). Queried ONLY with a SIREN, and only a result whose `siren`
 * equals the SIREN asked for is accepted — an identifiable registry record,
 * never a search hit by name.
 *
 * Where a SIREN comes from: French law requires a site's publisher to state
 * its identity (LCEN art. 6 — "mentions légales"): "RCS Paris 395 030 844",
 * "registered in the Trade and Companies Register of Nanterre under number
 * 542 051 180". That statement identifies the SITE PUBLISHER — which, live, is
 * not always the company (sanofi.com is published by Sanofi Winthrop
 * Industrie). The core decides the role; this provider only reads the record.
 *
 * The register lists no websites, so it cannot verify a domain
 * (no CAN_VERIFY_DOMAIN). The API returns a `finances` block; it is NOT read
 * (no CAN_PROVIDE_FINANCIAL_DATA).
 */

import type { IdentifierScheme } from '../schemes';
import type { ProviderFailure, RegistryProvider, RegistryRecord } from '../providerContract';
import { luhnValid, simpleExternalMapping } from '../schemes';
import { member } from '../../jsonAccess';

export const FR_API_HOST = 'recherche-entreprises.api.gouv.fr';
export const frRecordUrl = (siren: string) => `https://${FR_API_HOST}/search?q=${siren}`;

/** La Poste's SIREN is the documented exception to the Luhn rule. */
const LUHN_EXCEPTIONS = new Set(['356000000']);

export const SIREN_SCHEME: IdentifierScheme = {
  code: 'SIREN', name: 'SIREN (France)', jurisdiction: 'FR', issuer: 'INSEE (Sirene) / RCS',
  normalize: (raw) => {
    const d = raw.trim().replace(/[\s.\u00a0]/g, '');
    if (!/^\d{9}$/.test(d)) return null;
    return luhnValid(d) || LUHN_EXCEPTIONS.has(d) ? d : null;
  },
  // A bare 9-digit number is not self-evidently a SIREN (CUSIPs, phone numbers…).
  documentPattern: (value) => new RegExp(`(?<!\\d)${value.slice(0, 3)}[ .]?${value.slice(3, 6)}[ .]?${value.slice(6)}(?![ .]?\\d)`),
  display: (value) => `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6)}`,
  // CPG-012: how GLEIF files a SIREN — RA000189 (INSEE Sirene) and RA000192 (RCS / Infogreffe),
  // verified against GLEIF's registration-authority list; GLEIF writes "395 030 844".
  get externalReferences() {
    return [simpleExternalMapping('gleif_ra', ['RA000189', 'RA000192'], (raw) => SIREN_SCHEME.normalize(raw),
      (v) => [`${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}`, v])];
  },
  firstPartyStatements: [
    { label: 'French registration (SIREN / RCS) stated by the site publisher',
      pattern: /\b(?:SIREN|R\.?\s?C\.?\s?S\.?|Registre du commerce et des soci[ée]t[ée]s|Trade and Companies Register)\b[^0-9]{0,60}?(?<!\d)(\d{3}[ .]?\d{3}[ .]?\d{3})(?![ .]?\d)/gi },
    { label: 'French registration (number before "RCS")',
      pattern: /(?<!\d)(\d{3}[ .]?\d{3}[ .]?\d{3})\s{0,3}R\.?\s?C\.?\s?S\.?\b/gi },
  ],
};

const title = (s: string) => s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (_m, a: string, b: string) => a + b.toUpperCase());

export const frSireneProvider: RegistryProvider = {
  providerId: 'fr_sirene',
  registryName: 'Sirene / RNE (France) via API Recherche d\'entreprises',
  jurisdiction: 'FR',
  country: 'FR',
  schemes: [SIREN_SCHEME],
  capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION'],
  lookupModes: ['by_identifier'],
  availability: 'LIVE',
  availabilityDetail: 'Keyless open-data API (DINUM/Etalab); identifier-only queries; exact SIREN match required.',
  providerFamily: 'fr_sirene',
  // CPG-012: the French legal-notice vocabulary lives with the French provider.
  pageHints: { legalNoticeLinks: /\b(mentions\s+l[ée]gales|informations\s+l[ée]gales|legal\s+mentions)\b/i, legalNoticePaths: /\/mentions-legales\/?$/i },

  async resolveFromExplicitIdentifier(registryId, ctx): Promise<RegistryRecord | ProviderFailure> {
    const siren = SIREN_SCHEME.normalize(registryId.replace(/^SIREN:/i, ''));
    if (!siren) return { failure: 'invalid_identifier', detail: `${registryId} is not a valid SIREN` };
    const url = frRecordUrl(siren);
    const r = await ctx.fetcher(url, { allowedHosts: [FR_API_HOST] }).catch(() => null);
    if (!r || !r.ok) return { failure: 'retrieval_failed', detail: `${url} → ${r?.status ?? 'no response'}` };
    let hit: unknown;
    try {
      // A missing `results` finds nothing; a non-array one, or a null entry, threw here before and still ends as no hit.
      const results = member(JSON.parse(r.text), 'results');
      hit = Array.isArray(results) ? results.find((x: unknown) => member(x, 'siren') === siren) : undefined;
    } catch { hit = undefined; }
    if (!hit) return { failure: 'not_found', detail: `no record with siren ${siren}` };
    const legalName = String(member(hit, 'nom_raison_sociale') ?? member(hit, 'nom_complet') ?? '').trim();
    if (!legalName) return { failure: 'not_found', detail: `record ${siren} states no legal name` };
    const siege = member(hit, 'siege') ?? {};
    const foreign = member(siege, 'libelle_pays_etranger') ? title(String(member(siege, 'libelle_pays_etranger'))) : null;
    const city = member(siege, 'libelle_commune') ? title(String(member(siege, 'libelle_commune'))) : null;
    return {
      providerId: 'fr_sirene', scheme: 'SIREN', registryId: `SIREN:${siren}`, legalName,
      jurisdiction: 'FR',
      // Only what the register states: A = active, C = ceased.
      status: member(hit, 'etat_administratif') === 'A' ? 'active' : member(hit, 'etat_administratif') === 'C' ? 'inactive' : null,
      headquarters: city ? `${city}, ${foreign ?? 'France'}` : null,
      crossReferences: [], relationships: [],
      sourceUrl: url, retrievedAt: ctx.retrievedAt, providerFamily: 'fr_sirene',
      metadata: { natureJuridique: member(hit, 'nature_juridique') ?? null, dateCreation: member(hit, 'date_creation') ?? null,
        siegeAdresse: member(siege, 'adresse') ?? null, categorie: member(hit, 'categorie_entreprise') ?? null,
        recordPage: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}` },
    };
  },
};
