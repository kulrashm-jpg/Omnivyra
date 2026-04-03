/**
 * Intelligence Learning Module
 * Consolidates: outcomeTrackingEngine, recommendationFeedbackEngine, intelligenceLearningEngine,
 * themeReinforcementEngine, strategyPerformanceEngine, signalWeightOptimizationEngine,
 * recommendationOptimizationEngine, intelligenceQualityEngine
 *
 * Responsibilities: outcome tracking, learning reinforcement, strategy performance evaluation,
 * optimization, quality metrics. Safeguard: max_weight_change = ±0.15
 *
 * Engines remain in place; this module exposes a unified interface.
 */

import { recordOutcome, getOutcomeHistory } from './outcomeTrackingEngine';
import { recordFeedback, getFeedbackForCompany } from './recommendationFeedbackEngine';
import {
  computeLearningForCompany,
  applyAdjustment,
  ADJUSTMENT_MAX,
  ADJUSTMENT_MIN,
} from './intelligenceLearningEngine';
import { computeThemeReinforcement, persistThemeReinforcement } from './themeReinforcementEngine';
import { evaluateStrategyPerformance } from './strategyPerformanceEngine';
import {
  computeOptimizedWeights,
  persistOptimizedWeights,
  MAX_WEIGHT_CHANGE,
} from './signalWeightOptimizationEngine';
import { computeRecommendationOptimization } from './recommendationOptimizationEngine';
import {
  computeAndPersistQualityMetrics,
  getQualityMetrics,
} from './intelligenceQualityEngine';

export { MAX_WEIGHT_CHANGE, ADJUSTMENT_MIN, ADJUSTMENT_MAX };

export type { OutcomeRecord, OutcomeRow } from './outcomeTrackingEngine';
export type { FeedbackRecord, FeedbackType } from './recommendationFeedbackEngine';
export type { LearningAdjustment } from './intelligenceLearningEngine';
export type { ThemeReinforcementResult } from './themeReinforcementEngine';
export type { StrategyPerformanceResult } from './strategyPerformanceEngine';
export type { SignalWeightResult } from './signalWeightOptimizationEngine';
export type { RecommendationOptimizationResult } from './recommendationOptimizationEngine';
export type { QualityMetrics } from './intelligenceQualityEngine';

/**
 * Process learning: outcomes, feedback, learning adjustments, theme reinforcement.
 */
export async function processLearning(companyId: string) {
  const [outcomes, feedback, learning, theme_reinforcement] = await Promise.all([
    getOutcomeHistory(companyId),
    getFeedbackForCompany(companyId),
    computeLearningForCompany(companyId),
    computeThemeReinforcement(companyId),
  ]);
  return { learning, theme_reinforcement };
}

/**
 * Record outcome.
 */
export { recordOutcome, getOutcomeHistory };

/**
 * Record feedback.
 */
export { recordFeedback, getFeedbackForCompany };

/**
 * Compute learning adjustments.
 */
export { computeLearningForCompany, applyAdjustment };

/**
 * Theme reinforcement.
 */
export { computeThemeReinforcement, persistThemeReinforcement };

/**
 * Strategy performance evaluation.
 */
export { evaluateStrategyPerformance };

/**
 * Signal weight optimization (bounded ±0.15).
 */
export { computeOptimizedWeights, persistOptimizedWeights };

/**
 * Recommendation optimization.
 */
export { computeRecommendationOptimization };

/**
 * Quality metrics.
 */
export { computeAndPersistQualityMetrics, getQualityMetrics };
