/**
 * CPG-011 §11/§17 — GLEIF (Legal Entity Identifier) as a registry provider.
 *
 *   jurisdiction GLOBAL → registry GLEIF → scheme LEI (ISO 17442) → RegistryProvider
 *
 * Keyless CC0 API (api.gleif.org; robots.txt disallows nothing). LEIs carry an
 * ISO 7064 MOD 97-10 checksum, so a typo is INVALID, never another entity.
 *
 * Why it matters to a country-neutral design: an LEI record states, EXPLICITLY,
 *   · the national registry and number the entity is registered at
 *     (registeredAt RA-code + registeredAs) — a same-entity CROSS-REFERENCE
 *     between schemes (LEI ↔ SIREN, LEI ↔ CIN), and
 *   · reported accounting-consolidation parents (Level-2 relationship data).
 * Both are statements by the registry, never inferences from names.
 *
 * Cross-referencing only ever queries by an IDENTIFIER (filter
 * entity.registeredAs = <number>) and accepts a record only when its
 * registeredAs normalises to exactly that number AND its registration
 * authority is one mapped to that scheme. More than one record → none.
 */

import type { RegistryRelationship } from '../../types';
import type { ExternalReferenceMapping, IdentifierScheme } from '../schemes';
import type { ProviderContext, ProviderFailure, RegistryProvider, RegistryRecord } from '../providerContract';
import { mod97Valid } from '../schemes';
import { failureFromStatus } from '../providerContract';
import { parseJurisdiction } from '../jurisdiction';
import { field, iterate, member } from '../../jsonAccess';

export const GLEIF_HOST = 'api.gleif.org';
export const leiRecordUrl = (lei: string) => `https://${GLEIF_HOST}/api/v1/lei-records/${lei}`;

export const LEI_SCHEME: IdentifierScheme = {
  code: 'LEI', name: 'Legal Entity Identifier (ISO 17442)', jurisdiction: 'GLOBAL', issuer: 'GLEIF (via accredited LOUs)',
  normalize: (raw) => {
    const s = raw.trim().toUpperCase().replace(/\s+/g, '');
    return /^[0-9A-Z]{18}[0-9]{2}$/.test(s) && mod97Valid(s) ? s : null;
  },
  selfEvident: /^[0-9A-Z]{18}[0-9]{2}$/,
  documentPattern: (value) => new RegExp(`(?<![A-Za-z0-9])${value}(?![A-Za-z0-9])`, 'i'),
  firstPartyStatements: [{
    label: 'LEI stated on the company\'s own page',
    pattern: /\b(?:LEI|Legal\s+Entity\s+Identifier)(?:\s+code)?\s*(?:\(LEI\))?\s*[:#]?\s*([0-9A-Z]{18}[0-9]{2})\b/g,
  }],
};

/**
 * ⚠️ CPG-012 FIX — GLEIF's registration-authority vocabulary is no longer a
 * table inside this provider. CPG-011 hard-coded {RA000189, RA000192 → SIREN;
 * RA000394 → CIN}, so every new national registry needed an edit HERE, in a
 * different provider. Each national scheme now declares its own GLEIF codes
 * (IdentifierScheme.externalReferences, namespace "gleif_ra"); this provider
 * only reads the declarations through the registry it is registered in.
 */
export const GLEIF_RA_NAMESPACE = 'gleif_ra';

/** What this provider needs from the registry it is registered in. */
export interface GleifSchemeLookup {
  schemeForExternalCode(namespace: string, code: string): { scheme: IdentifierScheme; mapping: ExternalReferenceMapping } | null;
  scheme(code: string): IdentifierScheme | null;
}

async function getJson(ctx: ProviderContext, url: string): Promise<{ status: number; json: unknown } | null> {
  const r = await ctx.fetcher(url, { allowedHosts: [GLEIF_HOST] }).catch(() => null);
  if (!r) return null;
  try { return { status: r.status, json: r.ok ? JSON.parse(r.text) : null }; } catch { return { status: r.status, json: null }; }
}

/**
 * The record's `entity.jurisdiction` as `parseJurisdiction` reads it: a string,
 * or absent (every falsy value reads as absent there). Any other value is a
 * malformed record — string handling of it threw before, and still throws.
 */
function jurisdictionText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (!v) return null;
  throw new TypeError(`GLEIF entity.jurisdiction is a ${typeof v}, not a string`);
}

