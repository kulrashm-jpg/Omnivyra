import type { DecisionObjectWriteInput } from './decisionObjectService';

function clampScore(value: number): number {
  const normalized = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, normalized));
}

function clampConfidence(value: number): number {
  const normalized = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, normalized));
}

function round(value: number, precision = 3): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

export function standardizeDecisionScores(input: DecisionObjectWriteInput): DecisionObjectWriteInput {
  const impactTraffic = clampScore(Number(input.impact_traffic ?? 0));
  const impactConversion = clampScore(Number(input.impact_conversion ?? 0));
  const impactRevenue = clampScore(Number(input.impact_revenue ?? 0));
  const priorityScore = clampScore(Number(input.priority_score ?? 0));
  const effortScore = clampScore(Number(input.effort_score ?? 0));
  const confidenceScore = clampConfidence(Number(input.confidence_score ?? 0));

  // Unified operating score to keep scoring deterministic and comparable across engines.
  const blendedPriority = clampScore(
    (priorityScore * 0.55) +
    (Math.max(impactTraffic, impactConversion, impactRevenue) * 0.35) +
    ((100 - effortScore) * 0.1),
  );

  return {
    ...input,
    impact_traffic: round(impactTraffic, 2),
    impact_conversion: round(impactConversion, 2),
    impact_revenue: round(impactRevenue, 2),
    priority_score: round(blendedPriority, 2),
    effort_score: round(effortScore, 2),
    confidence_score: round(confidenceScore, 3),
  };
}
