/**
 * CPG-011 — ONE country-neutral path from first-party evidence to registry
 * identity. It knows the provider CONTRACT, never a provider.
 *
 *   first-party pages
 *     → references   (scheme statements: "RCS … 395 030 844", "CIN: …", "LEI: …";
 *                      provider references: registry links, listing statements)
 *     → selection    (registry/providerRegistry.selectProviders — the only one)
 *     → records      (provider.resolveFromExplicitIdentifier — by identifier only)
 *     → role         subject | site_publisher | (not attached)
 *     → cross-references and relationships the records state EXPLICITLY
 *
 * ROLE — who the identified legal entity is FOR THE COMPANY:
 *   • a registrant whose own record / official filing POINTS BACK at a company
 *     host (verifyDomainAssociation)                              → subject;
 *   • an identifier the company states on its own page (legal notice,
 *     imprint, CIN footer) names the SITE PUBLISHER. It is the subject only
 *     when the registry's record for it names the company (legal name equal to
 *     a known name, legal form aside); otherwise it stays site_publisher.
 *     Live: sanofi.com's legal notice names Sanofi Winthrop Industrie
 *     (775 662 257), not Sanofi (395 030 844) — merging them would attribute
 *     a subsidiary's registry record to the listed parent;
 *   • a registry link / listing that does not point back   → not attached;
 *   • an identifier the account owner supplied (known)    → subject.
 * Two different subject identifiers in ONE scheme → ambiguity, none attached.
 *
 * Cross-scheme identity (§17) is never inferred: another registry's record
 * must name the identifier explicitly (GLEIF registeredAs), and a parent /
 * child is attached only as the registry states it (related_entity).
 */

import type { DomainAlias, RegistryIdentity } from '../types';
import type { EvidenceFetcher } from '../acquisition/evidenceSource';
import type { CandidateIdentifier, FirstPartyReference, ProviderContext, RegistryRecord } from './providerContract';
import { isFailure, type ProviderFailure } from './providerContract';
import { selectProviders, type ProviderRegistry, type ProviderSelection } from './providerRegistry';
import { defaultProviderRegistry } from './builtins';
import { entityIdentityKey, legalNamesEquivalent } from '../registryIdentity';
import { decodeEntities } from '../extraction/valueTypes';

export interface EstablishmentPage { url: string; html: string }

export interface EstablishmentInput {
  /** First-party pages only (canonical host or a DECISIVE alias). */
  pages: readonly EstablishmentPage[];
  canonicalDomain: string;
  ownedHosts: readonly string[];
  /** Known name + known legal names — used ONLY to decide subject vs site_publisher for an ID the company itself states. */
  companyNames: readonly string[];
  jurisdictions: readonly string[];
  knownIdentifiers: readonly string[];
  fetcher: EvidenceFetcher;
  retrievedAt: string;
  userAgent?: string;
  registry?: ProviderRegistry;
}

export type CandidateOutcomeKind =
  | 'subject' | 'site_publisher' | 'related_entity' | 'unconfirmed' | 'record_unavailable'
  | 'inconsistent' | 'inaccessible' | 'credential_required' | 'not_implemented' | 'ambiguous';

export interface CandidateOutcome {
  registryId: string;
  providerId: string;
  via: 'identifier_statement' | 'registry_link' | 'listing_mapping' | 'known' | 'registry_cross_reference';
  outcome: CandidateOutcomeKind;
  detail: string;
  /** CPG-012 — the provider failure kind behind a non-attachment (auth_required, rate_limited, …). */
  failure?: ProviderFailure['failure'];
}

export interface RegistryEstablishment {
  selection: ProviderSelection[];
  references: FirstPartyReference[];
  candidates: CandidateOutcome[];
  identities: RegistryIdentity[];
  additionalDomains: DomainAlias[];
  ambiguity: string[];
}

const MAX_CANDIDATES_PER_PROVIDER = 4;

