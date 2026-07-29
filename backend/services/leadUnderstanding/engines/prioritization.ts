/**
 * LI-C206 — Opportunity Prioritization (deterministic synthesis contributor).
 * Derives ONE `priority` score contribution from evidence ALREADY produced by the primary engines
 * (intent / opportunity / urgency / icp) plus relationship strength. It owns no ranking engine and
 * no final score — it emits a contribution the assembly blends. Abstains if the primaries abstained.
 */

import type { EngineOutput, LeadIntelligenceContext } from './engineTypes';
import { emptyOutput, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, ScoreDimension, OpportunityValue } from '../types';

const ENGINE = 'prioritization';
// How much each upstream dimension drives priority (deterministic policy).
const DRIVERS: Array<{ dim: ScoreDimension; w: number }> = [
  { dim: 'intent', w: 0.35 }, { dim: 'opportunity', w: 0.3 }, { dim: 'urgency', w: 0.2 }, { dim: 'icp', w: 0.15 },
];

function bestValue(primaries: EngineOutput[], dim: ScoreDimension): { value: number | null; confidence: number; evidence: EvidenceRef[] } {
  const hits = primaries.flatMap((p) => p.contributions).filter((c) => c.dimension === dim && c.value !== null);
  if (!hits.length) return { value: null, confidence: 0, evidence: [] };
  const best = hits.reduce((a, b) => (b.confidence > a.confidence ? b : a));
  return { value: best.value, confidence: best.confidence, evidence: best.evidence };
}

export function runPrioritization(primaries: EngineOutput[], ctx: LeadIntelligenceContext): EngineOutput {
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;
  let num = 0, wSum = 0, conf = 0, nDrivers = 0;
  const evidence: EvidenceRef[] = [];
  for (const { dim, w } of DRIVERS) {
    const b = bestValue(primaries, dim);
    if (b.value === null) continue;
    num += w * b.value; wSum += w; conf += b.confidence; nDrivers++;
    for (const e of b.evidence) if (!evidence.find((x) => x.id === e.id)) evidence.push(e);
  }
  // Relationship strength nudges priority (more covered committee ⇒ higher).
  const relEdges = primaries.find((p) => p.engine === 'relationship')?.edges.length ?? 0;
  const relBoost = clamp01(Math.min(relEdges, 4) / 8); // up to +0.5 scaled below

  if (wSum === 0) return emptyOutput(ENGINE); // nothing to prioritize on ⇒ abstain
  const priority = clamp01((num / wSum) * (0.85 + 0.15 * relBoost * 2));
  const confidence = clamp01(conf / Math.max(1, nDrivers));
  out.abstained = false;
  out.contributions.push({ dimension: 'priority', contributor: ENGINE, method: 'deterministic', value: priority, confidence, evidence, asOf: ctx.asOf });
  const oppVal: OpportunityValue = { strategicValue: priority > 0.66 ? 'high' : priority > 0.33 ? 'medium' : 'low' };
  out.facets.opportunity = facet(oppVal, evidence.length ? evidence : [], { confidenceOverride: confidence });
  out.evidence = [];
  out.reasoning.push(reasoningTrace({ claim: 'priority', conclusion: priority, because: evidence, confidence, method: 'deterministic', assumptions: ['weighted blend of intent/opportunity/urgency/icp + relationship boost'], unknowns: nDrivers < DRIVERS.length ? ['some drivers abstained'] : [] }));
  return out;
}
