/**
 * I-C307 — Intent Health Summary (deterministic; descriptive). Combines interpretation + evidence
 * quality + confidence + ambiguity + context into one canonical descriptive summary. Reads the decided
 * facets/score — it owns no new scoring system, makes no recommendation, and predicts nothing.
 */

import type { IntentUnderstanding } from '../types';
import { clamp01 } from '../../intelligence/canonical';

export interface IntentHealthSummary {
  primaryObjective: string | null;
  competingObjectives: string[];
  abstained: boolean;
  strength: number | null;
  clarity: number | null;
  recency: number | null;
  breadth: number | null;
  confidence: number;
  uncertainty: number;
  ambiguous: boolean;
  signals: string[];
}

export function intentHealthSummary(u: IntentUnderstanding): IntentHealthSummary {
  const d = u.score.dimensions;
  const conf = u.facets.confidence.value;
  const primary = u.facets.primaryIntent.value?.objective ?? null;
  const competing = (u.facets.competingIntents.value?.candidates ?? []).map((c) => c.objective).filter((o) => o !== primary);
  const clarity = d.clarity.value;

  const signals: string[] = [];
  if (primary) signals.push(`primary:${primary}`);
  if (competing.length) signals.push(`competing:${competing.length}`);
  if (conf?.abstained) signals.push('abstained');

  return {
    primaryObjective: primary,
    competingObjectives: competing,
    abstained: conf?.abstained ?? primary === null,
    strength: d.strength.value,
    clarity,
    recency: d.recency.value,
    breadth: d.breadth.value,
    confidence: clamp01(conf?.confidence ?? u.score.confidence),
    uncertainty: clamp01(conf?.uncertainty ?? 1),
    ambiguous: clarity != null && clarity < 0.4,
    signals,
  };
}
