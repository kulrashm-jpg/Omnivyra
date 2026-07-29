/**
 * J-C303 — Continuity Intelligence Engine (deterministic contributor). Descriptive continuity: cross-
 * session / multi-device / resumed / fragmented journeys + continuity confidence. Reuses the existing
 * Visitor identity via the actor reference (Journey owns continuity only, never visitor semantics). No
 * prediction. Abstains without touchpoints.
 */

import type { JourneyEngineOutput, JourneyIntelligenceContext } from './engineTypes';
import { emptyOutput, orderedTouchpoints, DAY } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runContinuity(ctx: JourneyIntelligenceContext): JourneyEngineOutput {
  const tps = orderedTouchpoints(ctx.raw);
  if (tps.length < 1) return emptyOutput('continuity');
  const src = ctx.raw?.source ?? 'journey_capture', at = tps[tps.length - 1].observedAt;

  let gaps = 0;
  for (let i = 1; i < tps.length; i++) if (Date.parse(tps[i].observedAt) - Date.parse(tps[i - 1].observedAt) > 30 * DAY) gaps++;
  const intervals = Math.max(1, tps.length - 1);
  const continuity = clamp01(1 - gaps / intervals);
  const fragmented = gaps > 0;

  const ev: EvidenceRef[] = [
    mkEvidence('continuity', { label: 'gaps', value: gaps, source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('continuity', { label: 'actor', value: ctx.raw?.actorRef ?? 'unknown', source: src, observedAt: at, kind: 'structured' }),
  ];
  const o: JourneyEngineOutput = { ...emptyOutput('continuity'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'continuity', contributor: 'continuity', method: 'deterministic', value: continuity, confidence: clamp01(0.4 + 0.1 * Math.min(tps.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'continuity', conclusion: fragmented ? 'fragmented' : 'continuous', because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`gaps=${gaps} over ${intervals} intervals`], unknowns: ctx.raw?.actorRef ? [] : ['actor reference unknown ⇒ single-actor assumed'] }));
  return o;
}
