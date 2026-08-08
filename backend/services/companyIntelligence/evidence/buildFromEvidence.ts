/**
 * COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · U1 — Build canonical CompanyUnderstanding from EVIDENCE.
 *
 * Ingests evidence from every adapter, resolves it with the certified policy-driven fusion
 * (`fuseEvidence` — dedup + source-weighting + contradiction detection), then populates canonical facets by
 * selecting, per attribute, the highest EFFECTIVE-weight evidence (weight × freshness decay). No provider-
 * name truth logic (`if source === X`) — resolution is `weight`/`kind`/`freshness`/`agreement` only. Absent
 * evidence ⇒ the facet abstains (never fabricated). Reuses the sole owner `buildCompanyUnderstanding`.
 * Pure + deterministic (timestamps passed in). Shadow-only: consumed by nothing in production.
 */

import { fuseEvidence, facet, decayFactor } from '../../intelligence/canonical';
import type { EvidenceRef, ContradictionRef } from '../../intelligence/canonical';
import type { CompanyFacets, CompanyWorldView, CompanyUnderstanding } from '../types';
import { buildCompanyUnderstanding } from '../builder';
import { ingestCompanyEvidence, type EvidenceSources } from './adapters';

const HALF_LIFE_DAYS = 180;

/** Deterministic source-trust POLICY (data, overridable) — never `if source === X` branching. */
export const COMPANY_SOURCE_WEIGHTS: Record<string, number> = {
  company_profile: 0.9,
  website_capture: 0.85,
  ai_extraction: 0.55,
  linkedin: 0.7,
  crunchbase: 0.65,
  public_registry: 0.6,
  trusted_public: 0.5,
  wikidata: 0.4,

  // ── WS-4F: the enrichment vendors, which emit evidence under their PROVIDER ID ────────────────
  // `toFirmographicInputs` sets `system: field.provider`, so a vendor's evidence arrives as
  // `clearbit` / `builtwith` / … — names this policy did not contain. `fuseEvidence` resolves an
  // unlisted system to its 0.5 fallback, so five of the six vendors were fused identically and the
  // per-vendor calibration the adapters document was discarded at fusion: Clearbit ("a stronger
  // claim than Apollo's") and Apollo ("self-reported: a materially weaker claim") both landed on
  // 0.35 for headcount, leaving a genuine disagreement to be settled by the id tie-break rather
  // than by trust. These entries restore the adapters' stated judgement as POLICY DATA — no
  // branching, no new logic, and `crunchbase` keeps the value it already had.
  //
  // Every value sits strictly below `company_profile`, so a user-provided fact still outranks any
  // vendor claim about the same label. `industry` is the only label where they compete:
  // company_profile 0.7×0.9 = 0.63 beats clearbit 0.75×0.80 = 0.60, which is the intended ordering.
  builtwith: 0.85,       // OBSERVED off the live site — the strongest vendor claim here
  clearbit: 0.8,         // strong, well-normalised company records
  peopledatalabs: 0.75,  // strong headcount and size bands
  apollo: 0.65,          // broad coverage, but headcount is self-reported
  hunter: 0.55,          // email-pattern discovery; identity corroboration only
};

export interface LabelResolution { value: string | null; evidence: EvidenceRef[]; winner: EvidenceRef | null; }

/** Per-attribute winner = max(weight × freshness-decay). Abstains (value null) when no evidence. */
function resolveLabel(fused: EvidenceRef[], label: string, asOf: string): LabelResolution {
  const cands = fused.filter((e) => e.label === label);
  if (cands.length === 0) return { value: null, evidence: [], winner: null };
  const scored = cands.map((e) => ({ e, eff: (e.weight ?? 0.5) * decayFactor(e.observedAt, asOf, HALF_LIFE_DAYS) }));
  scored.sort((a, b) => b.eff - a.eff || b.e.observedAt.localeCompare(a.e.observedAt) || a.e.id.localeCompare(b.e.id));
  const winner = scored[0].e;
  return { value: winner.value == null ? null : String(winner.value), evidence: cands, winner };
}

const splitList = (v: string | null): string[] => (v == null || v === '' ? [] : v.split(';').map((s) => s.trim()).filter(Boolean));
const undef = (v: string | null): string | undefined => (v == null || v === '' ? undefined : v);

