/**
 * J-C306 — Transition Intelligence Engine (deterministic contributor). Descriptive stage transitions:
 * chronology + evidence + confidence + continuity. Does NOT infer intent. Abstains without a stage
 * transition.
 */

import type { JourneyEngineOutput, JourneyIntelligenceContext } from './engineTypes';
import { emptyOutput, orderedTouchpoints } from './engineTypes';
import type { TransitionEntry } from '../types';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runTransition(ctx: JourneyIntelligenceContext): JourneyEngineOutput {
  const tps = orderedTouchpoints(ctx.raw);
  const transitions: TransitionEntry[] = [];
  let prev: string | null = null;
  for (const t of tps) { if (!t.stage) continue; if (prev !== null && prev !== t.stage) transitions.push({ from: prev, to: t.stage, at: t.observedAt }); prev = t.stage; }
  if (!transitions.length) return emptyOutput('transition');
  const src = ctx.raw?.source ?? 'journey_capture', at = transitions[transitions.length - 1].at;

  const ev: EvidenceRef[] = transitions.map((tr) => mkEvidence('transition', { label: `transition:${tr.from}->${tr.to}`, value: `${tr.from}->${tr.to}`, source: src, observedAt: tr.at, kind: 'inferred' }));
  // chronology is preserved (sorted by observedAt via orderedTouchpoints)
  const chronological = transitions.every((_, i) => i === 0 || transitions[i - 1].at <= transitions[i].at);
  const o: JourneyEngineOutput = { ...emptyOutput('transition'), abstained: false, evidence: ev };
  o.facets.transitions = facet({ transitions }, ev);
  const value = clamp01(transitions.length / (transitions.length + 1));
  o.contributions.push({ dimension: 'progression', contributor: 'transition', method: 'deterministic', value, confidence: clamp01(0.4 + 0.1 * Math.min(transitions.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'transitions', conclusion: transitions.length, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`chronological=${chronological}`, 'descriptive only — no intent inferred'], unknowns: [] }));
  return o;
}
