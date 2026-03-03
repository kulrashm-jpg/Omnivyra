/**
 * Strategy Awareness Service
 *
 * Unifies Strategy Confidence (from existing week/blueprint signals) with
 * Engagement Intelligence into a single read-only awareness object.
 * READ + COMPOSE only. No UI, no mutations, no AI, no planner changes.
 */

import { getWeeklyStrategyIntelligence } from './weeklyStrategyIntelligenceService';
import { getUnifiedCampaignBlueprint } from './campaignBlueprintService';
import { getAiStrategicConfidence } from '../../lib/aiStrategicConfidence';

export type StrategyAwareness = {
  awareness_level: 'LOW' | 'MEDIUM' | 'HIGH';
  strategy_confidence: {
    label: string | null;
    signals: string[];
  };
  engagement_intelligence: {
    intelligence_level: 'LOW' | 'MEDIUM' | 'HIGH';
    ai_pressure: {
      high_priority_actions: number;
      medium_priority_actions: number;
      low_priority_actions: number;
    };
    strategic_insights: string[];
  };
  awareness_summary: string[];
};

/** Strong-momentum phrases in confidence label (reuse of existing narrative). */
const STRONG_MOMENTUM_PHRASES = ['adapting', 'stable', 'steadily', 'progressing'];

function indicatesStrongMomentum(label: string | null): boolean {
  if (!label) return false;
  const lower = label.toLowerCase();
  return STRONG_MOMENTUM_PHRASES.some((p) => lower.includes(p));
}

/**
 * Deterministic awareness level:
 * HIGH if strategy_confidence indicates strong momentum OR intelligence_level = HIGH.
 * MEDIUM if confidence exists (label) OR intelligence_level = MEDIUM.
 * LOW otherwise.
 */
function computeAwarenessLevel(
  confidenceLabel: string | null,
  intelligenceLevel: 'LOW' | 'MEDIUM' | 'HIGH'
): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (indicatesStrongMomentum(confidenceLabel) || intelligenceLevel === 'HIGH') return 'HIGH';
  if (confidenceLabel != null && confidenceLabel !== '' || intelligenceLevel === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

/**
 * Deterministic short summary strings. No AI.
 */
function buildAwarenessSummary(
  awarenessLevel: string,
  intelligenceLevel: string,
  aiPressure: { high_priority_actions: number; medium_priority_actions: number; low_priority_actions: number },
  hasStrategicInsights: boolean,
  confidenceLabel: string | null
): string[] {
  const lines: string[] = [];

  if (aiPressure.high_priority_actions >= 3 || intelligenceLevel === 'HIGH') {
    lines.push('High engagement pressure detected.');
  }
  if (indicatesStrongMomentum(confidenceLabel)) {
    lines.push('Strategic confidence strong.');
  }
  if (awarenessLevel === 'LOW' && !hasStrategicInsights && aiPressure.high_priority_actions === 0) {
    lines.push('Low engagement signals — strategy may need testing.');
  }
  if (intelligenceLevel === 'MEDIUM' && lines.length === 0) {
    lines.push('Moderate engagement and strategy signals present.');
  }

  return lines;
}

/**
 * Get unified strategy awareness for a campaign.
 * Composes: weekly strategy intelligence + existing strategy confidence (from blueprint week).
 */
export async function getStrategyAwareness(campaign_id: string): Promise<StrategyAwareness> {
  const [intelligence, blueprint] = await Promise.all([
    getWeeklyStrategyIntelligence(campaign_id),
    getUnifiedCampaignBlueprint(campaign_id),
  ]);

  let confidenceLabel: string | null = null;
  const signals: string[] = [];

  if (blueprint?.weeks?.length) {
    const week = blueprint.weeks[0];
    confidenceLabel = getAiStrategicConfidence(week as any);
    if (confidenceLabel) {
      signals.push(confidenceLabel);
    }
  }

  const awareness_level = computeAwarenessLevel(confidenceLabel, intelligence.intelligence_level);

  const awareness_summary = buildAwarenessSummary(
    awareness_level,
    intelligence.intelligence_level,
    intelligence.ai_pressure,
    (intelligence.strategic_insights?.length ?? 0) > 0,
    confidenceLabel
  );

  return {
    awareness_level,
    strategy_confidence: {
      label: confidenceLabel,
      signals,
    },
    engagement_intelligence: {
      intelligence_level: intelligence.intelligence_level,
      ai_pressure: intelligence.ai_pressure,
      strategic_insights: intelligence.strategic_insights ?? [],
    },
    awareness_summary,
  };
}
