/**
 * Blueprint Validation + Quality Guard.
 * Ensures campaign_blueprint is structurally correct, progression-safe, and execution-ready.
 * Does not change scoring, sequencing, or blueprint generation logic.
 * Validation + correction layer only.
 */

import type {
  CampaignBlueprint,
  WeeklyBlueprintEntry,
} from './recommendationBlueprintService';

export type BlueprintValidationResult = {
  is_valid: boolean;
  issues: string[];
  corrected_blueprint: CampaignBlueprint | null;
};

type RecLike = { topic?: string; [key: string]: unknown };

const STAGE_ORDER: Record<string, number> = {
  awareness: 0,
  education: 1,
  authority: 2,
  conversion: 3,
};

const MOMENTUM_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  peak: 3,
};

function pickTopic(rec: RecLike): string {
  return String(rec.topic ?? '').trim();
}

function cloneWeek(w: WeeklyBlueprintEntry): WeeklyBlueprintEntry {
  return {
    week_number: w.week_number,
    stage: w.stage,
    stage_objective: w.stage_objective ?? '',
    psychological_goal: w.psychological_goal ?? '',
    momentum_level: w.momentum_level ?? 'low',
    primary_recommendations: [...(w.primary_recommendations ?? [])],
    supporting_recommendations: [...(w.supporting_recommendations ?? [])],
  };
}

/**
 * Validates and optionally corrects a campaign blueprint.
 * Returns validation result with corrected blueprint.
 */
export function validateCampaignBlueprint(
  blueprint: CampaignBlueprint | null | undefined
): BlueprintValidationResult {
  if (blueprint == null) {
    return {
      is_valid: true,
      issues: [],
      corrected_blueprint: null,
    };
  }

  if (!Array.isArray(blueprint.weekly_plan)) {
    return {
      is_valid: false,
      issues: ['no_weekly_plan'],
      corrected_blueprint: null,
    };
  }

  const issues: string[] = [];
  let corrected: CampaignBlueprint = {
    duration_weeks: blueprint.duration_weeks ?? 0,
    weekly_plan: blueprint.weekly_plan.map(cloneWeek),
    progression_summary: blueprint.progression_summary ?? '',
  };

  if (corrected.weekly_plan.length === 0 && (corrected.duration_weeks ?? 0) > 0) {
    issues.push('no_weekly_plan');
  }

  const durationWeeks = Math.max(1, corrected.duration_weeks ?? 1);

  // --- RULE A: Week Integrity ---
  if (corrected.weekly_plan.length !== durationWeeks) {
    issues.push('week_count_mismatch');
    if (corrected.weekly_plan.length > durationWeeks) {
      corrected.weekly_plan = corrected.weekly_plan.slice(0, durationWeeks);
    } else {
      const lastStage = corrected.weekly_plan[corrected.weekly_plan.length - 1];
      while (corrected.weekly_plan.length < durationWeeks) {
        const padWeek = lastStage
          ? cloneWeek(lastStage)
          : ({
              week_number: corrected.weekly_plan.length + 1,
              stage: 'awareness' as const,
              stage_objective: 'Problem awareness',
              psychological_goal: 'Attention',
              momentum_level: 'low',
              primary_recommendations: [],
              supporting_recommendations: [],
            } as WeeklyBlueprintEntry);
        padWeek.week_number = corrected.weekly_plan.length + 1;
        corrected.weekly_plan.push(padWeek);
      }
    }
  }

  corrected.duration_weeks = durationWeeks;

  // Fix week_number sequencing
  corrected.weekly_plan.forEach((w, i) => {
    w.week_number = i + 1;
  });

  // --- RULE B: Stage Progression Safety ---
  let lastValidStageIndex = -1;
  for (let i = 0; i < corrected.weekly_plan.length; i++) {
    const w = corrected.weekly_plan[i];
    const stageStr = String(w.stage ?? 'awareness').toLowerCase();
    const stageIdx = STAGE_ORDER[stageStr] ?? 0;
    if (stageIdx < lastValidStageIndex) {
      issues.push(`stage_regression_week_${w.week_number}`);
      const prev = corrected.weekly_plan[Math.max(0, i - 1)];
      w.stage = prev.stage;
      w.stage_objective = prev.stage_objective;
      w.psychological_goal = prev.psychological_goal;
    } else {
      lastValidStageIndex = stageIdx;
    }
  }

  // --- RULE C: Momentum Progression ---
  let lastMomentum = -1;
  for (let i = 0; i < corrected.weekly_plan.length; i++) {
    const w = corrected.weekly_plan[i];
    const momStr = String(w.momentum_level ?? 'low').toLowerCase();
    const momIdx = MOMENTUM_ORDER[momStr] ?? 0;
    if (momIdx < lastMomentum) {
      issues.push(`momentum_drop_week_${w.week_number}`);
      const prev = corrected.weekly_plan[Math.max(0, i - 1)];
      w.momentum_level = prev.momentum_level ?? 'low';
    } else {
      lastMomentum = momIdx;
    }
  }

  // --- RULE D: Recommendation Integrity (auto-fix silently) ---
  for (let i = 0; i < corrected.weekly_plan.length; i++) {
    const w = corrected.weekly_plan[i];
    let primary = [...(w.primary_recommendations ?? [])];
    let supporting = [...(w.supporting_recommendations ?? [])];

    // Primary max 2
    if (primary.length > 2) {
      primary = primary.slice(0, 2);
    }

    // Supporting excludes primary topics
    const primaryTopics = new Set(primary.map((r) => pickTopic(r).toLowerCase()).filter(Boolean));
    supporting = supporting.filter((r) => !primaryTopics.has(pickTopic(r).toLowerCase()));
    primaryTopics.clear();

    // No duplicate topic within same week
    const seenTopics = new Set<string>();
    primary = primary.filter((r) => {
      const t = pickTopic(r).toLowerCase();
      if (!t || seenTopics.has(t)) return false;
      seenTopics.add(t);
      return true;
    });
    supporting = supporting.filter((r) => {
      const t = pickTopic(r).toLowerCase();
      if (!t || seenTopics.has(t)) return false;
      seenTopics.add(t);
      return true;
    });

    w.primary_recommendations = primary;
    w.supporting_recommendations = supporting;
  }

  // --- RULE E: Empty Weeks ---
  for (let i = 0; i < corrected.weekly_plan.length; i++) {
    const w = corrected.weekly_plan[i];
    const total = (w.primary_recommendations?.length ?? 0) + (w.supporting_recommendations?.length ?? 0);
    if (total > 0) continue;

    for (let j = i - 1; j >= 0; j--) {
      const prev = corrected.weekly_plan[j];
      const prevSupporting = prev.supporting_recommendations ?? [];
      if (prevSupporting.length > 0) {
        const pulled = prevSupporting.slice(0, 2);
        w.primary_recommendations = [...pulled];
        prev.supporting_recommendations = prevSupporting.slice(2);
        issues.push(`empty_week_${w.week_number}`);
        break;
      }
    }
  }

  return {
    is_valid: issues.length === 0,
    issues,
    corrected_blueprint: corrected,
  };
}
