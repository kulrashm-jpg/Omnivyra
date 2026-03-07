/**
 * Intelligence Quality Metrics Engine
 * Phase 6: Tracks signal_accuracy, opportunity_accuracy, recommendation_success_rate, theme_success_rate.
 * Safeguard: Metric integrity via (company_id, metric_type, created_at::date) uniqueness
 */

import { supabase } from '../db/supabaseClient';

export type QualityMetrics = {
  signal_accuracy: number;
  opportunity_accuracy: number;
  recommendation_success_rate: number;
  theme_success_rate: number;
  computed_at: string;
};

/**
 * Compute and persist quality metrics for a company.
 * Uses ON CONFLICT to respect (company_id, metric_type, metric_date) uniqueness.
 */
export async function computeAndPersistQualityMetrics(
  companyId: string
): Promise<QualityMetrics> {
  const now = new Date().toISOString();

  const [outcomes, feedback, recs, themes] = await Promise.all([
    supabase
      .from('intelligence_outcomes')
      .select('success_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('recommendation_feedback')
      .select('feedback_score, feedback_type')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('intelligence_recommendations')
      .select('confidence_score')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('company_strategic_themes')
      .select('theme_strength')
      .eq('company_id', companyId)
      .is('archived_at', null),
  ]);

  const outcomeScores = (outcomes.data ?? []) as Array<{ success_score: number | null }>;
  const feedbackRows = (feedback.data ?? []) as Array<{ feedback_score: number | null; feedback_type: string }>;
  const recRows = (recs.data ?? []) as Array<{ confidence_score: number | null }>;
  const themeRows = (themes.data ?? []) as Array<{ theme_strength: number | null }>;

  const recommendationSuccessRate =
    outcomeScores.length > 0
      ? outcomeScores.reduce((s, o) => s + (o.success_score ?? 0.5), 0) / outcomeScores.length
      : feedbackRows.length > 0
        ? feedbackRows.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackRows.length
        : 0.5;

  const opportunityAccuracy = recRows.length > 0
    ? recRows.reduce((s, r) => s + (r.confidence_score ?? 0.5), 0) / recRows.length
    : 0.5;

  const themeSuccessRate = themeRows.length > 0
    ? themeRows.reduce((s, t) => s + (t.theme_strength ?? 0.5), 0) / themeRows.length
    : 0.5;

  const signalAccuracy = Math.min(1, opportunityAccuracy * 0.9 + recommendationSuccessRate * 0.1);

  const metrics: QualityMetrics = {
    signal_accuracy: Math.round(signalAccuracy * 1000) / 1000,
    opportunity_accuracy: Math.round(opportunityAccuracy * 1000) / 1000,
    recommendation_success_rate: Math.round(recommendationSuccessRate * 1000) / 1000,
    theme_success_rate: Math.round(themeSuccessRate * 1000) / 1000,
    computed_at: now,
  };

  const toUpsert = [
    { metric_type: 'signal_accuracy', metric_value: metrics.signal_accuracy },
    { metric_type: 'opportunity_accuracy', metric_value: metrics.opportunity_accuracy },
    { metric_type: 'recommendation_success_rate', metric_value: metrics.recommendation_success_rate },
    { metric_type: 'theme_success_rate', metric_value: metrics.theme_success_rate },
  ];

  for (const m of toUpsert) {
    await supabase.from('intelligence_optimization_metrics').upsert(
      {
        company_id: companyId,
        metric_type: m.metric_type,
        metric_value: m.metric_value,
        created_at: now,
      },
      { onConflict: 'company_id,metric_type,metric_date', ignoreDuplicates: false }
    );
  }

  return metrics;
}

/**
 * Fetch latest quality metrics for a company.
 */
export async function getQualityMetrics(
  companyId: string,
  options?: { limit?: number }
): Promise<Array<{ metric_type: string; metric_value: number; created_at: string }>> {
  const { data, error } = await supabase
    .from('intelligence_optimization_metrics')
    .select('metric_type, metric_value, created_at')
    .eq('company_id', companyId)
    .in('metric_type', ['signal_accuracy', 'opportunity_accuracy', 'recommendation_success_rate', 'theme_success_rate'])
    .order('created_at', { ascending: false })
    .limit((options?.limit ?? 30) * 4);

  if (error) throw new Error(`Failed to fetch quality metrics: ${error.message}`);
  return (data ?? []) as Array<{ metric_type: string; metric_value: number; created_at: string }>;
}