export const visibleText = (html: string) => decodeEntities(html
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\u00a0/g, ' ')
  .replace(/\s+/g, ' ')
  // CPG-012 LIVE DEFECT: bmwgroup.com serves "München" decomposed (u + U+0308); statement patterns are written composed.
  .normalize('NFC');

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const byId = <T extends { registryId: string }>(a: T, b: T) => (a.registryId < b.registryId ? -1 : a.registryId > b.registryId ? 1 : 0);

/** Every first-party reference, from scheme statements and provider extractors. Pure, deterministic. */
export function extractReferences(pages: readonly EstablishmentPage[], registry: ProviderRegistry = defaultProviderRegistry()): FirstPartyReference[] {
  const withText = pages.map((p) => ({ url: p.url, html: p.html, text: visibleText(p.html) }));
  const out: FirstPartyReference[] = [];
  for (const scheme of registry.schemes()) {
    for (const st of scheme.firstPartyStatements ?? []) {
      for (const p of withText) {
        const re = new RegExp(st.pattern.source, st.pattern.flags.includes('g') ? st.pattern.flags : `${st.pattern.flags}g`);
        let m: RegExpExecArray | null;
        while ((m = re.exec(p.text)) !== null) {
          const v = scheme.normalize(m[1]);
          if (v) {
            out.push({ kind: 'identifier_statement', value: `${scheme.code}:${v}`, scheme: scheme.code,
              providerId: registry.providerForScheme(scheme.code)?.providerId ?? null, sourceUrl: p.url,
              detail: `${p.url} states "${clip(m[0].trim(), 140)}" (${st.label})` });
          }
        }
      }
    }
  }
  for (const pr of registry.providers()) if (pr.extractReferences) out.push(...pr.extractReferences(withText));
  const seen = new Set<string>();
  return out
    .filter((r) => { const k = `${r.kind}|${r.exchange ?? ''}|${r.value}|${r.sourceUrl}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => { const ka = `${a.kind}|${a.value}|${a.sourceUrl}`, kb = `${b.kind}|${b.value}|${b.sourceUrl}`; return ka < kb ? -1 : ka > kb ? 1 : 0; });
}

interface Pointer { via: CandidateOutcome['via']; sourceUrl: string | null; detail: string; candidate?: CandidateIdentifier }

/**
 * CPG-012 §10 — a provider that THROWS is isolated here: its failure is
 * recorded (provider_error) and establishment continues with every other
 * provider and every other kind of identity evidence. (CPG-011 let a throw
 * escape to the orchestrator, which then discarded the WHOLE identity step —
 * aliases included.)
 */
async function guarded<T>(fn: () => Promise<T>, onError: (e: unknown) => T): Promise<T> {
  try { return await fn(); } catch (e) { return onError(e); }
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

export async function establishRegistryIdentities(input: EstablishmentInput): Promise<RegistryEstablishment> {
  const registry = input.registry ?? defaultProviderRegistry();
  const ctx: ProviderContext = { fetcher: input.fetcher, retrievedAt: input.retrievedAt, canonicalDomain: input.canonicalDomain, ownedHosts: input.ownedHosts, userAgent: input.userAgent };
  const references = extractReferences(input.pages, registry);
  const selection = selectProviders(registry, { jurisdictions: input.jurisdictions, references, knownIdentifiers: input.knownIdentifiers });
  const candidates: CandidateOutcome[] = [];
  const identities: RegistryIdentity[] = [];
  const additionalDomains: DomainAlias[] = [];
  const ambiguity: string[] = [];
  const records = new Map<string, RegistryRecord>();
  const namesTheCompany = (legalName: string | null | undefined, former: readonly { name: string }[] = []) =>
    !!legalName && input.companyNames.some((n) => legalNamesEquivalent(n, legalName) || former.some((f) => legalNamesEquivalent(n, f.name)));

  for (const sel of selection) {
    const provider = registry.provider(sel.providerId)!;
    // An inaccessible registry is never queried; it still records what the company
    // (its page) or the account owner states, UNVERIFIED.
    const cannotQuery = sel.status === 'INACCESSIBLE' || sel.status === 'CREDENTIAL_REQUIRED' || sel.status === 'NOT_IMPLEMENTED';
    const acts = sel.status === 'ELIGIBLE'
      || (cannotQuery && (sel.references.some((r) => r.kind === 'identifier_statement') || sel.identifiers.length > 0));
    if (!acts) continue;

    // ── pointers → candidate identifiers ─────────────────────────────────
    const pointers = new Map<string, Pointer[]>();
    const add = (id: string, p: Pointer) => pointers.set(id, [...(pointers.get(id) ?? []), p]);
    for (const r of sel.references.filter((x) => x.kind === 'identifier_statement')) add(r.value, { via: 'identifier_statement', sourceUrl: r.sourceUrl, detail: r.detail });
    for (const id of sel.identifiers) add(id, { via: 'known', sourceUrl: null, detail: `identifier supplied for the company (${id})` });
    if (provider.availability === 'LIVE' && provider.resolveFromFirstPartyReference) {
      const other = sel.references.filter((x) => x.kind !== 'identifier_statement');
      const resolved = other.length ? await guarded(() => provider.resolveFromFirstPartyReference!(other, ctx), (e) => {
        candidates.push({ registryId: `(references of ${provider.providerId})`, providerId: provider.providerId, via: 'registry_link', outcome: 'record_unavailable', detail: `provider error: ${errText(e)}`, failure: 'provider_error' });
        return [] as CandidateIdentifier[];
      }) : [];
      for (const c of resolved) add(c.registryId, { via: c.via, sourceUrl: c.sourceUrl, detail: c.detail, candidate: c });
    }
    const ids = [...pointers.keys()].sort().slice(0, MAX_CANDIDATES_PER_PROVIDER);

    for (const id of ids) {
      const ps = pointers.get(id)!;
      const stated = ps.find((p) => p.via === 'identifier_statement');
      const known = ps.find((p) => p.via === 'known');
      const via0 = (stated ?? known ?? ps[0]).via;
      const scheme = id.split(':')[0];
      const chain0 = ps.map((p) => ({ step: p.via, sourceUrl: p.sourceUrl, detail: p.detail }));

      if (provider.availability !== 'LIVE') {
        const outcome: CandidateOutcomeKind = provider.availability === 'CREDENTIAL_REQUIRED' ? 'credential_required' : provider.availability === 'NOT_IMPLEMENTED' ? 'not_implemented' : 'inaccessible';
        candidates.push({ registryId: id, providerId: provider.providerId, via: via0, outcome, detail: provider.availabilityDetail });
        if (stated) {
          // ⚠️ CPG-012 LIVE DEFECT (Sasol): an identifier the account owner SUPPLIED and the page also
          // states was demoted to site_publisher (the statement took precedence) — then removed as
          // ambiguous next to another stated number, losing its GLEIF cross-reference. The owner's
          // assertion makes it the subject; the statement adds the first-party association.
          identities.push({
            scheme, registryId: id, provider: provider.providerId, legalName: null, jurisdiction: provider.country ? provider.jurisdiction : null, status: null,
            establishedBy: known ? 'user_provided' : 'first_party_statement', role: known ? 'subject' : 'site_publisher', registryVerified: false,
            chain: [...chain0, { step: 'registry_record', sourceUrl: null, detail: `${provider.registryName}: ${provider.availabilityDetail}` }],
            domainAssociations: [{ legalEntity: '(not read — registry inaccessible)', registryId: id, domain: input.canonicalDomain, associationReason: 'first_party_statement', associationSource: stated.sourceUrl!, detail: stated.detail }],
          });
        } else if (known) {
          // The account owner's own assertion: the company's identifier, UNVERIFIED
          // (the registry cannot be read). Kept so an explicit cross-reference
          // (another registry naming it) can still be tried.
          identities.push({
            scheme, registryId: id, provider: provider.providerId, legalName: null, jurisdiction: provider.country ? provider.jurisdiction : null, status: null,
            establishedBy: 'user_provided', role: 'subject', registryVerified: false,
            chain: [...chain0, { step: 'registry_record', sourceUrl: null, detail: `${provider.registryName}: ${provider.availabilityDetail}` }],
            domainAssociations: [],
          });
        }
        continue;
      }

      const rec = await guarded<RegistryRecord | ProviderFailure>(() => provider.resolveFromExplicitIdentifier(id, ctx),
        (e) => ({ failure: 'provider_error', detail: `provider error: ${errText(e)}` }));
      if (isFailure(rec)) {
        candidates.push({ registryId: id, providerId: provider.providerId, via: via0,
          outcome: rec.failure === 'inaccessible' ? 'inaccessible' : rec.failure === 'auth_required' ? 'credential_required' : 'record_unavailable',
          detail: rec.detail, failure: rec.failure });
        continue;
      }
      records.set(rec.registryId, rec);
      const inconsistent = ps.filter((p) => p.candidate).map((p) => provider.checkCandidate?.(p.candidate!, rec) ?? null);
      if (inconsistent.length > 0 && inconsistent.every((x) => x !== null) && !stated && !known) {
        candidates.push({ registryId: id, providerId: provider.providerId, via: via0, outcome: 'inconsistent', detail: inconsistent[0]! });
        continue;
      }

      const verified = provider.capabilities.includes('CAN_VERIFY_DOMAIN') && provider.verifyDomainAssociation
        ? await guarded(() => provider.verifyDomainAssociation!(rec, ctx), () => null) : null;
      let role: RegistryIdentity['role'] | null = null;
      let why: string;
      const chain = [...chain0, { step: 'registry_record', sourceUrl: rec.sourceUrl, detail: `${provider.registryName} ${rec.registryId}: "${rec.legalName}"${rec.jurisdiction ? `, ${rec.jurisdiction}` : ''}${rec.status ? `, ${rec.status}` : ''}` }];
      const associations: RegistryIdentity['domainAssociations'] = [];
      if (verified) {
        role = 'subject'; why = verified.association.detail;
        associations.push(verified.association);
        chain.push({ step: verified.association.associationReason, sourceUrl: verified.association.associationSource, detail: verified.association.detail });
        additionalDomains.push(...verified.additionalDomains);
      } else if (stated) {
        associations.push({ legalEntity: rec.legalName, registryId: rec.registryId, domain: input.canonicalDomain, associationReason: 'first_party_statement', associationSource: stated.sourceUrl!, detail: stated.detail });
        if (namesTheCompany(rec.legalName, rec.formerNames)) { role = 'subject'; why = `the registry names the site publisher "${rec.legalName}" — the company`; }
        else if (known) { role = 'subject'; why = `identifier supplied for the company and stated on its own page; registry record read ("${rec.legalName}" — the account owner's assertion, not a name match)`; }
        else { role = 'site_publisher'; why = `the company's own page names "${rec.legalName}" as publisher; the registry does not show it to be the company (${input.companyNames.join(' / ')}) — kept as a separate legal entity`; }
      } else if (known) {
        role = 'subject'; why = 'identifier supplied for the company; registry record read';
      } else {
        why = `${rec.legalName} — neither its record nor its official filing names ${input.canonicalDomain}; not attached (could be a parent, a subsidiary or a partner)`;
      }
      candidates.push({ registryId: rec.registryId, providerId: provider.providerId, via: via0, outcome: role ?? 'unconfirmed', detail: why });
      if (!role) continue;
      identities.push({
        scheme: rec.scheme, registryId: rec.registryId, provider: provider.providerId, legalName: rec.legalName, formerNames: rec.formerNames,
        jurisdiction: rec.jurisdiction, status: rec.status ?? null,
        establishedBy: known && !stated && !verified ? 'user_provided' : ps.every((p) => p.via === 'listing_mapping') ? 'listing_mapping' : 'first_party_statement',
        role, registryVerified: true, chain, domainAssociations: associations, relationships: rec.relationships ?? [],
      });
    }
  }

  // ── ambiguity: one scheme, several different entities in the same role ───
  // CPG-012: "different" means different LEGAL ENTITY (two establishments of one company are not ambiguous).
  for (const role of ['subject', 'site_publisher'] as const) {
    const bySchemeRole = new Map<string, Map<string, string[]>>();
    for (const i of identities.filter((x) => x.role === role)) {
      const m = bySchemeRole.get(i.scheme) ?? new Map<string, string[]>();
      const k = entityIdentityKey(i.registryId, registry) ?? i.registryId;
      m.set(k, [...(m.get(k) ?? []), i.registryId]);
      bySchemeRole.set(i.scheme, m);
    }
    for (const [scheme, byEntity] of bySchemeRole) {
      if (byEntity.size <= 1) continue;
      const set = new Set([...byEntity.values()].flat());
      ambiguity.push(`${byEntity.size} different ${scheme} identifiers as ${role} (${[...set].sort().join(', ')}) — ambiguous, none attached`);
      for (let i = identities.length - 1; i >= 0; i--) if (identities[i].role === role && identities[i].scheme === scheme) identities.splice(i, 1);
      for (const c of candidates) if (set.has(c.registryId) && c.outcome === role) c.outcome = 'ambiguous';
    }
  }

  // ── CPG-012: identifiers equal BY DEFINITION of a scheme (a published rule) ──
  for (const i of [...identities]) {
    const def = registry.scheme(i.scheme);
    const value = i.registryId.slice(i.scheme.length + 1);
    for (const eq of def?.definedEquivalents?.(value) ?? []) {
      if (identities.some((x) => x.registryId === eq.registryId)) continue;
      const eqScheme = eq.registryId.split(':')[0];
      identities.push({
        scheme: eqScheme, registryId: eq.registryId, provider: registry.providerForScheme(eqScheme)?.providerId ?? 'other', legalName: i.legalName,
        jurisdiction: i.jurisdiction, status: null, establishedBy: 'registry_cross_reference', role: i.role, registryVerified: false,
        chain: [{ step: 'scheme_definition', sourceUrl: null, detail: `${i.registryId} → ${eq.registryId}: ${eq.detail}` }], domainAssociations: [],
      });
      candidates.push({ registryId: eq.registryId, providerId: registry.providerForScheme(eqScheme)?.providerId ?? 'other', via: 'registry_cross_reference', outcome: i.role ?? 'subject', detail: eq.detail });
    }
  }

  // ── explicit cross-references and relationships (§16, §17) ───────────────
  const attached = new Set(identities.map((i) => i.registryId));
  const crossProviders = registry.providers().filter((p) => p.availability === 'LIVE' && p.capabilities.includes('CAN_CROSS_REFERENCE') && p.resolveFromOfficialRegistryRecord);
  for (const src of [...identities].sort(byId)) {
    const srcRecord = records.get(src.registryId) ?? { scheme: src.scheme, registryId: src.registryId };
    const found: { rec: RegistryRecord; via: string }[] = [];
    for (const p of crossProviders) {
      if (p.providerId === src.provider) continue;
      const recs = await guarded(() => p.resolveFromOfficialRegistryRecord!(srcRecord, ctx), (e) => {
        candidates.push({ registryId: src.registryId, providerId: p.providerId, via: 'registry_cross_reference', outcome: 'record_unavailable', detail: `provider error: ${errText(e)}`, failure: 'provider_error' });
        return [] as RegistryRecord[];
      });
      for (const rec of recs) found.push({ rec, via: p.registryName });
    }
    for (const { rec, via } of found) {
      records.set(rec.registryId, rec);
      // An unverified source (registry inaccessible) may be confirmed by the
      // cross-referencing registry's record naming the company.
      if (src.role === 'site_publisher' && !src.registryVerified && namesTheCompany(rec.legalName, rec.formerNames)) {
        src.role = 'subject';
        src.chain.push({ step: 'registry_cross_reference', sourceUrl: rec.sourceUrl, detail: `${via} record ${rec.registryId} "${rec.legalName}" names the company and cross-references ${src.registryId}` });
      }
      if (attached.has(rec.registryId)) continue;
      attached.add(rec.registryId);
      identities.push({
        scheme: rec.scheme, registryId: rec.registryId, provider: rec.providerId, legalName: rec.legalName, formerNames: rec.formerNames,
        jurisdiction: rec.jurisdiction, status: rec.status ?? null, establishedBy: 'registry_cross_reference', role: src.role, registryVerified: true,
        chain: [{ step: 'registry_cross_reference', sourceUrl: rec.sourceUrl, detail: `${via}: ${rec.registryId} "${rec.legalName}" is registered as ${src.registryId} (explicit)` }],
        domainAssociations: [], relationships: rec.relationships ?? [],
      });
      candidates.push({ registryId: rec.registryId, providerId: rec.providerId, via: 'registry_cross_reference', outcome: src.role ?? 'subject', detail: `cross-references ${src.registryId}` });
    }
  }
  // Identifiers a record states for the SAME entity in another scheme (SEC → EIN, GLEIF → SIREN/CIN).
  for (const i of [...identities]) {
    const rec = records.get(i.registryId);
    for (const x of rec?.crossReferences ?? []) {
      if (attached.has(x.registryId)) continue;
      attached.add(x.registryId);
      const scheme = x.registryId.split(':')[0];
      identities.push({
        scheme, registryId: x.registryId, provider: registry.providerForScheme(scheme)?.providerId ?? 'other', legalName: rec!.legalName,
        jurisdiction: rec!.jurisdiction, status: null, establishedBy: 'registry_cross_reference', role: i.role, registryVerified: false,
        chain: [{ step: 'registry_cross_reference', sourceUrl: x.sourceUrl, detail: x.detail }], domainAssociations: [],
      });
    }
  }
  // Parents a registry reports explicitly — related entities, never merged.
  for (const i of [...identities]) {
    for (const rel of i.relationships ?? []) {
      if (attached.has(rel.registryId)) continue;
      // CPG-012 LIVE DEFECT (Sasol): the parent of a SITE PUBLISHER may be the company itself —
      // sasol.com names Sasol Financing Limited, whose GLEIF parent is Sasol Limited, the company.
      // As a related_entity, the company's own records would become a MISMATCH. When the reported
      // entity bears the company's name it stays unattached (UNKNOWN, explained): the name only
      // withholds a mismatch, it never establishes identity.
      if (i.role !== 'subject' && namesTheCompany(rel.legalName)) {
        candidates.push({ registryId: rel.registryId, providerId: i.provider, via: 'registry_cross_reference', outcome: 'unconfirmed',
          detail: `${rel.detail} — reported for ${i.registryId} (${i.role}); "${rel.legalName}" bears the company's name and may be the company itself: attached neither as the company nor as a separate entity` });
        continue;
      }
      attached.add(rel.registryId);
      identities.push({
        scheme: rel.registryId.split(':')[0], registryId: rel.registryId, provider: i.provider, legalName: rel.legalName, status: null,
        establishedBy: 'registry_cross_reference', role: 'related_entity', registryVerified: true,
        chain: [{ step: 'registry_relationship', sourceUrl: rel.sourceUrl, detail: rel.detail }], domainAssociations: [],
        relationships: [],
      });
      candidates.push({ registryId: rel.registryId, providerId: i.provider, via: 'registry_cross_reference', outcome: 'related_entity', detail: rel.detail });
    }
  }

  const roleOrder = { subject: 0, site_publisher: 1, related_entity: 2 } as const;
  identities.sort((a, b) => roleOrder[a.role ?? 'subject'] - roleOrder[b.role ?? 'subject'] || byId(a, b));
  candidates.sort((a, b) => byId(a, b) || (a.via < b.via ? -1 : a.via > b.via ? 1 : 0));
  additionalDomains.sort((a, b) => (a.domain < b.domain ? -1 : 1));
  return { selection, references, candidates, identities, additionalDomains, ambiguity };
}

