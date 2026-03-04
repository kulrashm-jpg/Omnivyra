/**
 * Strategy Bias Service
 *
 * Computes an advisory strategy_bias_weight from drift severity, intelligence level,
 * and priority pressure. For planner context attachment only — not used in prompts or decisions.
 * No planner logic change, no prompt mutation, no automatic strategy mutation.
 */

import { detectStrategicDrift } from './strategicDriftService';
import { getWeeklyStrategyIntelligence } from './weeklyStrategyIntelligenceService';
import { getStrategyAwareness } from './strategyAwarenessService';

export type StrategyBiasResult = {
  bias_weight: number;
  bias_level: 'LOW' | 'MODERATE' | 'HIGH';
  bias_reasoning: string[];
};

const BASE_WEIGHT = 0.1;
const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 1.0;
const DRIFT_HIGH_DELTA = 0.4;
const DRIFT_MEDIUM_DELTA = 0.2;
const INTELLIGENCE_HIGH_DELTA = 0.2;
const PRIORITY_PRESSURE_DELTA = 0.2;
const HIGH_PRIORITY_THRESHOLD = 5;

const LEVEL_LOW_MAX = 0.3;
const LEVEL_MODERATE_MAX = 0.6;

/**
 * Compute advisory strategy bias from drift, intelligence, and awareness.
 * Deterministic. Clamped to [0.1, 1.0]. Advisory only — not used in prompt or decision tree.
 */
export async function computeStrategyBias(campaign_id: string): Promise<StrategyBiasResult> {
  const [drift, intelligence, awareness] = await Promise.all([
    detectStrategicDrift(campaign_id),
    getWeeklyStrategyIntelligence(campaign_id),
    getStrategyAwareness(campaign_id),
  ]);

  let weight = BASE_WEIGHT;
  const reasoning: string[] = [];

  if (drift.severity === 'HIGH') {
    weight += DRIFT_HIGH_DELTA;
    reasoning.push('Drift severity HIGH (+0.4).');
  } else if (drift.severity === 'MEDIUM') {
    weight += DRIFT_MEDIUM_DELTA;
    reasoning.push('Drift severity MEDIUM (+0.2).');
  }

  const intelligenceLevel = intelligence.intelligence_level ?? 'LOW';
  if (intelligenceLevel === 'HIGH') {
    weight += INTELLIGENCE_HIGH_DELTA;
    reasoning.push('Intelligence level HIGH (+0.2).');
  }

  const highPriority = intelligence.ai_pressure?.high_priority_actions ?? 0;
  if (highPriority >= HIGH_PRIORITY_THRESHOLD) {
    weight += PRIORITY_PRESSURE_DELTA;
    reasoning.push(`High priority actions >= ${HIGH_PRIORITY_THRESHOLD} (+0.2).`);
  }

  const clamped = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, Math.round(weight * 100) / 100));

  let bias_level: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  if (clamped > LEVEL_MODERATE_MAX) bias_level = 'HIGH';
  else if (clamped >= LEVEL_LOW_MAX) bias_level = 'MODERATE';

  if (reasoning.length === 0) {
    reasoning.push('Base weight only; no drift or pressure adjustments.');
  }
  reasoning.push(`Awareness level: ${awareness.awareness_level ?? 'LOW'}.`);

  return {
    bias_weight: clamped,
    bias_level,
    bias_reasoning: reasoning,
  };
}
