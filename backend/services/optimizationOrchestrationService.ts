/**
 * Optimization Orchestration Service
 * Phase 6: Orchestrates all optimization engines.
 * Execution control delegated to intelligenceExecutionController.
 */

import { evaluateStrategyPerformance } from './strategyPerformanceEngine';
import { computeOptimizedWeights } from './signalWeightOptimizationEngine';
import { evolveThemes } from './themeEvolutionEngine';
import { computeRecommendationOptimization } from './recommendationOptimizationEngine';
import {
  computeAndPersistQualityMetrics,
  getQualityMetrics,
} from './intelligenceQualityEngine';
import {
  canRunOptimization as controllerCanRunOptimization,
  recordExecution,
  recordExecutionSkipped,
} from './intelligenceExecutionController';

/**
 * Check if optimization can run (delegates to execution controller).
 */
export async function canRunOptimization(companyId: string): Promise<boolean> {
  return controllerCanRunOptimization(companyId);
}

/**
 * Run full optimization for a company. Returns all optimization results.
 * Requires controller approval; records execution on success.
 */
export async function runOptimizationForCompany(companyId: string): Promise<{
  strategy_performance: Awaited<ReturnType<typeof evaluateStrategyPerformance>>;
  signal_weights: Awaited<ReturnType<typeof computeOptimizedWeights>>;
  theme_evolution: Awaited<ReturnType<typeof evolveThemes>>;
  recommendation_optimization: Awaited<ReturnType<typeof computeRecommendationOptimization>>;
  quality_metrics: Awaited<ReturnType<typeof computeAndPersistQualityMetrics>>;
}> {
  const start = Date.now();
  const [strategy_performance, signal_weights, theme_evolution, recommendation_optimization, quality_metrics] =
    await Promise.all([
      evaluateStrategyPerformance(companyId),
      computeOptimizedWeights(companyId),
      evolveThemes(companyId),
      computeRecommendationOptimization(companyId),
      computeAndPersistQualityMetrics(companyId),
    ]);

  await recordExecution(companyId, 'optimization_run', {
    status: 'success',
    latencyMs: Date.now() - start,
  });

  return {
    strategy_performance,
    signal_weights,
    theme_evolution,
    recommendation_optimization,
    quality_metrics,
  };
}

/**
 * Get optimization data without running optimization (read-only).
 */
export async function getOptimizationData(companyId: string): Promise<{
  strategy_performance: Awaited<ReturnType<typeof evaluateStrategyPerformance>>;
  signal_weights: Awaited<ReturnType<typeof computeOptimizedWeights>>;
  recommendation_optimization: Awaited<ReturnType<typeof computeRecommendationOptimization>>;
  quality_metrics_history: Awaited<ReturnType<typeof getQualityMetrics>>;
}> {
  const [strategy_performance, signal_weights, recommendation_optimization, quality_metrics_history] =
    await Promise.all([
      evaluateStrategyPerformance(companyId),
      computeOptimizedWeights(companyId),
      computeRecommendationOptimization(companyId),
      getQualityMetrics(companyId, { limit: 7 }),
    ]);

  return {
    strategy_performance,
    signal_weights,
    recommendation_optimization,
    quality_metrics_history,
  };
}
