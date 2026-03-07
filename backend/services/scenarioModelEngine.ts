/**
 * Scenario Model Engine
 * Phase 7: Models optimistic, base, and pessimistic scenarios.
 */

import { supabase } from '../db/supabaseClient';

export type ScenarioType = 'optimistic' | 'base' | 'pessimistic';

export type ScenarioResult = {
  scenario_type: ScenarioType;
  outcome_probability: number;
  impact_multiplier: number;
  description: string;
  assumptions: string[];
};

const SCENARIO_PARAMS: Record<
  ScenarioType,
  { outcome_multiplier: number; impact_multiplier: number; description: string }
> = {
  optimistic: {
    outcome_multiplier: 1.25,
    impact_multiplier: 1.2,
    description: 'Best-case: favorable market, strong execution',
  },
  base: {
    outcome_multiplier: 1.0,
    impact_multiplier: 1.0,
    description: 'Base case: historical average performance',
  },
  pessimistic: {
    outcome_multiplier: 0.7,
    impact_multiplier: 0.75,
    description: 'Worst-case: headwinds, execution delays',
  },
};

/**
 * Model scenarios for a company using historical outcome data.
 */
export async function modelScenarios(
  companyId: string,
  options?: {
    scenarioTypes?: ScenarioType[];
  }
): Promise<ScenarioResult[]> {
  const scenarioTypes = options?.scenarioTypes ?? ['optimistic', 'base', 'pessimistic'];

  const { data: outcomes } = await supabase
    .from('intelligence_outcomes')
    .select('success_score')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200);

  const { data: feedback } = await supabase
    .from('recommendation_feedback')
    .select('feedback_score')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(200);

  const outcomeScores = (outcomes ?? []) as Array<{ success_score: number | null }>;
  const feedbackScores = (feedback ?? []) as Array<{ feedback_score: number | null }>;

  const baseProb =
    outcomeScores.length > 0
      ? outcomeScores.reduce((s, o) => s + (o.success_score ?? 0.5), 0) / outcomeScores.length
      : feedbackScores.length > 0
        ? feedbackScores.reduce((s, f) => s + (f.feedback_score ?? 0.5), 0) / feedbackScores.length
        : 0.5;

  return scenarioTypes.map((t) => {
    const params = SCENARIO_PARAMS[t];
    const outcomeProb = Math.max(0, Math.min(1, baseProb * params.outcome_multiplier));
    const assumptions: string[] = [];
    if (t === 'optimistic') assumptions.push('Market conditions favorable', 'Timely execution');
    if (t === 'pessimistic') assumptions.push('Potential delays', 'Competitive pressure');
    if (t === 'base') assumptions.push('Historical average', 'No major shifts');

    return {
      scenario_type: t,
      outcome_probability: Math.round(outcomeProb * 1000) / 1000,
      impact_multiplier: params.impact_multiplier,
      description: params.description,
      assumptions,
    };
  });
}

/**
 * Persist a scenario run.
 */
export async function persistScenarioRun(
  companyId: string,
  scenarioType: ScenarioType,
  results: ScenarioResult[]
): Promise<string | null> {
  const { data } = await supabase
    .from('intelligence_simulation_runs')
    .insert({
      company_id: companyId,
      run_type: 'scenario_model',
      scenario_type: scenarioType,
      input_recommendation_ids: [],
      result_summary: { scenarios: results },
    })
    .select('id')
    .single();
  return data?.id ?? null;
}
