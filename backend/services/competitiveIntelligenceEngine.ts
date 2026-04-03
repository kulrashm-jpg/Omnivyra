/**
 * Competitive Intelligence Engine
 * Phase 4: Detects competitor activities: product launch, pricing shift, strategy shift, market expansion.
 */

import type { CompanyIntelligenceInsights } from './companyIntelligenceAggregator';
import {
  archiveDecisionScope,
  createDecisionObjects,
  type PersistedDecisionObject,
} from './decisionObjectService';

export type CompetitiveSignalType =
  | 'product_launch'
  | 'pricing_shift'
  | 'strategy_shift'
  | 'market_expansion';

export type CompetitiveIntelligence = {
  signal_type: CompetitiveSignalType;
  confidence: number;
  summary: string;
  supporting_signals: Array<{ signal_id: string; topic: string }>;
};

const PRODUCT_LAUNCH_PATTERN = /launch|release|introduc|unveil|announce|new product|product launch/i;
const PRICING_PATTERN = /pricing|price|cost|discount|tier|subscription|pricing shift/i;
const STRATEGY_PATTERN = /strategy|pivot|rebrand|reposition|focus shift|strategic/i;
const MARKET_EXPANSION_PATTERN = /expansion|expand|new market|geographic|region|international|global/i;

/**
 * Detect competitive intelligence from company insights.
 */
export function detectCompetitiveIntelligence(
  insights: CompanyIntelligenceInsights
): CompetitiveIntelligence[] {
  const signals: CompetitiveIntelligence[] = [];

  for (const comp of insights.competitor_activity) {
    for (const s of comp.signals) {
      const topic = (s.topic ?? '').trim();
      if (!topic) continue;

      if (PRODUCT_LAUNCH_PATTERN.test(topic)) {
        signals.push({
          signal_type: 'product_launch',
          confidence: 0.5 + s.relevance_score * 0.3,
          summary: topic.slice(0, 120),
          supporting_signals: comp.signals.map((x) => ({ signal_id: x.signal_id, topic: x.topic })),
        });
        break;
      }
      if (PRICING_PATTERN.test(topic)) {
        signals.push({
          signal_type: 'pricing_shift',
          confidence: 0.5 + s.relevance_score * 0.25,
          summary: topic.slice(0, 120),
          supporting_signals: comp.signals.map((x) => ({ signal_id: x.signal_id, topic: x.topic })),
        });
        break;
      }
      if (STRATEGY_PATTERN.test(topic)) {
        signals.push({
          signal_type: 'strategy_shift',
          confidence: 0.5 + s.relevance_score * 0.25,
          summary: topic.slice(0, 120),
          supporting_signals: comp.signals.map((x) => ({ signal_id: x.signal_id, topic: x.topic })),
        });
        break;
      }
      if (MARKET_EXPANSION_PATTERN.test(topic)) {
        signals.push({
          signal_type: 'market_expansion',
          confidence: 0.5 + s.relevance_score * 0.3,
          summary: topic.slice(0, 120),
          supporting_signals: comp.signals.map((x) => ({ signal_id: x.signal_id, topic: x.topic })),
        });
        break;
      }
    }
  }

  for (const shift of insights.market_shifts) {
    const topic = (shift.topic ?? '').trim();
    if (!topic) continue;
    if (MARKET_EXPANSION_PATTERN.test(topic) && !signals.some((s) => s.signal_type === 'market_expansion' && s.summary.includes(topic.slice(0, 30)))) {
      signals.push({
        signal_type: 'market_expansion',
        confidence: Math.min(1, shift.avg_impact * 0.8),
        summary: topic.slice(0, 120),
        supporting_signals: [],
      });
    }
  }

  return signals
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 15);
}

export async function persistCompetitiveIntelligenceDecisions(params: {
  companyId: string;
  insights: CompanyIntelligenceInsights;
}): Promise<PersistedDecisionObject[]> {
  const signals = detectCompetitiveIntelligence(params.insights);

  await archiveDecisionScope({
    company_id: params.companyId,
    report_tier: 'growth',
    source_service: 'competitiveIntelligenceEngine',
    entity_type: 'global',
    entity_id: null,
    changed_by: 'system',
  });

  if (signals.length === 0) return [];

  const decisions = signals.map((signal) => {
    const issueType =
      signal.signal_type === 'market_expansion'
        ? 'missed_market_capture'
        : signal.signal_type === 'strategy_shift'
          ? 'competitor_gap'
          : 'competitor_dominance';

    return {
      company_id: params.companyId,
      report_tier: 'growth' as const,
      source_service: 'competitiveIntelligenceEngine',
      entity_type: 'global' as const,
      entity_id: null,
      issue_type: issueType,
      title: `Competitive signal: ${signal.signal_type}`,
      description: signal.summary,
      evidence: {
        signal_type: signal.signal_type,
        confidence: signal.confidence,
        supporting_signals: signal.supporting_signals,
      },
      impact_traffic: 36,
      impact_conversion: 42,
      impact_revenue: 44,
      priority_score: Math.max(45, Math.min(90, Math.round(signal.confidence * 100))),
      effort_score: 24,
      confidence_score: Math.max(0.4, Math.min(1, signal.confidence)),
      recommendation: 'Counter competitor movement with targeted positioning and differentiated channel execution.',
      action_type: 'adjust_strategy',
      action_payload: {
        optimization_focus: 'competitive_response',
        signal_type: signal.signal_type,
      },
      status: 'open' as const,
      last_changed_by: 'system' as const,
    };
  });

  return createDecisionObjects(decisions);
}