export interface EvidenceBuild {
  facets: Partial<CompanyFacets>;
  evidence: EvidenceRef[];
  worldView: CompanyWorldView;
  contradictions: ContradictionRef[];
}

/** Ingest → fuse → resolve → populate facets (evidence-derived, abstaining, policy-driven). */
export function companyFromEvidence(sources: EvidenceSources, asOf: string): EvidenceBuild {
  const raw = ingestCompanyEvidence(sources);
  const fusion = fuseEvidence(raw, { sourceWeights: COMPANY_SOURCE_WEIGHTS });
  const fused = fusion.fused;
  const r = (label: string) => resolveLabel(fused, label, asOf);

  const facets: Partial<CompanyFacets> = {};
  const contrasFor = (evs: EvidenceRef[]): ContradictionRef[] => {
    const ids = new Set(evs.map((e) => e.id));
    return fusion.contradictions.filter((c) => ids.has(c.a) || ids.has(c.b));
  };
  const set = <K extends keyof CompanyFacets>(name: K, value: CompanyFacets[K]['value'], evidence: EvidenceRef[]) => {
    if (evidence.length > 0) (facets as Record<string, unknown>)[name] = facet(value, evidence, { contradictions: contrasFor(evidence) });
  };

  // WS-4 Phase-3: `legal_name` is added here because `IdentityValue.legalName` was already declared
  // and never populated — the field existed, the wiring did not.
  const name = r('name'), domain = r('domain'), founded = r('founded_year'), legalName = r('legal_name');
  set('identity', { name: undef(name.value), domain: undef(domain.value), legalName: undef(legalName.value), foundedYear: undef(founded.value) }, [...name.evidence, ...domain.evidence, ...legalName.evidence, ...founded.evidence]);

  const products = r('products'), services = r('services');
  set('offerings', { products: splitList(products.value), services: splitList(services.value) }, [...products.evidence, ...services.evidence]);

  const sol = r('solution_domains'), category = r('category'), positioning = r('positioning'), diff = r('differentiators');
  set('marketPosition', { segment: undef(sol.value) ?? undef(category.value), positioning: undef(positioning.value), differentiators: splitList(diff.value) }, [...sol.evidence, ...category.evidence, ...positioning.evidence, ...diff.evidence]);

  const competitors = r('competitors'); // abstains when no competitor evidence (honest empty-state)
  set('competitive', { competitors: splitList(competitors.value) }, competitors.evidence);

  const segments = r('segments');
  set('customers', { segments: splitList(segments.value) }, segments.evidence);

  const headcount = r('headcount'), size = r('size');
  set('organization', { headcount: undef(headcount.value), size: undef(size.value) }, [...headcount.evidence, ...size.evidence]);

  const revenue = r('revenue_band');
  set('financial', { revenueBand: undef(revenue.value) }, revenue.evidence);

  const funding = r('funding_stage'), totalRaised = r('total_raised'), lastRound = r('last_funding_at');
  set('funding', { stage: undef(funding.value), totalRaised: undef(totalRaised.value), lastRound: undef(lastRound.value) },
    [...funding.evidence, ...totalRaised.evidence, ...lastRound.evidence]);

  const hq = r('hq'), country = r('country');
  set('geography', { hq: undef(hq.value), country: undef(country.value) }, [...hq.evidence, ...country.evidence]);

  // ── WS-4 Phase-3: facets that were declared but never reachable from evidence ───────────────────
  // Each of these facets already existed in CompanyFacets and each label already flowed through
  // fusion; what was missing was the selection step, so the evidence terminated at fusion instead of
  // populating a facet. `set` still abstains when no evidence exists, so a company with no provider
  // data produces exactly the facets it did before.
  const technologies = r('technologies');
  set('technology', { stack: splitList(technologies.value) }, technologies.evidence);

  const openRoles = r('open_roles'), hiringDepartments = r('hiring_departments');
  set('hiring', { openRoles: splitList(openRoles.value), growthFunctions: splitList(hiringDepartments.value) },
    [...openRoles.evidence, ...hiringDepartments.evidence]);

  const linkedinHandle = r('linkedin_handle');
  set('digitalPresence', { channels: splitList(linkedinHandle.value) }, linkedinHandle.evidence);

  const solDomains = splitList(sol.value);
  const worldView: CompanyWorldView = {
    category: undef(category.value),
    businessModel: undef(r('business_model').value),          // Policy B — evidence-derived
    primaryMotion: undef(r('operating_model').value),         // Policy A — abstains (no evidence)
    marketPosition: undef(r('domain_role').value),            // Policy A — abstains (no evidence)
    providerType: undef(r('provider_type').value),            // Policy B — evidence-derived
    solutionDomains: solDomains.length ? solDomains : undefined, // Policy B — evidence-derived
  };

  return { facets, evidence: fused, worldView, contradictions: fusion.contradictions };
}

