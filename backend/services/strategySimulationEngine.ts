/**
 * Strategy Simulation Engine
 * Phase 7: Simulates recommendation impact using historical outcomes.
 */

import { supabase } from '../db/supabaseClient';

export type SimulatedRecommendationImpact = {
  recommendation_id: string | null;
  recommendation_type: string;
  action_summary: string;
  simulated_impact_score: number;
  expected_outcome_probability: number;
  supporting_signal_count: number;
};

export type SimulationRunResult = {
  run_id: string | null;
  recommendations: SimulatedRecommendationImpact[];
  aggregate_impact: number;
  total_recommendations: number;
};

/**
 * Simulate recommendation impact for a company.
 * Uses historical success rates to project impact for given or latest recommendations.
 */
export async function simulateRecommendationImpact(
  companyId: string,
  options?: {
    recommendationIds?: string[];
    windowDays?: number;
    persistRun?: boolean;
  }
): Promise<SimulationRunResult> {
  const windowDays = Math.min(90, Math.max(1, options?.windowDays ?? 30));
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceStr = since.toISOString();

  const [outcomes, feedback, recs] = await Promise.all([
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
    options?.recommendationIds?.length
      ? supabase
          .from('intelligence_recommendations')
          .select('id, recommendation_type, action_summary, supporting_signals, confidence_score')
          .eq('company_id', companyId)
          .in('id', options.recommendationIds)
      : supabase
          .from('intelligence_recommendations')
          .select('id, recommendation_type, action_summary, supporting_signals, confidence_score')
          .eq('company_id', companyId)
          .gte('created_at', sinceStr)
          .order('created_at', { ascending: false })
          .limit(20),
  ]);

  const outcomeRows = (outcomes.data ?? []) as Array<{ recommendation_id: string | null; success_score: number | null }>;
  const feedbackRows = (feedback.data ?? []) as Array<{ recommendation_id: string; feedback_score: number | null }>;
  const recRows = (recs.data ?? []) as Array<{
    id: string;
    recommendation_type: string;
    action_summary: string | null;
    supporting_signals: unknown;
    confidence_score: number | null;
  }>;

  const successByRec = new Map<string, number[]>();
  for (const o of outcomeRows) {
    if (o.recommendation_id) {
      const arr = successByRec.get(o.recommendation_id) ?? [];
      arr.push(o.success_score ?? 0.5);
      successByRec.set(o.recommendation_id, arr);
    }
  }
  for (const f of feedbackRows) {
    const arr = successByRec.get(f.recommendation_id) ?? [];
    arr.push(f.feedback_score ?? 0.5);
    successByRec.set(f.recommendation_id, arr);
  }

  const globalAvgSuccess =
    outcomeRows.length > 0
      ? outcomeRows.reduce((s, o) => s + (o.success_score ?? 0.5), 0) / outcomeRows.length
      : feedbackRows.length > 0
        ? feedbackRows.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackRows.length
        : 0.5;

  const simulated: SimulatedRecommendationImpact[] = recRows.map((r) => {
    const historicalSuccesses = successByRec.get(r.id);
    const expectedProb =
      historicalSuccesses?.length > 0
        ? historicalSuccesses.reduce((a, b) => a + b, 0) / historicalSuccesses.length
        : globalAvgSuccess;

    const signalCount = Array.isArray(r.supporting_signals) ? r.supporting_signals.length : 0;
    const confidence = Math.max(0, Math.min(1, r.confidence_score ?? 0.5));
    const simulatedImpact = Math.min(1, expectedProb * 0.5 + confidence * 0.4 + Math.min(1, signalCount / 5) * 0.1);

    return {
      recommendation_id: r.id,
      recommendation_type: r.recommendation_type,
      action_summary: r.action_summary ?? '',
      simulated_impact_score: Math.round(simulatedImpact * 1000) / 1000,
      expected_outcome_probability: Math.round(expectedProb * 1000) / 1000,
      supporting_signal_count: signalCount,
    };
  });

  const aggregateImpact =
    simulated.length > 0
      ? simulated.reduce((s, r) => s + r.simulated_impact_score, 0) / simulated.length
      : 0;

  let runId: string | null = null;
  if (options?.persistRun) {
    const { data } = await supabase
      .from('intelligence_simulation_runs')
      .insert({
        company_id: companyId,
        run_type: 'impact_simulation',
        scenario_type: null,
        input_recommendation_ids: recRows.map((r) => r.id),
        result_summary: {
          aggregate_impact: aggregateImpact,
          total_recommendations: simulated.length,
          recommendations: simulated,
        },
      })
      .select('id')
      .single();
    runId = data?.id ?? null;
  }

  return {
    run_id: runId,
    recommendations: simulated,
    aggregate_impact: Math.round(aggregateImpact * 1000) / 1000,
    total_recommendations: simulated.length,
  };
}
