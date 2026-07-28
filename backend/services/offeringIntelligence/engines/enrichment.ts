/**
 * OI-D401 — Advanced Offering Enrichment (deterministic contributor). Editions / regional
 * availability / release channels / feature flags / ecosystem maturity / marketplace presence /
 * developer adoption / customer success / implementation complexity / onboarding maturity →
 * ecosystem + adoption facets + `maturity`/`adoption` contributions. Every field carries evidence +
 * provenance. Abstains without enrichment.
 */

import type { OfferingEngineOutput, OfferingIntelligenceContext, OfferingEnrichmentInput } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'enrichment';
const ord = (v?: string): number => { const s = (v ?? '').toLowerCase(); if (/high|strong|mature|broad/.test(s)) return 1; if (/medium|moderate|growing/.test(s)) return 0.6; if (/low|weak|early|complex/.test(s)) return 0.3; return 0.5; };

export function runEnrichment(ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const e = ctx.enrichment; if (!e) return emptyOutput(ENGINE, 'market');
  const src = e.source ?? 'enrichment_provider', at = e.observedAt ?? ctx.asOf;
  const ev: EvidenceRef[] = [];
  const addL = (l: string, a?: string[]) => { if (a?.length) ev.push(mkEvidence(ENGINE, { label: l, value: a.join('; '), source: src, observedAt: at, kind: 'external' })); };
  const addS = (l: string, v?: string) => { if (v) ev.push(mkEvidence(ENGINE, { label: l, value: v, source: src, observedAt: at, kind: 'external' })); };
  addL('enrich:editions', e.editions); addL('enrich:regional', e.regionalAvailability); addL('enrich:channels', e.releaseChannels); addL('enrich:flags', e.featureFlags); addL('enrich:marketplace', e.marketplacePresence);
  addS('enrich:ecosystem', e.ecosystemMaturity); addS('enrich:developer', e.developerAdoption); addS('enrich:customer_success', e.customerSuccess); addS('enrich:complexity', e.implementationComplexity); addS('enrich:onboarding', e.onboardingMaturity);
  if (!ev.length) return emptyOutput(ENGINE, 'market');

  const o = { ...emptyOutput(ENGINE, 'market'), abstained: false, facets: {}, contributions: [], evidence: ev, edges: [], reasoning: [] } as OfferingEngineOutput;
  if (e.marketplacePresence?.length || e.ecosystemMaturity) o.facets.ecosystem = facet({ partners: [...(e.marketplacePresence ?? [])] }, ev.filter((x) => /marketplace|ecosystem/.test(x.label)));
  if (e.developerAdoption || e.customerSuccess) o.facets.adoption = facet({ level: e.customerSuccess ?? e.developerAdoption, usage: [e.developerAdoption, e.customerSuccess].filter(Boolean) as string[] }, ev.filter((x) => /developer|customer_success/.test(x.label)));

  const maturity = clamp01(0.4 * ord(e.ecosystemMaturity) + 0.3 * ord(e.onboardingMaturity) + 0.3 * (1 - ord(e.implementationComplexity)));
  const adoption = clamp01(0.5 * ord(e.developerAdoption) + 0.5 * ord(e.customerSuccess));
  o.contributions.push({ dimension: 'maturity', contributor: ENGINE, method: 'deterministic', value: maturity, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.contributions.push({ dimension: 'adoption', contributor: ENGINE, method: 'deterministic', value: adoption, confidence: clamp01(0.4 + 0.1 * Math.min(ev.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'ecosystem_maturity', conclusion: maturity, because: ev, confidence: 0.55, method: 'deterministic', assumptions: ['ecosystem/onboarding/complexity + developer/customer success'], unknowns: [] }));
  return o;
}