/** The evidence-derived canonical understanding (sole owner reused). Deterministic (asOf passed in). */
export function buildCompanyUnderstandingFromEvidence(sources: EvidenceSources, asOf: string): CompanyUnderstanding {
  const b = companyFromEvidence(sources, asOf);
  return buildCompanyUnderstanding({ key: { companyId: sources.profile?.companyId ?? sources.website?.companyId ?? sources.ai?.companyId ?? 'unknown' }, builtAt: asOf, facets: b.facets, evidence: b.evidence, worldView: b.worldView });
}

// ── Explainability: Field → Facet → EvidenceRefs → Resolution Policy → Final Value ────────────────
const FIELD_TO_LABEL: Record<string, { facet: string; label: string; list?: boolean }> = {
  name: { facet: 'identity', label: 'name' },
  domain: { facet: 'identity', label: 'domain' },
  category: { facet: 'worldView', label: 'category' },
  operating_model: { facet: 'worldView', label: 'operating_model' },
  domain_role: { facet: 'worldView', label: 'domain_role' },
  solution_domains: { facet: 'marketPosition', label: 'solution_domains', list: true },
  products: { facet: 'offerings', label: 'products', list: true },
  services: { facet: 'offerings', label: 'services', list: true },
  competitors: { facet: 'competitive', label: 'competitors', list: true },
  founded_year: { facet: 'identity', label: 'founded_year' },
  revenue_band: { facet: 'financial', label: 'revenue_band' },
  headcount: { facet: 'organization', label: 'headcount' },
  // WS-4 Phase-3 — explainability must cover the newly reachable fields, or a value could be shown
  // in a facet with no way to ask which evidence produced it.
  legal_name: { facet: 'identity', label: 'legal_name' },
  total_raised: { facet: 'funding', label: 'total_raised' },
  last_funding_at: { facet: 'funding', label: 'last_funding_at' },
  country: { facet: 'geography', label: 'country' },
  technologies: { facet: 'technology', label: 'technologies', list: true },
  open_roles: { facet: 'hiring', label: 'open_roles', list: true },
  hiring_departments: { facet: 'hiring', label: 'hiring_departments', list: true },
  linkedin_handle: { facet: 'digitalPresence', label: 'linkedin_handle', list: true },
};

export interface FieldExplanation {
  field: string;
  facet: string;
  evidence: EvidenceRef[];
  resolution: { policy: string; winnerId: string | null; winnerSource: string | null; sourceWeights: Record<string, number> };
  finalValue: unknown;
}

/** Produce the full explainability chain for a projected field. */
export function explainCompanyField(sources: EvidenceSources, asOf: string, field: string): FieldExplanation {
  const map = FIELD_TO_LABEL[field];
  if (!map) return { field, facet: 'unknown', evidence: [], resolution: { policy: 'weight×freshness×kind', winnerId: null, winnerSource: null, sourceWeights: COMPANY_SOURCE_WEIGHTS }, finalValue: null };
  const fusion = fuseEvidence(ingestCompanyEvidence(sources), { sourceWeights: COMPANY_SOURCE_WEIGHTS });
  const res = resolveLabel(fusion.fused, map.label, asOf);
  return {
    field,
    facet: map.facet,
    evidence: res.evidence,
    resolution: { policy: 'winner = max(weight × freshnessDecay); contradictions preserved; abstain when empty', winnerId: res.winner?.id ?? null, winnerSource: res.winner?.source.system ?? null, sourceWeights: COMPANY_SOURCE_WEIGHTS },
    finalValue: map.list ? splitList(res.value) : res.value,
  };
}
