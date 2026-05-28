/**
 * Phase 2 — Recommendation learning engine.
 *
 * Walks the feedback registry and produces 4 adjustment sets:
 *   - recommendationPreferenceAdjustments   per-axis weight deltas
 *   - narrativeFatigueAdjustments           archetype-level fatigue increments
 *   - icpPriorityAdjustments                ICP-level priority deltas
 *   - authorityGapPriorityAdjustments       gap-node priority deltas
 *
 * Heuristics:
 *   + accepted recommendations → boost (positive adjustment)
 *   − rejected recommendations → demote
 *   − repeated cannibalization recurrences → fatigue + demote
 *   + editor overrides that "added" a topic → boost that ICP/archetype
 *   − ignored recommendation types → demote
 */

import type {
  FeedbackEvent,
  LearningPreferenceAxis,
  RecommendationLearningOutputs,
} from './longFormRecommendationTypes';
import type { FeedbackEventRegistry } from './feedbackEventRegistry';

interface AdjustmentAccumulator {
  axisDeltas: Map<LearningPreferenceAxis, Map<string, number>>;
  archetypeFatigue: Map<string, number>;
  icpPriority: Map<string, number>;
  authorityGapPriority: Map<string, number>;
}

function newAcc(): AdjustmentAccumulator {
  return {
    axisDeltas: new Map(),
    archetypeFatigue: new Map(),
    icpPriority: new Map(),
    authorityGapPriority: new Map(),
  };
}

function bumpAxis(acc: AdjustmentAccumulator, axis: LearningPreferenceAxis, key: string, delta: number) {
  if (!key) return;
  let axisMap = acc.axisDeltas.get(axis);
  if (!axisMap) { axisMap = new Map(); acc.axisDeltas.set(axis, axisMap); }
  axisMap.set(key, (axisMap.get(key) ?? 0) + delta);
}

function bump(map: Map<string, number>, key: string, delta: number) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + delta);
}

