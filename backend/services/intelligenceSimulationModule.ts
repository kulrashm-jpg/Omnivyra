/**
 * Intelligence Simulation Module
 * Consolidates: strategySimulationEngine, scenarioModelEngine, impactForecastEngine,
 * strategyComparisonEngine, simulationOrchestrationService
 *
 * Responsibilities: simulation, scenario modeling, impact forecasting, strategy comparison.
 * Safeguard: max_simulation_runs_per_hour = 10
 *
 * Engines remain in place; this module exposes a unified interface.
 */

import { canRunSimulation, recordExecution, recordExecutionSkipped } from './intelligenceExecutionController';
import { simulateRecommendationImpact } from './strategySimulationEngine';
import { modelScenarios, persistScenarioRun } from './scenarioModelEngine';
import { predictOutcomeProbability } from './impactForecastEngine';
import { rankStrategies, getSimulationRuns } from './strategyComparisonEngine';

export const MAX_SIMULATION_RUNS_PER_HOUR = 10;

const runCountByCompany = new Map<string, { count: number; hourStart: number }>();

function checkSimulationThrottle(companyId: string): boolean {
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const currentHour = Math.floor(now / hourMs);

  const entry = runCountByCompany.get(companyId);
  if (!entry) {
    runCountByCompany.set(companyId, { count: 1, hourStart: currentHour });
    return true;
  }

  if (entry.hourStart !== currentHour) {
    runCountByCompany.set(companyId, { count: 1, hourStart: currentHour });
    return true;
  }

  if (entry.count >= MAX_SIMULATION_RUNS_PER_HOUR) {
    return false;
  }
  entry.count++;
  return true;
}

export type { SimulatedRecommendationImpact, SimulationRunResult } from './strategySimulationEngine';
export type { ScenarioResult, ScenarioType } from './scenarioModelEngine';
export type { ImpactForecast, ImpactForecastResult } from './impactForecastEngine';
export type { RankedStrategy, StrategyComparisonResult } from './strategyComparisonEngine';

/**
 * Run full simulation suite. Requires controller approval; records execution on success.
 */
export async function runSimulations(
  companyId: string,
  options?: { recommendationIds?: string[]; persistRuns?: boolean }
) {
  const allowed = await canRunSimulation(companyId);
  if (!allowed) {
    await recordExecutionSkipped(companyId, 'simulation_run', 'max_simulations_per_hour');
    throw new Error(
      `Simulation limit exceeded: max ${MAX_SIMULATION_RUNS_PER_HOUR} runs per hour`
    );
  }

  const start = Date.now();
  const [impact, scenarios, forecast, comparison] = await Promise.all([
    simulateRecommendationImpact(companyId, {
      recommendationIds: options?.recommendationIds,
      persistRun: options?.persistRuns ?? false,
    }),
    modelScenarios(companyId),
    predictOutcomeProbability(companyId, {
      recommendationIds: options?.recommendationIds,
      persistRun: options?.persistRuns ?? false,
    }),
    rankStrategies(companyId, {
      recommendationIds: options?.recommendationIds,
      persistRun: options?.persistRuns ?? false,
    }),
  ]);

  if (options?.persistRuns && scenarios.length > 0) {
    await persistScenarioRun(companyId, 'base', scenarios);
  }

  await recordExecution(companyId, 'simulation_run', {
    status: 'success',
    latencyMs: Date.now() - start,
  });

  return {
    impact_simulation: impact,
    scenarios,
    impact_forecast: forecast,
    strategy_comparison: comparison,
  };
}

export { simulateRecommendationImpact, modelScenarios, predictOutcomeProbability, rankStrategies, getSimulationRuns };
