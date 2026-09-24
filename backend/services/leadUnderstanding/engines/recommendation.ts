/**
 * LI-C207 — Recommendation Intelligence (deterministic synthesis contributor).
 * Produces evidence-backed next-best action / message / channel / timing from evidence ALREADY
 * produced by the primaries (intent / buying / qualification / persona). Emits a recommendations
 * facet + a reasoning trace carrying evidence, confidence, assumptions, alternatives, unknowns,
 * freshness, provenance. Abstains when there is nothing to reason over — no evidence at all, or
 * every driver dimension abstaining.
 */

import type { EngineOutput, LeadIntelligenceContext } from './engineTypes';
import { emptyOutput, clamp01 } from './engineTypes';
import { facet } from '../facets';
import { reasoningTrace } from '../reasoning';
import type { EvidenceRef, ScoreDimension, RecommendationsValue } from '../types';

const ENGINE = 'recommendation';

function dimValue(primaries: EngineOutput[], dim: ScoreDimension): number | null {
  const hits = primaries.flatMap((p) => p.contributions).filter((c) => c.dimension === dim && c.value !== null);
  if (!hits.length) return null;
  return hits.reduce((a, b) => (b.confidence > a.confidence ? b : a)).value;
}

export function runRecommendation(primaries: EngineOutput[], ctx: LeadIntelligenceContext): EngineOutput {
  const out = { ...emptyOutput(ENGINE), facets: {}, contributions: [], evidence: [], edges: [], reasoning: [] } as EngineOutput;
  const evidence: EvidenceRef[] = primaries.flatMap((p) => p.evidence);
  if (!evidence.length) return emptyOutput(ENGINE);

  const intentValue = dimValue(primaries, 'intent');
  const opportunityValue = dimValue(primaries, 'opportunity');
  const urgencyValue = dimValue(primaries, 'urgency');
  // Absence is never a score. `dimValue` abstains (null) when no contribution carried a value, and
  // with EVERY driver abstaining there is nothing to reason over — the same situation as no evidence
  // reaching us at all, so the engine abstains in the same shape. Reading those nulls as zeros
  // scored a prospect out of nothing: the thresholds below took them for measured lows and the
  // confidence floor asserted 0.4 on no evidence whatsoever.
  if (intentValue === null && opportunityValue === null && urgencyValue === null) return emptyOutput(ENGINE);

  // At least one driver is real. A remaining null is read as 0 only inside the `>` comparisons
  // below, where absence can lower this recommendation's aggressiveness but never raise it: an
  // abstaining urgency cannot make a prospect `within_24h` and an abstaining opportunity cannot make
  // the message lead with a trigger event. Abstaining on ANY null driver was rejected deliberately —
  // `prospectContext` populates neither `ctx.signals` nor `ctx.qualification`, so `opportunity` and
  // `urgency` abstain on every real prospect and the engine would then never fire at all. The
  // abstentions still travel: `unknowns` below names them whenever neither engagement driver scores.
  const intent = intentValue ?? 0;
  const opportunity = opportunityValue ?? 0;
  const urgency = urgencyValue ?? 0;
  const persona = primaries.find((p) => p.engine === 'persona_icp');
  const seniority = persona?.facets.identity?.value?.seniority;

  const hot = Math.max(intent, opportunity) > 0.6 || urgency > 0.6;
  const nextAction = hot ? 'personalized_outreach' : intent > 0.3 ? 'nurture_sequence' : 'monitor';
  const nextChannel = seniority === 'c_level' || seniority === 'vp' ? 'email_then_call' : 'email';
  const nextTiming = urgency > 0.6 ? 'within_24h' : hot ? 'this_week' : 'this_month';
  const nextMessage = opportunity > intent ? 'lead_with_trigger_event' : 'lead_with_observed_interest';

  const rec: RecommendationsValue = { nextAction, nextMessage, nextChannel, nextTiming };
  const confidence = clamp01(0.4 + 0.4 * Math.max(intent, opportunity));
  out.abstained = false;
  out.facets.recommendations = facet(rec, evidence, { confidenceOverride: confidence });
  out.reasoning.push(reasoningTrace({
    claim: 'next_best_action', conclusion: nextAction, because: evidence, confidence, method: 'deterministic',
    assumptions: ['thresholds: hot>0.6 intent/opportunity/urgency', `channel by seniority=${seniority ?? 'unknown'}`],
    unknowns: intent === 0 && opportunity === 0 ? ['no engagement or trigger evidence'] : [],
  }));
  return out;
}
