/**
 * J-C301 — Progression Intelligence Engine (deterministic contributor). Descriptive progression from
 * evidence: progression percentage, forward progression, regressions (revisits of an earlier stage),
 * stalled progression, completeness. NO prediction. Abstains without stage-bearing touchpoints.
 */

import type { JourneyEngineOutput, JourneyIntelligenceContext } from './engineTypes';
import { emptyOutput, orderedTouchpoints, stageSequence } from './engineTypes';
import { mkEvidence, clamp01, reasoningTrace } from '../../intelligence/canonical';
import type { EvidenceRef } from '../../intelligence/canonical';

export function runProgression(ctx: JourneyIntelligenceContext): JourneyEngineOutput {
  const tps = orderedTouchpoints(ctx.raw);
  const seq = stageSequence(tps);
  if (!seq.length) return emptyOutput('progression');
  const src = ctx.raw?.source ?? 'journey_capture', at = tps[tps.length - 1].observedAt;

  const distinct = new Set(seq);
  const pending = ctx.raw?.pendingStages ?? [];
  const progressionPct = clamp01(distinct.size / (distinct.size + pending.length));

  // forward = first arrival at a new stage; regression = arrival at a previously-visited stage.
  const visited = new Set<string>(); let forward = 0, regressions = 0;
  for (const s of seq) { if (visited.has(s)) regressions++; else { forward++; visited.add(s); } }
  // stalled = longest run of touchpoints in the same stage.
  let stalled = 0, run = 0, prev: string | undefined;
  for (const t of tps) { if (t.stage && t.stage === prev) { run++; stalled = Math.max(stalled, run); } else run = 1; prev = t.stage; }
  const completeness = clamp01((distinct.size - 1 + (pending.length === 0 ? 1 : 0)) / Math.max(1, distinct.size + pending.length));

  const ev: EvidenceRef[] = [
    mkEvidence('progression', { label: 'stages_reached', value: distinct.size, source: src, observedAt: at, kind: 'inferred' }),
    mkEvidence('progression', { label: 'forward', value: forward, source: src, observedAt: at, kind: 'inferred' }),
  ];
  const o: JourneyEngineOutput = { ...emptyOutput('progression'), abstained: false, evidence: ev };
  o.contributions.push({ dimension: 'progression', contributor: 'progression', method: 'deterministic', value: progressionPct, confidence: clamp01(0.4 + 0.1 * Math.min(seq.length, 4)), evidence: ev, asOf: at });
  o.reasoning.push(reasoningTrace({ claim: 'progression', conclusion: progressionPct, because: ev, confidence: 0.6, method: 'deterministic', assumptions: [`forward=${forward}, regressions=${regressions}, stalled=${stalled}, completeness=${completeness}`], unknowns: pending.length ? [] : ['total stage set unknown ⇒ completeness relative'] }));
  return o;
}
