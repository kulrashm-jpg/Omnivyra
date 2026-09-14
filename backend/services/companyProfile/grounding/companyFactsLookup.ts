/**
 * CPG-012 — the Company Profile facts lookup, grounded.
 *
 * The "Fill from Wikidata" action used to take the first Wikidata search hit for
 * the brand NAME and prefill its founded year, team size and revenue band — a
 * same-name organisation's facts landed in the form as the company's own. This
 * module is what that action now calls. It adds no identity rules and no
 * states of its own:
 *
 *   orchestrateGrounding          identity first (the company's website, its
 *                                 legal notice, registries, GLEIF), then the
 *                                 Wikidata source, then the CPG resolver;
 *   PUBLICLY_VERIFIED only        a fact is prefilled only when the resolver
 *                                 found enough evidence for it AND that evidence
 *                                 is tied to this company (DECISIVE identity).
 *                                 A name match, a different organisation, or a
 *                                 single source below the field's evidence bar
 *                                 prefills nothing;
 *   CPG terms in the response     statuses, identity classes, authority and the
 *                                 registry provenance are CPG's own, carried
 *                                 unchanged for the next accessibility slice.
 *
 * Request-scoped: nothing is persisted (the grounding tables do not exist in
 * production, and this read needs none of them).
 */

import type { ClaimStatus, EntitySignals, GroundedField, IdentityClass, RegistryIdentity } from './types';
import { orchestrateGrounding, type OrchestrationResult } from './acquisition/orchestrator';
import { createWikidataSource, type WikidataLookup } from './acquisition/wikidataSource';
import type { EvidenceFetcher } from './acquisition/evidenceSource';
import { normalizeDomain } from './entityResolution';
import { defaultProviderRegistry } from './registry/builtins';
import { normalizeCanonicalWebsite } from '../../../../utils/companyProfileValidation';

/** The facts the Company Profile form shows, and the CPG field each is grounded as. */
export const COMPANY_FACT_FIELDS = Object.freeze({
  founded_year: 'founded_year',
  team_size: 'employee_count',
  revenue_range: 'revenue_range',
} as const);
export type CompanyFactKey = keyof typeof COMPANY_FACT_FIELDS;
const FACT_LABEL: Record<CompanyFactKey, string> = { founded_year: 'founded year', team_size: 'team size', revenue_range: 'revenue range' };

export interface FactEvidenceView {
  value: string;
  sourceName: string;
  sourceUrl: string | null;
  identity: IdentityClass;
  identityReason: string;
  authority: string;
  providerFamily: string | null;
}
export interface FactGroundingView {
  field: string;
  status: ClaimStatus;
  evidenceState: string | null;
  effectiveValue: string | null;
  /** True only for PUBLICLY_VERIFIED — the one state the form may be prefilled from. */
  prefilled: boolean;
  evidence: FactEvidenceView[];
}
export interface RegistryIdentityView {
  provider: string;
  registry: string | null;
  scheme: string;
  identifier: string;
  jurisdiction: string | null;
  legalName: string | null;
  registryStatus: string | null;
  role: string;
  /** True only when the registry's own record was read. */
  verified: boolean;
  establishedBy: RegistryIdentity['establishedBy'];
}
export interface CompanyFactsLookupResponse {
  facts: Record<CompanyFactKey, string | null>;
  /** The Wikidata label ONLY when that entity is tied to the company; null otherwise. */
  matched_label: string | null;
  source: 'cpg_grounding';
  grounding: {
    domain: string | null;
    asOf: string;
    facts: Record<CompanyFactKey, FactGroundingView>;
    wikidata: { label: string; url: string | null; identity: IdentityClass; identityReason: string } | null;
    registryIdentities: RegistryIdentityView[];
    /** Registries that could not be read, as CPG recorded them (inaccessible, credential_required, …). */
    registryUnavailable: { provider: string; identifier: string; outcome: string; failure: string | null }[];
    /** CPG's own record of identifiers it refused to attach because several different entities claimed the same role. */
    registryAmbiguity: string[];
    unavailableSources: { sourceId: string; state: string; reason: string | null }[];
    /** Plain statements for the existing UI message. Never claims more than the statuses above. */
    message: { basis: string | null; identityNote: string | null; notPrefilled: string[]; nothingPrefilled: string };
  };
}

