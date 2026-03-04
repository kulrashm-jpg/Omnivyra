/**
 * Strategic Drift Detection Service
 *
 * Deterministic read-only signal: detects misalignment between
 * Strategy Confidence, Engagement Intelligence, and Temporal Trend.
 * No planner mutation, no UI, no AI, no automatic actions.
 */

import { getStrategyAwareness } from './strategyAwarenessService';
import { getWeeklyStrategyIntelligence } from './weeklyStrategyIntelligenceService';
import { getStrategicMemoryTrend } from './strategicMemoryService';

export type StrategicDriftResult = {
  drift_detected: boolean;
  drift_type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  summary: string[];
};

const STRONG_MOMENTUM_PHRASES = ['adapting', 'stable', 'steadily', 'progressing'];

function isConfidenceStrong(label: string | null): boolean {
  if (!label || typeof label !== 'string') return false;
  const lower = label.toLowerCase();
  return STRONG_MOMENTUM_PHRASES.some((p) => lower.includes(p));
}

function hasNegativeMessagingRisk(insights: string[]): boolean {
  if (!Array.isArray(insights)) return false;
  for (const s of insights) {
    const lower = String(s).toLowerCase();
    if (lower.includes('negative') && (lower.includes('messaging') || lower.includes('product clarity') || lower.includes('review'))) return true;
    if (lower.includes('negative feedback detected')) return true;
  }
  return false;
}

/**
 * Detect strategic drift from awareness, intelligence, and trend.
 * Deterministic rules only. No AI, no mutation.
 */
export async function detectStrategicDrift(campaign_id: string): Promise<StrategicDriftResult> {
  const [awareness, intelligence, trend] = await Promise.all([
    getStrategyAwareness(campaign_id),
    getWeeklyStrategyIntelligence(campaign_id),
    getStrategicMemoryTrend(campaign_id),
  ]);

  const confidenceLabel = awareness.strategy_confidence?.label ?? null;
  const confidenceStrong = isConfidenceStrong(confidenceLabel);
  const intelligenceLevel = intelligence.intelligence_level ?? 'LOW';
  const awarenessLevel = awareness.awareness_level ?? 'LOW';
  const strategicInsights = awareness.engagement_intelligence?.strategic_insights ?? intelligence.strategic_insights ?? [];
  const trendValue = trend.trend;

  const summary: string[] = [];

  // Case A — Confidence High, Engagement Low, Trend Declining
  if (confidenceStrong && intelligenceLevel === 'LOW' && trendValue === 'DECLINING') {
    return {
      drift_detected: true,
      drift_type: 'CONFIDENCE_OVER_ESTIMATION',
      severity: 'HIGH',
      summary: [
        'Strategy confidence is strong but engagement intelligence is low and trend is declining.',
        'Possible over-estimation of strategy effectiveness.',
      ],
    };
  }

  // Case B — Confidence Low/Null, Engagement Medium or High, Trend Improving
  if (!confidenceStrong && (intelligenceLevel === 'MEDIUM' || intelligenceLevel === 'HIGH') && trendValue === 'IMPROVING') {
    return {
      drift_detected: true,
      drift_type: 'UNDERVALUED_STRATEGY',
      severity: 'MEDIUM',
      summary: [
        'Engagement is improving with medium or high intelligence while strategy confidence is weak or absent.',
        'Strategy may be undervalued relative to actual performance.',
      ],
    };
  }

  // Case C — Awareness High, Negative Messaging Risk in Insights, Trend Stable or Declining
  if (
    awarenessLevel === 'HIGH' &&
    hasNegativeMessagingRisk(strategicInsights) &&
    (trendValue === 'STABLE' || trendValue === 'DECLINING')
  ) {
    return {
      drift_detected: true,
      drift_type: 'REPUTATION_RISK_DRIFT',
      severity: 'HIGH',
      summary: [
        'High awareness with negative messaging risk in strategic insights and stable or declining trend.',
        'Reputation risk drift detected.',
      ],
    };
  }

  return {
    drift_detected: false,
    drift_type: 'NONE',
    severity: 'LOW',
    summary: ['No strategic drift detected. Confidence, engagement, and trend are aligned.'],
  };
}
