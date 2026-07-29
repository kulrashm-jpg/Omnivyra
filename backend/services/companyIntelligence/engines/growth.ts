/**
 * CI-C303 — Growth Intelligence (deterministic contributor).
 * Aggregates hiring / funding / customer / partnership / expansion / acquisition / revenue signals
 * with freshness + decay → growth facet + a `momentum` contribution. Abstains without signals.
 */

import type { CompanyEngineOutput, CompanyIntelligenceContext, CompanySignalType } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { facet, mkEvidence, decayFactor, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const ENGINE = 'growth';
const WEIGHT: Record<CompanySignalType, number> = {
  funding: 0.9, acquisition: 0.85, expansion: 0.8, exec_hire: 0.7, hiring: 0.65, partnership: 0.6,
  customer_announcement: 0.6, product_launch: 0.55, geo_expansion: 0.7, revenue: 0.75, market_activity: 0.4,
};
const HALFLIFE: Record<CompanySignalType, number> = {
  funding: 180, acquisition: 180, expansion: 120, exec_hire: 120, hiring: 90, partnership: 90,
  customer_announcement: 90, product_launch: 60, geo_expansion: 120, revenue: 120, market_activity: 30,
};

export function runGrowth(ctx: CompanyIntelligenceContext): CompanyEngineOutput {
  const signals = ctx.signals ?? [];
  if (!signals.length) return emptyOutput(ENGINE);
  const out = { ...emptyOutput(ENGINE), abstained: false, facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as CompanyEngineOutput;
  const evidence: EvidenceRef[] = signals.map((s) => mkEvidence(ENGINE, { label: `signal:${s.type}`, value: s.detail ?? s.type, source: s.source, observedAt: s.observedAt, kind: 'external', weight: clamp01((WEIGHT[s.type] ?? 0.4) * (s.confidence ?? 1)) }));
  out.evidence = evidence;

  let num = 0, den = 0, freshest = 0;
  for (const s of signals) { const w = (WEIGHT[s.type] ?? 0.4) * (s.confidence ?? 1); const d = decayFactor(s.observedAt, ctx.asOf, HALFLIFE[s.type] ?? 30); num += w * d; den += w; freshest = Math.max(freshest, d); }
  const momentum = den > 0 ? clamp01(num / den) : null;
  if (momentum !== null) out.contributions.push({ dimension: 'momentum', contributor: ENGINE, method: 'deterministic', value: momentum, confidence: clamp01(0.4 + 0.15 * Math.min(signals.length, 4)), evidence, asOf: ctx.asOf });
  out.facets.growth = facet({ trajectory: freshest > 0.6 ? 'accelerating' : freshest > 0.3 ? 'steady' : 'slow', expansion: signals.filter((s) => /expansion|geo/.test(s.type)).map((s) => s.type) }, evidence);
  out.reasoning.push(reasoningTrace({ claim: 'growth_momentum', conclusion: momentum, because: evidence, confidence: clamp01(0.4 + 0.1 * Math.min(signals.length, 5)), method: 'deterministic', assumptions: ['weighted signal decay'], unknowns: [] }));
  return out;
}