export interface CompanyFactsLookupInput {
  companyId: string;
  companyName: string | null | undefined;
  websiteUrl: string | null | undefined;
  linkedinUrl?: string | null;
  asOf: string;
  fetcher: EvidenceFetcher;
  /** Injectable for tests; production uses the Wikidata adapter. */
  wikidataLookup?: WikidataLookup;
}

export async function lookupGroundedCompanyFacts(input: CompanyFactsLookupInput): Promise<CompanyFactsLookupResponse> {
  const canonical = normalizeCanonicalWebsite(input.websiteUrl ?? '');
  const domain = canonical ? normalizeDomain(canonical) : null;
  const name = (input.companyName ?? '').trim();
  const knownEntity: EntitySignals = {
    companyName: name, domain, linkedinUrl: input.linkedinUrl ?? null,
    location: null, leadership: [], registryId: null,
  };
  const result = await orchestrateGrounding({
    companyId: input.companyId, knownEntity, companyDomain: domain,
    userClaims: [], fieldsOfInterest: Object.values(COMPANY_FACT_FIELDS),
    sources: [input.wikidataLookup ? createWikidataSource(input.wikidataLookup) : createWikidataSource()],
    fetcher: input.fetcher, asOf: input.asOf,
  });
  return toResponse(result, domain, name);
}

function toResponse(result: OrchestrationResult, domain: string | null, companyName: string): CompanyFactsLookupResponse {
  const byField = new Map(result.fields.map((g) => [g.field, g]));
  const registry = defaultProviderRegistry();

  const facts = {} as Record<CompanyFactKey, string | null>;
  const factViews = {} as Record<CompanyFactKey, FactGroundingView>;
  for (const key of Object.keys(COMPANY_FACT_FIELDS) as CompanyFactKey[]) {
    const g = byField.get(COMPANY_FACT_FIELDS[key]);
    const view = factView(COMPANY_FACT_FIELDS[key], g);
    factViews[key] = view;
    facts[key] = view.prefilled ? view.effectiveValue : null;
  }

  const wikidata = wikidataIdentity(result.fields);
  const registryIdentities: RegistryIdentityView[] = (result.knownEntity.registryIdentities ?? []).map((i) => ({
    provider: i.provider, registry: registry.provider(i.provider)?.registryName ?? null,
    scheme: i.scheme, identifier: i.registryId, jurisdiction: i.jurisdiction ?? null, legalName: i.legalName,
    registryStatus: i.status ?? null, role: i.role ?? 'subject', verified: i.registryVerified, establishedBy: i.establishedBy,
  }));
  const registryUnavailable = (result.identity?.registry?.candidates ?? [])
    .filter((c) => c.failure || ['inaccessible', 'credential_required', 'not_implemented', 'record_unavailable'].includes(c.outcome))
    .map((c) => ({ provider: c.providerId, identifier: c.registryId, outcome: c.outcome, failure: c.failure ?? null }));
  const unavailableSources = result.sourceOutcomes
    .filter((o) => o.state !== 'retrieved')
    .map((o) => ({ sourceId: o.sourceId, state: o.state, reason: o.reason ?? null }));

  return {
    facts,
    matched_label: wikidata?.identity === 'DECISIVE' ? wikidata.label : null,
    source: 'cpg_grounding',
    grounding: {
      domain, asOf: result.asOf, facts: factViews, wikidata, registryIdentities, registryUnavailable,
      registryAmbiguity: [...(result.identity?.registry?.ambiguity ?? [])], unavailableSources,
      message: messageFor(domain, companyName, factViews, wikidata, registryIdentities,
        result.sourceOutcomes.find((o) => o.sourceId === 'wikidata') ?? null),
    },
  };
}

function factView(field: string, g: GroundedField | undefined): FactGroundingView {
  if (!g) return { field, status: 'UNVERIFIED', evidenceState: null, effectiveValue: null, prefilled: false, evidence: [] };
  const evidence = g.evidence.map((e) => {
    const m = g.entityMatches?.[e.claimId] ?? g.entityMatch;
    const a = g.sourceAttribution?.[e.claimId];
    return {
      value: e.value, sourceName: e.sourceName, sourceUrl: e.sourceUrl,
      identity: m.identity ?? 'UNKNOWN', identityReason: m.reason ?? '',
      authority: a?.authority ?? 'unrated', providerFamily: a?.family ?? null,
    };
  });
  const prefilled = g.status === 'PUBLICLY_VERIFIED' && !!g.effectiveValue;
  return { field, status: g.status, evidenceState: g.adjudication?.evidenceState ?? null, effectiveValue: g.effectiveValue, prefilled, evidence };
}

