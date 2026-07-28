/**
 * J-C305 — Milestone Intelligence Engine (deterministic contributor). Descriptive milestones:
 * completed milestones + chronology + evidence + confidence. Evidence-first, NO prediction. Abstains
 * without milestone-bearing touchpoints.
 */

import type { JourneyEngineOutput, JourneyIntelligenceContext } from './engineTypes';
import { emptyOutput, orderedTouchpoints } from './engineTypes';
import type { MilestoneEntry } from '../types';
import { facet, mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runMilestone(ctx: JourneyIntelligenceContext): JourneyEngineOutput {
  const tps = orderedTouchpoints(ctx.raw);
  const achieved: MilestoneEntry[] = tps.filter((t) => t.milestone).map((t) => ({ name: t.milestone!, at: t.observedAt }));
  if (!achieved.length) return emptyOutput('milestone');
  const src = ctx.raw?.source ?? 'journey_capture', at = achieved[achieved.length - 1].at;

  const ev: EvidenceRef[] = achieved.map((m) => mkEvidence('milestone', { label: `milestone:${m.name}`, value: m.name, source: src, observedAt: m.at, kind: 'observed' }));
  const o: JourneyEngineOutput = { ...emptyOutput('milestone'), abstained: false, evidence: ev };
  o.facets.milestones = facet({ achieved }, ev);                       // chronological (touchpoints already ordered)
  const value = clamp01(achieved.length / 5);                          // observed count (descriptive), capped
  o.contributions.push({ dimension: 'completion', contributor: 'milestone', method: 'deterministic', value, confidence: clamp01(0.4 + 0.1 * Math.min(achieved.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'milestones_achieved', conclusion: achieved.length, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`achieved=${achieved.map((m) => m.name).join(', ')}`], unknowns: [] }));
  return o;
}
