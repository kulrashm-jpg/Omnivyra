/**
 * J-C304 — Completion Intelligence Engine (deterministic contributor). Descriptive journey state:
 * completed / active / paused / abandoned / branching / merged — evidence-derived, NO probability
 * estimation, NO prediction. Abstains without touchpoints or a declared status.
 */

import type { JourneyEngineOutput, JourneyIntelligenceContext } from './engineTypes';
import { emptyOutput, orderedTouchpoints, stageSequence, DAY } from './engineTypes';
import type { JourneyStatus } from '../types';
import { facet, mkEvidence, clamp01, decayFactor, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

const VALUE: Record<JourneyStatus, number> = { completed: 1, merged: 0.9, active: 0.6, branching: 0.6, paused: 0.4, abandoned: 0.2 };

export function runCompletion(ctx: JourneyIntelligenceContext): JourneyEngineOutput {
  const tps = orderedTouchpoints(ctx.raw);
  if (!tps.length && !ctx.raw?.status) return emptyOutput('completion');
  const src = ctx.raw?.source ?? 'journey_capture', at = tps.length ? tps[tps.length - 1].observedAt : ctx.asOf;

  // Descriptive status: declared wins; else derive from recency of last activity.
  let status: JourneyStatus = ctx.raw?.status ?? 'active';
  if (!ctx.raw?.status && tps.length) {
    const recency = decayFactor(at, ctx.asOf, 30);
    const dormantDays = Math.floor(Math.max(0, Date.parse(ctx.asOf) - Date.parse(at)) / DAY);
    if (recency < 0.15 || dormantDays > 90) status = 'abandoned';
    else if (recency < 0.4) status = 'paused';
  }
  const completionValue = VALUE[status] ?? 0.5;
  const seq = stageSequence(tps);

  const ev: EvidenceRef[] = [mkEvidence('completion', { label: 'status', value: status, source: src, observedAt: at, kind: 'inferred' })];
  const o: JourneyEngineOutput = { ...emptyOutput('completion'), abstained: false, evidence: ev };
  o.facets.state = facet({ status }, ev);                              // refine the descriptive state facet
  o.contributions.push({ dimension: 'completion', contributor: 'completion', method: 'deterministic', value: clamp01(completionValue), confidence: clamp01(0.45 + 0.1 * Math.min(tps.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'completion_state', conclusion: status, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`stages=${seq.length}`, ctx.raw?.status ? 'declared status' : 'derived from recency'], unknowns: [] }));
  return o;
}
