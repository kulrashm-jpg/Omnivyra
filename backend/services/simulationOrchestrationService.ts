/**
 * Simulation Orchestration Service
 * Phase 7: Orchestrates strategy simulation, scenarios, impact forecast, and comparison.
 */

import { simulateRecommendationImpact } from './strategySimulationEngine';
import { modelScenarios, persistScenarioRun } from './scenarioModelEngine';
import { predictOutcomeProbability } from './impactForecastEngine';
import { rankStrategies, getSimulationRuns } from './strategyComparisonEngine';

export type SimulationRunOptions = {
  companyId: string;
  recommendationIds?: string[];
  persistRuns?: boolean;
};

/**
 * Run full simulation suite: impact simulation, scenarios, forecast, strategy ranking.
 */
export async function runFullSimulation(options: SimulationRunOptions) {
  const { companyId, recommendationIds, persistRuns = false } = options;

  const [impact, scenarios, forecast, comparison] = await Promise.all([
    simulateRecommendationImpact(companyId, { recommendationIds, persistRun: persistRuns }),
    modelScenarios(companyId),
    predictOutcomeProbability(companyId, { recommendationIds, persistRun: persistRuns }),
    rankStrategies(companyId, { recommendationIds, persistRun: persistRuns }),
  ]);

  if (persistRuns && scenarios.length > 0) {
    await persistScenarioRun(companyId, 'base', scenarios);
  }

  return {
    impact_simulation: impact,
    scenarios,
    impact_forecast: forecast,
    strategy_comparison: comparison,
  };
}

export { simulateRecommendationImpact, modelScenarios, predictOutcomeProbability, rankStrategies, getSimulationRuns };
