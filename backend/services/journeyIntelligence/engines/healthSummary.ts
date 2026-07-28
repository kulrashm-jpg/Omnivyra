/**
 * J-C307 — Journey Health Summary (deterministic; descriptive). Combines progression / momentum /
 * continuity / completion / milestones / transitions into one canonical descriptive summary. Reads the
 * decided facets/score — it owns no new scoring system, makes no recommendation, and predicts nothing.
 */

import type { JourneyUnderstanding } from '../types';
import { clamp01 } from '../../intelligence/canonical';

export interface JourneyHealthSummary {
  status: string | null;
  progression: number | null;
  momentum: number | null;
  continuity: number | null;
  completion: number | null;
  touchpointCount: number;
  milestoneCount: number;
  transitionCount: number;
  currentStage: string | null;
  signals: string[];
  confidence: number;
}

export function journeyHealthSummary(u: JourneyUnderstanding): JourneyHealthSummary {
  const d = u.score.dimensions;
  const stages = u.facets.stages.value;
  const signals: string[] = [];
  if (stages?.current) signals.push(`stage:${stages.current}`);
  if (u.facets.state.value?.status) signals.push(`state:${u.facets.state.value.status}`);
  if (u.facets.continuity.value?.gaps != null) signals.push(`gaps:${u.facets.continuity.value.gaps}`);

  return {
    status: u.facets.state.value?.status ?? null,
    progression: d.progression.value,
    momentum: d.momentum.value,
    continuity: d.continuity.value,
    completion: d.completion.value,
    touchpointCount: u.facets.touchpoints.value?.count ?? 0,
    milestoneCount: u.facets.milestones.value?.achieved?.length ?? 0,
    transitionCount: u.facets.transitions.value?.transitions?.length ?? 0,
    currentStage: stages?.current ?? null,
    signals,
    confidence: clamp01(u.score.confidence),
  };
}
