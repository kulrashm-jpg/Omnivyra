/**
 * OI-B201/B204 — Offering discovery + resolution + adoption bridge (pure, deterministic). Adopts the
 * certified-shadow design: DISCOVER offering seeds from company offering evidence (Company is
 * upstream; Offering seeds from it — Company never owns offering semantics), RESOLVE a stable
 * canonical id (deterministic slug, exact-match dedup — no fuzzy), and PROJECT a seed into canonical
 * evidence + facets on the SHARED spine. Absent fields abstain (never fabricate).
 */

import type { OfferingFacets, OfferingType, EvidenceRef } from './types';
import { facet, evidenceRef } from '../intelligence/canonical';

/** One offering's raw fields (from a company's offering evidence or an external catalog). */
export interface OfferingSeedInput {
  companyId: string;
  asOf: string;
  source?: string;
  name: string;
  offeringType?: OfferingType;
  category?: string;
  positioning?: string;
  valueProposition?: string;
  customerProblems?: string[];
  outcomes?: string[];
  differentiators?: string[];
  features?: string[];
  pricingModel?: string;
  plans?: string[];
  industries?: string[];
  personas?: string[];
  integrations?: string[];
  compliance?: string[];
  lifecycle?: string;
  aliases?: string[];
}

/** Deterministic canonical id: slug of the normalized name (exact — same name ⇒ same offering). */
export function resolveOfferingId(name: string): string {
  return String(name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'offering';
}

/** DISCOVER offering seeds from a company's products/services evidence (Company upstream, no ownership). */
export function discoverOfferingSeeds(input: { companyId: string; asOf: string; source?: string; products?: string[]; services?: string[] }): OfferingSeedInput[] {
  const seeds: OfferingSeedInput[] = [];
  for (const p of input.products ?? []) seeds.push({ companyId: input.companyId, asOf: input.asOf, source: input.source ?? 'company_profile', name: p, offeringType: 'product' });
  for (const s of input.services ?? []) seeds.push({ companyId: input.companyId, asOf: input.asOf, source: input.source ?? 'company_profile', name: s, offeringType: 'service' });
  // Deterministic dedup by canonical id (first wins), then sort by id.
  const seen = new Set<string>();
  return seeds.filter((s) => { const id = resolveOfferingId(s.name); if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((a, b) => resolveOfferingId(a.name).localeCompare(resolveOfferingId(b.name)));
}

const has = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 : v != null && v !== '');

export interface AdoptedOffering { key: { companyId: string; offeringId: string }; facets: Partial<OfferingFacets>; evidence: EvidenceRef[]; offeringType?: OfferingType; }

/** PROJECT one seed into canonical evidence + facets (never fabricates). */
export function offeringFromSeed(seed: OfferingSeedInput): AdoptedOffering {
  const src = seed.source ?? 'offering_seed';
  const id = resolveOfferingId(seed.name);
  const evidence: EvidenceRef[] = [];
  const ev = (label: string, value: string, kind: 'structured' | 'inferred' = 'structured'): EvidenceRef => {
    const e = evidenceRef({ id: `offering:${label}:${src}:${seed.asOf}`, kind, label, value, source: { system: src }, observedAt: seed.asOf, recordedAt: seed.asOf });
    evidence.push(e); return e;
  };
  const facets: Partial<OfferingFacets> = {};
  const one = <T>(cond: boolean, name: keyof OfferingFacets, value: T, evs: EvidenceRef[]) => { if (cond) (facets as any)[name] = facet(value, evs); };

  one(true, 'identity', { canonical_id: id, name: seed.name, aliases: seed.aliases }, [ev('name', seed.name)]);
  one(has(seed.category), 'category', { category: seed.category }, [ev('category', seed.category ?? '')]);
  one(has(seed.positioning), 'positioning', { statement: seed.positioning }, [ev('positioning', seed.positioning ?? '', 'inferred')]);
  one(has(seed.valueProposition), 'valueProposition', { statement: seed.valueProposition }, [ev('value_proposition', seed.valueProposition ?? '')]);
  one(has(seed.customerProblems), 'customerProblems', { problems: seed.customerProblems }, [ev('customer_problems', (seed.customerProblems ?? []).join('; '))]);
  one(has(seed.outcomes), 'outcomes', { outcomes: seed.outcomes }, [ev('outcomes', (seed.outcomes ?? []).join('; '))]);
  one(has(seed.differentiators), 'differentiators', { differentiators: seed.differentiators }, [ev('differentiators', (seed.differentiators ?? []).join('; '))]);
  one(has(seed.features), 'features', { features: seed.features }, [ev('features', (seed.features ?? []).join('; '))]);
  one(has(seed.pricingModel) || has(seed.plans), 'pricing', { model: seed.pricingModel, plans: seed.plans }, [ev('pricing', [seed.pricingModel, ...(seed.plans ?? [])].filter(Boolean).join('; '))]);
  one(has(seed.industries), 'industries', { industries: seed.industries }, [ev('industries', (seed.industries ?? []).join('; '))]);
  one(has(seed.personas), 'personas', { personas: seed.personas }, [ev('personas', (seed.personas ?? []).join('; '))]);
  one(has(seed.integrations), 'integrations', { integrations: seed.integrations }, [ev('integrations', (seed.integrations ?? []).join('; '))]);
  one(has(seed.compliance), 'compliance', { standards: seed.compliance }, [ev('compliance', (seed.compliance ?? []).join('; '))]);
  one(has(seed.lifecycle), 'lifecycle', { stage: seed.lifecycle }, [ev('lifecycle', seed.lifecycle ?? '')]);

  return { key: { companyId: seed.companyId, offeringId: id }, facets, evidence, offeringType: seed.offeringType };
}