/** Build a record from one GLEIF lei-record `data` node. Pure (exported for tests). */
export function leiRecordFrom(node: unknown, url: string, retrievedAt: string, lookup: GleifSchemeLookup): RegistryRecord | null {
  const a = field(node, 'attributes');
  const lei = LEI_SCHEME.normalize(String(field(a, 'lei') ?? ''));
  const legalName = String(field(field(field(a, 'entity'), 'legalName'), 'name') ?? '').trim();
  if (!lei || !legalName) return null;
  const e = member(a, 'entity');
  const ra = String(field(member(e, 'registeredAt'), 'id') ?? '');
  const mapped = lookup.schemeForExternalCode(GLEIF_RA_NAMESPACE, ra);
  const scheme = mapped?.scheme ?? null;
  const registeredAs = member(e, 'registeredAs');
  // The national scheme translates its own number (a court-scoped German entry needs the RA to know the court).
  const national = mapped && registeredAs ? mapped.mapping.fromExternal(ra, String(registeredAs)) : null;
  const hq = member(e, 'headquartersAddress');
  const otherNames = member(e, 'otherNames');
  const status = member(e, 'status');
  return {
    providerId: 'gleif', scheme: 'LEI', registryId: `LEI:${lei}`, legalName,
    formerNames: (Array.isArray(otherNames) ? otherNames : [])
      .filter((o: unknown) => field(o, 'type') === 'PREVIOUS_LEGAL_NAME' && field(o, 'name'))
      .map((o: unknown) => ({ name: String(member(o, 'name')), from: null, to: null })),
    jurisdiction: parseJurisdiction(jurisdictionText(member(e, 'jurisdiction')))?.code ?? null,
    status: status === 'ACTIVE' ? 'active' : status === 'INACTIVE' ? 'inactive' : null,
    headquarters: field(hq, 'city') ? `${String(member(hq, 'city'))}, ${String(member(hq, 'country') ?? '')}`.replace(/, $/, '') : null,
    crossReferences: national && scheme ? [{ registryId: `${scheme.code}:${national}`, sourceUrl: url,
      detail: `GLEIF ${lei}: registeredAt ${ra} registeredAs "${registeredAs}" (${scheme.code})` }] : [],
    relationships: [],
    sourceUrl: url, retrievedAt, providerFamily: 'gleif',
    metadata: { registeredAt: ra, registeredAs: registeredAs ?? null, registrationStatus: field(member(a, 'registration'), 'status') ?? null, legalForm: field(member(e, 'legalForm'), 'id') ?? null },
  };
}