/** Wikidata's identity for THIS company, read from the resolver's own entity match. */
function wikidataIdentity(fields: GroundedField[]): CompanyFactsLookupResponse['grounding']['wikidata'] {
  for (const g of fields) {
    for (const e of g.evidence) {
      if (e.sourceName !== 'Wikidata') continue;
      const m = g.entityMatches?.[e.claimId] ?? g.entityMatch;
      return { label: e.entitySignals.companyName ?? e.value, url: e.sourceUrl, identity: m.identity ?? 'UNKNOWN', identityReason: m.reason ?? '' };
    }
  }
  return null;
}

function messageFor(
  domain: string | null,
  companyName: string,
  facts: Record<CompanyFactKey, FactGroundingView>,
  wikidata: CompanyFactsLookupResponse['grounding']['wikidata'],
  identities: RegistryIdentityView[],
  wikidataOutcome: OrchestrationResult['sourceOutcomes'][number] | null,
): CompanyFactsLookupResponse['grounding']['message'] {
  const keys = Object.keys(facts) as CompanyFactKey[];
  const anyPrefilled = keys.some((k) => facts[k].prefilled);
  const basis = anyPrefilled && wikidata && domain
    ? `Wikidata entry "${wikidata.label}" is tied to ${domain} by its official website`
    : null;

  // Only a legal entity whose registry record was actually read, and which is the company itself.
  const subject = identities.find((i) => i.role === 'subject' && i.verified);
  const identityNote = subject
    ? `Legal entity on record: ${subject.legalName ?? subject.identifier} (${subject.scheme} ${subject.identifier.slice(subject.scheme.length + 1)}, ${subject.registry ?? subject.provider}).`
    : null;

  // Observed values are named only when the evidence is tied to this company.
  const notPrefilled: string[] = [];
  for (const k of keys) {
    const f = facts[k];
    if (f.prefilled) continue;
    const tied = f.evidence.filter((e) => e.identity === 'DECISIVE');
    if (f.status === 'CONFLICTING' && tied.length > 0) {
      notPrefilled.push(`${cap(FACT_LABEL[k])}: public sources tied to your company disagree — not filled.`);
    } else if (tied.length > 0) {
      notPrefilled.push(`${cap(FACT_LABEL[k])}: ${tied[0].sourceName} lists ${tied[0].value}, but that is below the evidence needed to confirm it — not filled.`);
    }
  }

  let nothingPrefilled: string;
  if (!domain) {
    nothingPrefilled = 'Your profile has no website, so public records cannot be tied to your company. Nothing was filled.';
  } else if (!wikidata) {
    // Say what actually happened: the name lookup found no organisation, was switched off, or failed.
    nothingPrefilled = wikidataOutcome?.state === 'errored'
      ? 'Public records could not be checked right now. Nothing was filled.'
      : wikidataOutcome?.reason === 'no_credential'
        ? 'Wikidata lookups are switched off, so there was nothing to check. Nothing was filled.'
        : `The Wikidata lookup for "${companyName}" returned no organisation, so there was nothing to check against ${domain}. Nothing was filled.`;
  } else if (wikidata.identity === 'MISMATCH') {
    // Not "a different organisation": the entity may be this company under its other sites.
    nothingPrefilled = `Wikidata's "${wikidata.label}" lists official websites that do not include ${domain}, so it could not be confirmed as your company. Nothing was filled.`;
  } else if (wikidata.identity !== 'DECISIVE') {
    nothingPrefilled = `Wikidata has an entry named "${wikidata.label}", but it could not be tied to ${domain}, so it was not used. Nothing was filled.`;
  } else {
    nothingPrefilled = `Wikidata's "${wikidata.label}" is tied to ${domain}, but none of these facts had enough evidence to be confirmed. Nothing was filled.`;
  }
  return { basis, identityNote, notPrefilled, nothingPrefilled };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
