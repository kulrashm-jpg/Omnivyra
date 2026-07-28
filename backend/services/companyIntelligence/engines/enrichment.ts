/**
 * CI-D404 — Advanced Company Enrichment (deterministic contributor). Subsidiaries / acquisitions /
 * certifications / patents / trademarks / regulatory registrations / standards / research / open-
 * source / developer + community ecosystem / sustainability → corporateStructure / brand /
 * strategicInitiatives facets + a `maturity` contribution. Every field carries evidence + provenance.
 * Abstains without enrichment.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext, CompanyEnrichmentInput } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'enrichment';
const LIST_FIELDS: Array<keyof CompanyEnrichmentInput> = ['subsidiaries', 'acquisitions', 'certifications', 'patents', 'trademarks', 'regulatoryRegistrations', 'standards', 'research', 'openSource', 'developerEcosystem', 'communityEcosystem', 'sustainability'];

export function runEnrichment(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const e = ctx.enrichment;
  if (!e) return emptyOutput(ENGINE);
  const src = e.source ?? 'enrichment_provider'; const at = e.observedAt ?? ctx.asOf;
  const evidence: EvidenceRef[] = [];
  for (const key of LIST_FIELDS) { const arr = e[key] as string[] | undefined; if (arr?.length) evidence.push(mkEvidence(ENGINE, { label: `enrich:${key}`, value: arr.join('; '), source: src, observedAt: at, kind: 'external' })); }
  if (!evidence.length) return emptyOutput(ENGINE);

  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence, edges: [], reasoning: [] } as CompanyEngineOutput;
  const evFor = (labels: string[]) => evidence.filter((x) => labels.some((l) => x.label === `enrich:${l}`));
  if (e.subsidiaries?.length || e.acquisitions?.length) out.facets.corporateStructure = facet({ subsidiaries: e.subsidiaries, ownership: e.acquisitions?.length ? 'acquisitive' : undefined }, evFor(['subsidiaries', 'acquisitions']));
  if (e.sustainability?.length || e.communityEcosystem?.length || e.openSource?.length) out.facets.brand = facet({ themes: [...(e.sustainability ?? []), ...(e.communityEcosystem ?? []), ...(e.openSource ?? [])] }, evFor(['sustainability', 'communityEcosystem', 'openSource']));
  if (e.research?.length || e.developerEcosystem?.length) out.facets.strategicInitiatives = facet({ initiatives: [...(e.research ?? []), ...(e.developerEcosystem ?? [])] }, evFor(['research', 'developerEcosystem']));

  // Operational maturity proxy: certifications + standards + patents/trademarks + regulatory breadth.
  const maturity = clamp01(((e.certifications?.length ?? 0) + (e.standards?.length ?? 0) + (e.patents?.length ?? 0) + (e.regulatoryRegistrations?.length ?? 0)) / 8);
  out.contributions.push({ dimension: 'maturity', contributor: ENGINE, method: 'deterministic', value: maturity, confidence: clamp01(0.4 + 0.1 * Math.min(evidence.length, 4)), evidence, asOf: at });
  out.reasoning.push(reasoningTrace({ claim: 'operational_maturity', conclusion: maturity, because: evidence, confidence: 0.55, method: 'deterministic', assumptions: ['certifications/standards/patents/regulatory breadth'], unknowns: [] }));
  return out;
}
