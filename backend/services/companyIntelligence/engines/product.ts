/**
 * CI-C302 — Product & Offering Intelligence (deterministic contributor).
 * Products / services / pricing / positioning / differentiators / maturity / roadmap → offerings +
 * marketPosition facets + a `market_authority` contribution (differentiation proxy). Contributes to
 * Product/Offering facets only. Abstains without product evidence.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'product';

export function runProduct(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const p = ctx.product;
  if (!p) return emptyOutput(ENGINE);
  const src = p.source ?? 'product_intelligence'; const at = p.observedAt ?? ctx.asOf;
  const evidence: EvidenceRef[] = [];
  const add = (label: string, v?: string | string[]) => { const s = Array.isArray(v) ? v.join('; ') : v; if (s) evidence.push(mkEvidence(ENGINE, { label, value: s, source: src, observedAt: at, kind: 'structured' })); };
  add('product:products', p.products); add('product:services', p.services); add('product:pricing', p.pricing);
  add('product:positioning', p.positioning); add('product:differentiators', p.differentiators); add('product:maturity', p.maturity); add('product:roadmap', p.roadmapSignals);
  if (!evidence.length) return emptyOutput(ENGINE);

  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence, edges: [], reasoning: [] } as CompanyEngineOutput;
  out.facets.offerings = facet({ products: p.products, services: p.services }, evidence.filter((e) => /products|services/.test(e.label)));
  out.facets.marketPosition = facet({ positioning: p.positioning, differentiators: p.differentiators }, evidence.filter((e) => /positioning|differentiators/.test(e.label)));
  const authority = clamp01((p.differentiators?.length ? 0.5 : 0.2) + (p.positioning ? 0.3 : 0) + Math.min((p.products?.length ?? 0) / 10, 0.2));
  out.contributions.push({ dimension: 'market_authority', contributor: ENGINE, method: 'deterministic', value: authority, confidence: clamp01(0.4 + 0.1 * Math.min(evidence.length, 4)), evidence, asOf: at });
  out.reasoning.push(reasoningTrace({ claim: 'product_differentiation', conclusion: authority, because: evidence, confidence: 0.6, method: 'deterministic', assumptions: ['differentiators + positioning + breadth'], unknowns: p.roadmapSignals?.length ? [] : ['no roadmap signal'] }));
  return out;
}
