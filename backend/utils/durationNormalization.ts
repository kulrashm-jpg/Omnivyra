/**
 * Campaign Duration Normalization
 *
 * Maps raw campaign durations (4–12 weeks) to strategic buckets
 * to ensure stable LLM prompts. Original campaign_duration preserved in execution_config.
 */

export type StrategicArcType = 'condensed' | 'moderate' | 'extended' | 'full';

export interface NormalizedDuration {
  raw: number;
  normalized: number;
  strategic_arc_type: StrategicArcType;
  theme_count_range: { min: number; max: number };
}

/**
 * Normalize campaign duration to strategic buckets.
 * 4–5 → 4, 6–7 → 6, 8–10 → 8, 11–12 → 12
 */
export function normalizeCampaignDuration(rawWeeks: number): NormalizedDuration {
  const raw = Math.max(4, Math.min(12, Math.round(rawWeeks)));

  let normalized: number;
  let strategic_arc_type: StrategicArcType;

  if (raw <= 5) {
    normalized = 4;
    strategic_arc_type = 'condensed';
  } else if (raw <= 7) {
    normalized = 6;
    strategic_arc_type = 'moderate';
  } else if (raw <= 10) {
    normalized = 8;
    strategic_arc_type = 'extended';
  } else {
    normalized = 12;
    strategic_arc_type = 'full';
  }

  const theme_count_range = getThemeCountRange(strategic_arc_type);

  return {
    raw,
    normalized,
    strategic_arc_type,
    theme_count_range,
  };
}

/**
 * Theme arc counts by strategic_arc_type.
 * Never map themes = weeks; use arc-based counts.
 */
function getThemeCountRange(arcType: StrategicArcType): { min: number; max: number } {
  switch (arcType) {
    case 'condensed':
      return { min: 2, max: 3 };
    case 'moderate':
      return { min: 3, max: 4 };
    case 'extended':
      return { min: 4, max: 5 };
    case 'full':
      return { min: 5, max: 7 };
    default:
      return { min: 4, max: 6 };
  }
}

/**
 * Cap ladder recommendations to theme arc range.
 * Ensures shorter campaigns produce fewer but deeper themes.
 */
export function capLadderToArcType<T>(
  ladder: T[],
  arcType: StrategicArcType
): T[] {
  const range = getThemeCountRange(arcType);
  const maxStages = range.max;
  if (ladder.length <= maxStages) return ladder;
  return ladder.slice(0, maxStages);
}

/**
 * Phase order by strategic arc type (aligns with ExecutionStage).
 * condensed → Awareness → Education → Conversion
 * moderate/extended/full → Awareness → Education → Authority → Conversion
 */
export function getArcPhaseOrder(arcType: StrategicArcType): string[] {
  switch (arcType) {
    case 'condensed':
      return ['awareness', 'education', 'conversion'];
    case 'moderate':
    case 'extended':
    case 'full':
    default:
      return ['awareness', 'education', 'authority', 'conversion'];
  }
}

/**
 * Filter ladder to only include stages in the arc's phase order.
 * Preserves relative order and merges recommendations for same stage.
 */
export function filterLadderByArcPhases<T extends { stage: string }>(
  ladder: T[],
  arcType: StrategicArcType
): T[] {
  const allowed = new Set(getArcPhaseOrder(arcType));
  return ladder.filter((entry) => allowed.has(entry.stage));
}
