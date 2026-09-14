/**
 * CPG-011 §8/§13 — the ONE provider registry and the ONE selection path.
 *
 * Answers "which authoritative identity providers exist for this
 * jurisdiction?" and "what can each actually establish?". Establishment,
 * identifier normalisation and the orchestrator consume it; no other module
 * selects a provider.
 *
 * Adding a jurisdiction is `registry.register(provider)` — the resolver, the
 * persistence and the API do not change (proven by a test provider for a
 * fictional jurisdiction in companyProfileRegistryProviders.test.ts).
 *
 * Deterministic: every listing is sorted by provider id / scheme code, so the
 * order providers were registered in cannot change any output.
 */

import type { ExternalReferenceMapping, IdentifierScheme } from './schemes';
import { SCHEME_CODE } from './schemes';
import type { FirstPartyReference, ProviderCapability, RegistryProvider } from './providerContract';
import { parseJurisdiction, withinJurisdiction } from './jurisdiction';

export interface ProviderRegistry {
  register(p: RegistryProvider): void;
  /** Register a scheme no provider issues (e.g. a tax id) — normalisable, never resolvable. */
  registerScheme(s: IdentifierScheme): void;
  providers(): RegistryProvider[];
  provider(id: string): RegistryProvider | null;
  schemes(): IdentifierScheme[];
  scheme(code: string): IdentifierScheme | null;
  /** The provider that ISSUES a scheme, if one is registered. */
  providerForScheme(code: string): RegistryProvider | null;
  /** Providers whose registry covers `jurisdiction` (a national provider, or a GLOBAL one). */
  providersFor(jurisdiction: string): RegistryProvider[];
  /**
   * CPG-012 — the schemes that declare how another registry's vocabulary
   * (`namespace`, e.g. a registration-authority code list) refers to them.
   */
  externalMappings(namespace: string): { scheme: IdentifierScheme; mapping: ExternalReferenceMapping }[];
  /** The scheme another registry files under `code` in `namespace` — exactly one, or null (two claimants is a configuration error). */
  schemeForExternalCode(namespace: string, code: string): { scheme: IdentifierScheme; mapping: ExternalReferenceMapping } | null;
}

export function createProviderRegistry(initial: readonly RegistryProvider[] = [], extraSchemes: readonly IdentifierScheme[] = []): ProviderRegistry {
  const byId = new Map<string, RegistryProvider>();
  const schemes = new Map<string, { scheme: IdentifierScheme; providerId: string | null }>();

  const addScheme = (s: IdentifierScheme, providerId: string | null) => {
    if (!SCHEME_CODE.test(s.code)) throw new Error(`invalid scheme code "${s.code}"`);
    if (!parseJurisdiction(s.jurisdiction)) throw new Error(`scheme ${s.code}: invalid jurisdiction "${s.jurisdiction}"`);
    const prior = schemes.get(s.code);
    // A scheme has exactly one issuer: two providers claiming "CIK" is a configuration error, not a tie to break.
    if (prior && (prior.providerId !== providerId || prior.scheme !== s)) throw new Error(`scheme ${s.code} is already registered`);
    // CPG-012: an external authority code may name ONE scheme only.
    for (const m of s.externalReferences ?? []) {
      for (const [code, other] of [...schemes.values()].flatMap((x) => (x.scheme.externalReferences ?? []).filter((o) => o.namespace === m.namespace).flatMap((o) => o.authorityCodes.map((c) => [c, x.scheme.code] as const)))) {
        if (other !== s.code && m.authorityCodes.includes(code)) throw new Error(`${m.namespace} code ${code} is already claimed by scheme ${other}`);
      }
    }
    schemes.set(s.code, { scheme: s, providerId });
  };

  const reg: ProviderRegistry = {
    register(p) {
      if (!/^[a-z][a-z0-9_]{1,63}$/.test(p.providerId)) throw new Error(`invalid provider id "${p.providerId}"`);
      if (byId.has(p.providerId)) throw new Error(`provider ${p.providerId} is already registered`);
      if (!parseJurisdiction(p.jurisdiction)) throw new Error(`provider ${p.providerId}: invalid jurisdiction "${p.jurisdiction}"`);
      for (const s of p.schemes) addScheme(s, p.providerId);
      byId.set(p.providerId, p);
    },
    registerScheme(s) { addScheme(s, null); },
    providers: () => [...byId.values()].sort((a, b) => (a.providerId < b.providerId ? -1 : 1)),
    provider: (id) => byId.get(id) ?? null,
    schemes: () => [...schemes.values()].map((x) => x.scheme).sort((a, b) => (a.code < b.code ? -1 : 1)),
    scheme: (code) => schemes.get(code)?.scheme ?? null,
    providerForScheme: (code) => { const pid = schemes.get(code)?.providerId; return pid ? byId.get(pid) ?? null : null; },
    providersFor: (jurisdiction) => reg.providers().filter((p) => withinJurisdiction(jurisdiction, p.jurisdiction)),
    externalMappings: (namespace) => reg.schemes().flatMap((scheme) =>
      (scheme.externalReferences ?? []).filter((m) => m.namespace === namespace).map((mapping) => ({ scheme, mapping }))),
    schemeForExternalCode: (namespace, code) => {
      const hits = reg.externalMappings(namespace).filter((x) => x.mapping.authorityCodes.includes(code));
      return hits.length === 1 ? hits[0] : null;
    },
  };
  for (const s of extraSchemes) reg.registerScheme(s);
  for (const p of initial) reg.register(p);
  return reg;
}

