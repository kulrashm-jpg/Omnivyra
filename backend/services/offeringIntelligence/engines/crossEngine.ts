/**
 * OI-C313 — Cross-Engine Reasoning (synthesis only; owns nothing). Synthesizes evidence ALREADY
 * produced by the engines into higher-order conclusions:
 *   feature + pricing + ICP fit → high market fit; differentiation + lifecycle growth + adoption →
 *   emerging category leader; integrations + compliance + packaging → enterprise readiness;
 *   roadmap + adoption + outcomes → expansion opportunity. Grounded; never re-owns.
 */

import type { OfferingEngineOutput, OfferingIntelligenceContext } from './engineTypes';
import { emptyOutput } from './engineTypes';
import { reasoningTrace, clamp01 } from '../../intelligence/canonical';
import type { EvidenceRef, ReasoningTrace } from '../../intelligence/canonical';

export function runCrossEngine(primaries: OfferingEngineOutput[], ctx: OfferingIntelligenceContext): OfferingEngineOutput {
  const o = { ...emptyOutput('cross_engine', 'synthesis'), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as OfferingEngineOutput;
  const traces: ReasoningTrace[] = [];
  const evOf = (engine: string) => primaries.find((p) => p.engine === engine)?.evidence ?? [];
  const add = (claim: string, engines: string[], conf: number, assumptions: string[]) => {
    const because: EvidenceRef[] = engines.flatMap(evOf);
    if (because.length === 0) return;
    traces.push(reasoningTrace({ claim, conclusion: 'indicated', because, confidence: clamp01(conf), method: 'deterministic', assumptions, unknowns: [] }));
  };
  add('high_market_fit', ['feature', 'pricing', 'market_fit'], 0.6, ['feature breadth + pricing alignment + ICP fit']);
  add('emerging_category_leader', ['positioning', 'lifecycle', 'adoption'], 0.55, ['differentiation + lifecycle growth + adoption momentum']);
  add('enterprise_readiness', ['integration', 'compliance', 'packaging'], 0.6, ['integrations + compliance + packaging']);
  add('expansion_opportunity', ['lifecycle', 'adoption'], 0.55, ['roadmap + adoption + outcomes']);

  o.reasoning = traces;
  o.abstained = traces.length === 0;
  return o;
}