function extractTagsByPrefix(event: FeedbackEvent, prefix: string): string[] {
  return (event.tags ?? [])
    .filter((t) => t.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((t) => t.slice(prefix.length).trim().toLowerCase())
    .filter(Boolean);
}

export interface LearnRecommendationPreferencesInput {
  registry: FeedbackEventRegistry;
  companyId: string;
  windowSinceISO?: string;
}

export function learnRecommendationPreferences(input: LearnRecommendationPreferencesInput): RecommendationLearningOutputs {
  const events = input.registry.list(input.companyId, { sinceISO: input.windowSinceISO });
  const acc = newAcc();

  // Tag conventions we honor:
  //   "archetype:observability"
  //   "icp:platform engineers"
  //   "funnel:awareness"
  //   "mode:company_context_led"
  //   "authority_gap:governance"
  for (const e of events) {
    const archetypes = extractTagsByPrefix(e, 'archetype:');
    const icps = extractTagsByPrefix(e, 'icp:');
    const funnels = extractTagsByPrefix(e, 'funnel:');
    const modes = extractTagsByPrefix(e, 'mode:');
    const gaps = extractTagsByPrefix(e, 'authority_gap:');

    switch (e.eventType) {
      case 'recommendation_accepted':
      case 'planner_approved':
        for (const a of archetypes) bumpAxis(acc, 'archetype', a, +2);
        for (const i of icps) { bumpAxis(acc, 'icp', i, +2); bump(acc.icpPriority, i, +2); }
        for (const f of funnels) bumpAxis(acc, 'funnel_stage', f, +2);
        for (const m of modes) bumpAxis(acc, 'content_mode', m, +2);
        break;

      case 'recommendation_rejected':
      case 'planner_rejected':
      case 'strategic_sequencing_ignored':
        for (const a of archetypes) bumpAxis(acc, 'archetype', a, -2);
        for (const i of icps) { bumpAxis(acc, 'icp', i, -1); bump(acc.icpPriority, i, -1); }
        for (const f of funnels) bumpAxis(acc, 'funnel_stage', f, -1);
        for (const m of modes) bumpAxis(acc, 'content_mode', m, -1);
        break;

      case 'cannibalization_recurrence':
        for (const a of archetypes) {
          bump(acc.archetypeFatigue, a, +4);
          bumpAxis(acc, 'archetype', a, -3);
        }
        for (const i of icps) bump(acc.icpPriority, i, -2);
        break;

      case 'portfolio_recovery':
        for (const gap of gaps) bump(acc.authorityGapPriority, gap, +3);
        for (const i of icps) bump(acc.icpPriority, i, +1);
        break;

      case 'strategic_sequencing_adopted':
        for (const gap of gaps) bump(acc.authorityGapPriority, gap, +1);
        for (const i of icps) bump(acc.icpPriority, i, +1);
        break;

      case 'human_edit_pattern':
      case 'factual_correction':
        // No archetype/icp adjustments here — handled by revision learning.
        break;

      default:
        break;
    }
  }

  // Assemble outputs.
  const recommendationPreferenceAdjustments: RecommendationLearningOutputs['recommendationPreferenceAdjustments'] = [];
  for (const [axis, map] of acc.axisDeltas) {
    for (const [key, adjustment] of map) {
      if (adjustment === 0) continue;
      recommendationPreferenceAdjustments.push({
        axis, key, adjustment,
        rationale: adjustment > 0
          ? `Cumulative positive feedback on ${axis} "${key}" (Δ${adjustment}).`
          : `Cumulative negative feedback on ${axis} "${key}" (Δ${adjustment}).`,
      });
    }
  }
  recommendationPreferenceAdjustments.sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment));

  const narrativeFatigueAdjustments: RecommendationLearningOutputs['narrativeFatigueAdjustments'] = [];
  for (const [archetype, fatigue] of acc.archetypeFatigue) {
    narrativeFatigueAdjustments.push({
      archetype,
      fatigueIncrement: fatigue,
      rationale: `Cannibalization recurrence triggered ${fatigue} fatigue points for archetype "${archetype}".`,
    });
  }
  narrativeFatigueAdjustments.sort((a, b) => b.fatigueIncrement - a.fatigueIncrement);

  const icpPriorityAdjustments: RecommendationLearningOutputs['icpPriorityAdjustments'] = [];
  for (const [icp, delta] of acc.icpPriority) {
    if (delta === 0) continue;
    icpPriorityAdjustments.push({
      icp,
      priorityDelta: delta,
      rationale: delta > 0
        ? `Positive signal: ICP "${icp}" has been adopted via sequencing or accepted recommendations (Δ${delta}).`
        : `Negative signal: ICP "${icp}" repeatedly rejected or saturated (Δ${delta}).`,
    });
  }
  icpPriorityAdjustments.sort((a, b) => Math.abs(b.priorityDelta) - Math.abs(a.priorityDelta));

  const authorityGapPriorityAdjustments: RecommendationLearningOutputs['authorityGapPriorityAdjustments'] = [];
  for (const [nodeLabel, delta] of acc.authorityGapPriority) {
    if (delta === 0) continue;
    authorityGapPriorityAdjustments.push({
      nodeLabel,
      priorityDelta: delta,
      rationale: delta > 0
        ? `Portfolio recovery / sequencing identified node "${nodeLabel}" as a recurring gap to fill (Δ${delta}).`
        : `Node "${nodeLabel}" deprioritized after repeated negative signals (Δ${delta}).`,
    });
  }
  authorityGapPriorityAdjustments.sort((a, b) => Math.abs(b.priorityDelta) - Math.abs(a.priorityDelta));

  return {
    recommendationPreferenceAdjustments,
    narrativeFatigueAdjustments,
    icpPriorityAdjustments,
    authorityGapPriorityAdjustments,
  };
}
