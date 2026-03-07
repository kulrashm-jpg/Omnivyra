/**
 * Strategy Comparison Engine
 * Phase 7: Ranks strategies/recommendations by predicted impact.
 */

import { supabase } from '../db/supabaseClient';
import type { ImpactForecast } from './impactForecastEngine';
import { predictOutcomeProbability } from './impactForecastEngine';

export type RankedStrategy = {
  rank: number;
  recommendation_id: string;
  recommendation_type: string;
  action_summary: string;
  ranking_score: number;
  predicted_impact: number;
  outcome_probability: number;
  recommendation_confidence: number;
};

export type StrategyComparisonResult = {
  ranked_strategies: RankedStrategy[];
  run_id: string | null;
};

/**
 * Rank strategies (recommendations) by predicted impact and outcome probability.
 */
export async function rankStrategies(
  companyId: string,
  options?: {
    recommendationIds?: string[];
    limit?: number;
    persistRun?: boolean;
  }
): Promise<StrategyComparisonResult> {
  const forecastResult = await predictOutcomeProbability(companyId, {
    recommendationIds: options?.recommendationIds,
    limit: options?.limit ?? 15,
    persistRun: false,
  });

  const ranked: RankedStrategy[] = forecastResult.forecasts
    .map((f: ImpactForecast) => ({
      rank: 0,
      recommendation_id: f.recommendation_id,
      recommendation_type: f.recommendation_type,
      action_summary: f.action_summary,
      ranking_score: f.predicted_outcome_probability * 0.6 + f.confidence * 0.4,
      predicted_impact: f.predicted_outcome_probability,
      outcome_probability: f.predicted_outcome_probability,
      recommendation_confidence: f.confidence,
    }))
    .sort((a, b) => b.ranking_score - a.ranking_score)
    .map((r, i) => ({ ...r, rank: i + 1 }))
    .map((r) => ({
      ...r,
      ranking_score: Math.round(r.ranking_score * 1000) / 1000,
      predicted_impact: Math.round(r.predicted_impact * 1000) / 1000,
      outcome_probability: Math.round(r.outcome_probability * 1000) / 1000,
    }));

  let runId: string | null = null;
  if (options?.persistRun) {
    const { data } = await supabase
      .from('intelligence_simulation_runs')
      .insert({
        company_id: companyId,
        run_type: 'strategy_comparison',
        scenario_type: null,
        input_recommendation_ids: ranked.map((r) => r.recommendation_id),
        result_summary: { ranked_strategies: ranked },
      })
      .select('id')
      .single();
    runId = data?.id ?? null;
  }

  return {
    ranked_strategies: ranked,
    run_id: runId,
  };
}

/**
 * Fetch past simulation runs for a company.
 */
export async function getSimulationRuns(
  companyId: string,
  options?: { runType?: string; limit?: number }
): Promise<
  Array<{
    id: string;
    run_type: string;
    scenario_type: string | null;
    result_summary: unknown;
    created_at: string;
  }>
> {
  let query = supabase
    .from('intelligence_simulation_runs')
    .select('id, run_type, scenario_type, result_summary, created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 20);

  if (options?.runType) {
    query = query.eq('run_type', options.runType);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch simulation runs: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    run_type: string;
    scenario_type: string | null;
    result_summary: unknown;
    created_at: string;
  }>;
}