/** Constructed with the scheme lookup of the registry it is registered in (no global state). */
export function createGleifProvider(lookup: () => GleifSchemeLookup): RegistryProvider {
  const parents = async (lei: string, ctx: ProviderContext): Promise<RegistryRelationship[]> => {
    const out: RegistryRelationship[] = [];
    for (const rel of ['direct-parent', 'ultimate-parent'] as const) {
      const url = `${leiRecordUrl(lei)}/${rel}`;
      const r = await getJson(ctx, url);
      const p = field(field(r?.json, 'data'), 'attributes');
      const plei = p ? LEI_SCHEME.normalize(String(member(p, 'lei') ?? '')) : null;
      if (plei) {
        const parentName = field(field(member(p, 'entity'), 'legalName'), 'name');
        out.push({ registryId: `LEI:${plei}`, relation: rel === 'direct-parent' ? 'direct_parent' : 'ultimate_parent',
          // GLEIF states legal names as strings; anything else is not a stated name.
          legalName: typeof parentName === 'string' ? parentName : null, sourceUrl: url,
          detail: `GLEIF Level-2: ${lei} reports ${rel.replace('-', ' ')} ${plei} (${parentName ?? '?'})` });
      }
    }
    return out;
  };

  const byLei = async (lei: string, ctx: ProviderContext): Promise<RegistryRecord | ProviderFailure> => {
    const url = leiRecordUrl(lei);
    const r = await getJson(ctx, url);
    if (!r) return { failure: 'retrieval_failed', detail: `${url} → no response` };
    if (r.status === 404) return { failure: 'not_found', detail: `no LEI record ${lei}` };
    if (r.status !== 200) return failureFromStatus(r.status, url);
    const rec = r.json ? leiRecordFrom(member(r.json, 'data'), url, ctx.retrievedAt, lookup()) : null;
    if (!rec) return { failure: 'retrieval_failed', detail: `${url} → ${r.status}` };
    return { ...rec, relationships: await parents(lei, ctx) };
  };

  return {
    providerId: 'gleif',
    registryName: 'GLEIF — Global LEI Index',
    jurisdiction: 'GLOBAL',
    country: null,
    schemes: [LEI_SCHEME],
    capabilities: ['CAN_RESOLVE_IDENTIFIER', 'CAN_VERIFY_LEGAL_NAME', 'CAN_VERIFY_STATUS', 'CAN_VERIFY_JURISDICTION', 'CAN_CROSS_REFERENCE', 'CAN_PROVIDE_RELATIONSHIPS'],
    lookupModes: ['by_identifier', 'by_cross_reference'],
    availability: 'LIVE',
    availabilityDetail: 'Keyless CC0 API; identifier-only queries (LEI, or registeredAs = a national registry number).',
    providerFamily: 'gleif',

    async resolveFromExplicitIdentifier(registryId, ctx) {
      const lei = LEI_SCHEME.normalize(registryId.replace(/^LEI:/i, ''));
      if (!lei) return { failure: 'invalid_identifier', detail: `${registryId} is not a valid LEI (checksum)` };
      return byLei(lei, ctx);
    },

    async resolveFromOfficialRegistryRecord(record, ctx) {
      const scheme = lookup().scheme(record.scheme);
      const mapping = scheme?.externalReferences?.find((m) => m.namespace === GLEIF_RA_NAMESPACE);
      if (!scheme || !mapping) return [];
      const value = record.registryId.slice(record.scheme.length + 1);
      const { authorityCodes, raw } = mapping.toExternal(value);
      if (authorityCodes.length === 0) return [];
      const hits = new Map<string, unknown>();
      for (const f of raw) {
        const r = await getJson(ctx, `https://${GLEIF_HOST}/api/v1/lei-records?filter%5Bentity.registeredAs%5D=${encodeURIComponent(f)}`);
        for (const node of iterate(field(r?.json, 'data') ?? [])) {
          const e = field(field(node, 'attributes'), 'entity');
          const ra = String(field(field(e, 'registeredAt'), 'id') ?? '');
          // Same authority AND the number translates back to exactly this value.
          if (authorityCodes.includes(ra) && mapping.fromExternal(ra, String(field(e, 'registeredAs') ?? '')) === value) hits.set(String(member(member(node, 'attributes'), 'lei')), node);
        }
        if (hits.size > 0) break;
      }
      // Exactly one LEI for the number, or none: two is ambiguity, never a pick.
      if (hits.size !== 1) return [];
      const lei = [...hits.keys()][0];
      const rec = await byLei(lei, ctx);
      if ('failure' in rec) return [];
      return [{ ...rec, crossReferences: [...(rec.crossReferences ?? [])] }];
    },
  };
}
