/**
 * Theme Reinforcement Engine
 * Phase 5: Reinforce or weaken strategic themes from outcomes and feedback.
 * Safeguards: adjustment [-0.25, +0.25], scores bounded [0, 1]
 */

import { supabase } from '../db/supabaseClient';
import { ADJUSTMENT_MIN, ADJUSTMENT_MAX } from './intelligenceLearningEngine';

export type ThemeReinforcementResult = {
  theme_id: string;
  theme_topic: string;
  current_strength: number;
  reinforcement_score: number;
  updated_theme_strength: number;
};

/**
 * Compute reinforcement for company themes from outcomes and feedback.
 */
export async function computeThemeReinforcement(
  companyId: string
): Promise<ThemeReinforcementResult[]> {
  const { data: themes } = await supabase
    .from('company_strategic_themes')
    .select('id, theme_topic, theme_strength')
    .eq('company_id', companyId);

  const { data: outcomes } = await supabase
    .from('intelligence_outcomes')
    .select('success_score')
    .eq('company_id', companyId);

  const { data: feedback } = await supabase
    .from('recommendation_feedback')
    .select('feedback_type, feedback_score')
    .eq('company_id', companyId);

  const outcomeRate =
    (outcomes ?? []).length > 0
      ? (outcomes as Array<{ success_score: number | null }>).reduce(
          (s, o) => s + (o.success_score ?? 0),
          0
        ) / (outcomes ?? []).length
      : 0.5;

  const feedbackRate =
    (feedback ?? []).length > 0
      ? (feedback as Array<{ feedback_score: number | null }>).reduce(
          (s, f) => s + (f.feedback_score ?? 0.5),
          0
        ) / (feedback ?? []).length
      : 0.5;

  const rawReinforcement = (outcomeRate - 0.5) * 0.4 + (feedbackRate - 0.5) * 0.3;
  const reinforcementScore = Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, rawReinforcement));

  const rows = (themes ?? []) as Array<{
    id: string;
    theme_topic: string;
    theme_strength: number | null;
  }>;

  return rows.map((t) => {
    const current = Math.max(0, Math.min(1, t.theme_strength ?? 0.5));
    const updated = Math.max(0, Math.min(1, current + reinforcementScore));
    return {
      theme_id: t.id,
      theme_topic: t.theme_topic,
      current_strength: current,
      reinforcement_score: reinforcementScore,
      updated_theme_strength: updated,
    };
  });
}

/**
 * Persist reinforced theme strengths (optional).
 */
export async function persistThemeReinforcement(
  results: ThemeReinforcementResult[]
): Promise<void> {
  for (const r of results) {
    await supabase
      .from('company_strategic_themes')
      .update({ theme_strength: r.updated_theme_strength })
      .eq('id', r.theme_id);
  }
}