// ── selection (§13) ──────────────────────────────────────────────────────────

export interface SelectionInput {
  /** Jurisdictions known for the company (incorporation, listing, operation) — any number. */
  jurisdictions: readonly string[];
  /** References the company states on its own pages. */
  references: readonly FirstPartyReference[];
  /** Identifiers already established / supplied (normalised). */
  knownIdentifiers: readonly string[];
}

export type ProviderStatus = 'ELIGIBLE' | 'NO_REFERENCE' | 'INACCESSIBLE' | 'CREDENTIAL_REQUIRED' | 'NOT_IMPLEMENTED' | 'NOT_CAPABLE';

export interface ProviderSelection {
  providerId: string;
  jurisdiction: string;
  availability: RegistryProvider['availability'];
  status: ProviderStatus;
  /** Why it is (or is not) eligible — every reason, in a fixed order. */
  reasons: string[];
  /** The identifiers / references it would act on. */
  identifiers: string[];
  references: FirstPartyReference[];
}

const schemeOf = (id: string) => id.split(':')[0];

/**
 * Which providers act, and why. A provider is ELIGIBLE only when it holds
 * something to look up — an identifier in one of its schemes, a reference that
 * names it, or a listing on an exchange its own tables cover — AND it is LIVE
 * AND it can resolve identifiers. A known jurisdiction alone makes a provider
 * APPLICABLE (listed, with its status) but never triggers a lookup: with no
 * identifier there is nothing to look up, and looking up by name is not done.
 */
export function selectProviders(registry: ProviderRegistry, input: SelectionInput, need: ProviderCapability = 'CAN_RESOLVE_IDENTIFIER'): ProviderSelection[] {
  const out: ProviderSelection[] = [];
  for (const p of registry.providers()) {
    const codes = new Set(p.schemes.map((s) => s.code));
    const identifiers = [...new Set(input.knownIdentifiers.filter((id) => codes.has(schemeOf(id))))].sort();
    const references = input.references.filter((r) =>
      r.providerId === p.providerId
      || (r.scheme !== null && codes.has(r.scheme))
      || (r.kind === 'listing_statement' && !!r.exchange && (p.listingExchanges ?? []).includes(r.exchange)));
    const applicable = input.jurisdictions.some((j) => withinJurisdiction(j, p.jurisdiction) && p.jurisdiction !== 'GLOBAL');
    if (!applicable && identifiers.length === 0 && references.length === 0 && !p.capabilities.includes('CAN_CROSS_REFERENCE')) continue;

    const reasons: string[] = [];
    if (applicable) reasons.push(`covers a known jurisdiction (${input.jurisdictions.filter((j) => withinJurisdiction(j, p.jurisdiction)).join(', ')})`);
    if (identifiers.length) reasons.push(`holds ${identifiers.length} identifier(s) in its scheme(s)`);
    if (references.length) reasons.push(`${references.length} first-party reference(s) point to it`);
    if (p.capabilities.includes('CAN_CROSS_REFERENCE')) reasons.push('can cross-reference other registries by explicit identifier');

    let status: ProviderStatus;
    if (p.availability === 'INACCESSIBLE') status = 'INACCESSIBLE';
    else if (p.availability === 'CREDENTIAL_REQUIRED') status = 'CREDENTIAL_REQUIRED';
    else if (p.availability === 'NOT_IMPLEMENTED') status = 'NOT_IMPLEMENTED';
    else if (!p.capabilities.includes(need)) status = 'NOT_CAPABLE';
    else if (identifiers.length === 0 && references.length === 0) status = 'NO_REFERENCE';
    else status = 'ELIGIBLE';
    out.push({ providerId: p.providerId, jurisdiction: p.jurisdiction, availability: p.availability, status, reasons, identifiers, references });
  }
  return out;
}
