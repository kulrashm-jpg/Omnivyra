/**
 * LI-C208 — Cross-Engine Intelligence Reasoning (synthesis only; owns nothing).
 * Synthesizes evidence ALREADY produced by the engines into higher-order conclusions:
 *   buying+intent+relationship → opportunity; funding+exec+hiring → expansion;
 *   tech_migration+competitor+relationship → competitive displacement;
 *   intent+qualification+relationship → immediate sales; relationship+affinity+stage → outreach.
 * Emits reasoning traces (grounded in existing evidence) — it never recomputes an engine's job.
 */

import type { EngineOutput, LeadIntelligenceContext } from './engineTypes';
import { emptyOutput, clamp01 } from './engineTypes';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, ScoreDimension, ReasoningTrace } from '../types';

const ENGINE = 'cross_engine';

function dim(primaries: EngineOutput[], d: ScoreDimension): number | null {
  const hits = primaries.flatMap((p) => p.contributions).filter((c) => c.dimension === d && c.value !== null);
  return hits.length ? hits.reduce((a, b) => (b.confidence > a.confidence ? b : a)).value : null;
}
function signalEvidence(primaries: EngineOutput[], types: string[]): EvidenceRef[] {
  return primaries.find((p) => p.engine === 'buying_signal')?.evidence.filter((e) => types.some((t) => e.label === `signal:${t}`)) ?? [];
}

export function runCrossEngine(primaries: EngineOutput[], ctx: LeadIntelligenceContext): EngineOutput {
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;
  const traces: ReasoningTrace[] = [];
  const intent = dim(primaries, 'intent');
  const opportunity = dim(primaries, 'opportunity');
  const urgency = dim(primaries, 'urgency');
  const relEdges = primaries.find((p) => p.engine === 'relationship')?.edges ?? [];
  const qualEv = primaries.find((p) => p.engine === 'qualification')?.evidence ?? [];
  const allEv = primaries.flatMap((p) => p.evidence);

  const add = (claim: string, cond: boolean, value: number | null, because: EvidenceRef[], conf: number, assumptions: string[]) => {
    if (!cond || because.length === 0) return;
    // A firing synthesis is a grounded QUALITATIVE conclusion ('indicated') when it has no numeric value.
    traces.push(reasoningTrace({ claim, conclusion: value === null ? 'indicated' : value, because, confidence: clamp01(conf), method: 'deterministic', assumptions, unknowns: [] }));
  };

  // opportunity = buying + intent + relationship
  add('synthesized_opportunity', opportunity != null && intent != null, clamp01(0.5 * (opportunity ?? 0) + 0.35 * (intent ?? 0) + 0.15 * Math.min(relEdges.length, 3) / 3),
    primaries.flatMap((p) => (p.engine === 'buying_signal' || p.engine === 'intent') ? p.evidence : []), 0.6, ['co-occurrence of trigger + engagement + committee']);
  // expansion = funding + exec_change + hiring
  add('expansion_opportunity', true, null, signalEvidence(primaries, ['funding', 'exec_change', 'hiring', 'expansion']), 0.55, ['expansion inferred from growth signals']);
  // competitive displacement = tech_migration + competitor + relationship
  add('competitive_displacement', !!ctx.competitorId, null, signalEvidence(primaries, ['tech_migration', 'tech_adoption']), 0.5, [`competitor=${ctx.competitorId ?? 'none'}`, 'displacement needs migration + relationship']);
  // immediate sales = intent + qualification + relationship
  add('immediate_sales_opportunity', intent != null && qualEv.length > 0 && relEdges.length > 0, clamp01(0.5 * (intent ?? 0) + 0.5 * (urgency ?? 0)),
    [...primaries.find((p) => p.engine === 'intent')?.evidence ?? [], ...qualEv], 0.6, ['intent + known qualification + engaged committee']);
  // outreach strategy = relationship + content affinity + buying stage
  add('recommended_outreach', allEv.length > 0, null, allEv.slice(0, 8), 0.5, ['synthesis of persona + intent + relationship']);

  out.reasoning = traces;
  out.abstained = traces.length === 0;
  return out;
}
