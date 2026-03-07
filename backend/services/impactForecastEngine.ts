/**
 * Impact Forecast Engine
 * Phase 7: Predicts outcome probability for recommendations.
 */

import { supabase } from '../db/supabaseClient';

export type ImpactForecast = {
  recommendation_id: string;
  recommendation_type: string;
  action_summary: string;
  predicted_outcome_probability: number;
  confidence: number;
  risk_level: 'low' | 'medium' | 'high';
  factors: { factor: string; weight: number }[];
};

export type ImpactForecastResult = {
  forecasts: ImpactForecast[];
  average_probability: number;
  run_id: string | null;
};

/**
 * Predict outcome probability for recommendations using historical and signal data.
 */
export async function predictOutcomeProbability(
  companyId: string,
  options?: {
    recommendationIds?: string[];
    limit?: number;
    persistRun?: boolean;
  }
): Promise<ImpactForecastResult> {
  const limit = Math.min(50, Math.max(1, options?.limit ?? 15));
  const since = new Date();
  since.setDate(since.getDate() - 90);
  const sinceStr = since.toISOString();

  const [recResult, outcomes, feedback] = await Promise.all([
    options?.recommendationIds?.length
      ? supabase
          .from('intelligence_recommendations')
          .select('id, recommendation_type, action_summary, confidence_score, supporting_signals')
          .eq('company_id', companyId)
          .in('id', options.recommendationIds)
      : supabase
          .from('intelligence_recommendations')
          .select('id, recommendation_type, action_summary, confidence_score, supporting_signals')
          .eq('company_id', companyId)
          .gte('created_at', sinceStr)
          .order('created_at', { ascending: false })
          .limit(limit),
    supabase
      .from('intelligence_outcomes')
      .select('recommendation_id, success_score')
      .eq('company_id', companyId)
      .gte('created_at', sinceStr),
    supabase
      .from('recommendation_feedback')
      .select('recommendation_id, feedback_score')
      .eq('company_id', companyId)
      .gte('created_at', sinceStr),
  ]);

  const recRows = (recResult.data ?? []) as Array<{
    id: string;
    recommendation_type: string;
    action_summary: string | null;
    confidence_score: number | null;
    supporting_signals: unknown;
  }>;
  const outcomeRows = (outcomes.data ?? []) as Array<{ recommendation_id: string | null; success_score: number | null }>;
  const feedbackRows = (feedback.data ?? []) as Array<{ recommendation_id: string; feedback_score: number | null }>;

  const histByRec = new Map<string, number[]>();
  for (const o of outcomeRows) {
    if (o.recommendation_id) {
      const arr = histByRec.get(o.recommendation_id) ?? [];
      arr.push(o.success_score ?? 0.5);
      histByRec.set(o.recommendation_id, arr);
    }
  }
  for (const f of feedbackRows) {
    const arr = histByRec.get(f.recommendation_id) ?? [];
    arr.push(f.feedback_score ?? 0.5);
    histByRec.set(f.recommendation_id, arr);
  }

  const globalAvg =
    outcomeRows.length > 0
      ? outcomeRows.reduce((s, o) => s + (o.success_score ?? 0.5), 0) / outcomeRows.length
      : feedbackRows.length > 0
        ? feedbackRows.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackRows.length
        : 0.5;

  const forecasts: ImpactForecast[] = recRows.map((r) => {
    const hist = histByRec.get(r.id);
    const histProb = hist?.length ? hist.reduce((a, b) => a + b, 0) / hist.length : globalAvg;
    const confidence = Math.max(0, Math.min(1, r.confidence_score ?? 0.5));
    const signalCount = Array.isArray(r.supporting_signals) ? r.supporting_signals.length : 0;
    const signalFactor = Math.min(1, signalCount / 5) * 0.15;

    const predictedProb = Math.max(
      0,
      Math.min(1, histProb * 0.5 + confidence * 0.4 + signalFactor + 0.1)
    );

    const riskLevel: 'low' | 'medium' | 'high' =
      predictedProb >= 0.6 ? 'low' : predictedProb >= 0.4 ? 'medium' : 'high';

    const factors = [
      { factor: 'historical_outcomes', weight: 0.5 },
      { factor: 'confidence_score', weight: 0.4 },
      { factor: 'supporting_signals', weight: Math.min(0.2, signalFactor) },
    ];

    return {
      recommendation_id: r.id,
      recommendation_type: r.recommendation_type,
      action_summary: r.action_summary ?? '',
      predicted_outcome_probability: Math.round(predictedProb * 1000) / 1000,
      confidence,
      risk_level: riskLevel,
      factors,
    };
  });

  const avgProb =
    forecasts.length > 0
      ? forecasts.reduce((s, f) => s + f.predicted_outcome_probability, 0) / forecasts.length
      : 0;

  let runId: string | null = null;
  if (options?.persistRun) {
    const { data } = await supabase
      .from('intelligence_simulation_runs')
      .insert({
        company_id: companyId,
        run_type: 'impact_forecast',
        scenario_type: null,
        input_recommendation_ids: recRows.map((r) => r.id),
        result_summary: {
          forecasts,
          average_probability: avgProb,
        },
      })
      .select('id')
      .single();
    runId = data?.id ?? null;
  }

  return {
    forecasts,
    average_probability: Math.round(avgProb * 1000) / 1000,
    run_id: runId,
  };
}
