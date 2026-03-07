/**
 * Market Pulse Engine
 * Phase 4: Detects market acceleration, slowdown, trend volatility.
 */

import type { CompanyIntelligenceInsights } from './companyIntelligenceAggregator';
import type { CorrelationResult } from './signalCorrelationEngine';

export type PulseType = 'market_acceleration' | 'market_slowdown' | 'trend_volatility';

export type MarketPulse = {
  pulse_type: PulseType;
  pulse_score: number;
  affected_topics: string[];
};

const ACCELERATION_PATTERN = /growth|rise|surge|accel|increasing|momentum|emerging/i;
const SLOWDOWN_PATTERN = /decline|slow|drop|fall|decrease|recession|contraction/i;
const VOLATILITY_PATTERN = /volatile|fluctuat|uncertain|shift|change|transform/i;

/**
 * Detect market pulse from clusters, correlations, and signal momentum.
 */
export function detectMarketPulse(
  insights: CompanyIntelligenceInsights,
  correlations: CorrelationResult[]
): MarketPulse[] {
  const pulses: MarketPulse[] = [];

  for (const cluster of insights.trend_clusters) {
    const topic = (cluster.topic ?? '').trim();
    if (!topic) continue;
    if (cluster.signal_count >= 3 && cluster.avg_relevance >= 0.4) {
      if (ACCELERATION_PATTERN.test(topic)) {
        pulses.push({
          pulse_type: 'market_acceleration',
          pulse_score: Math.min(1, cluster.avg_relevance * 0.8 + cluster.signal_count * 0.05),
          affected_topics: [topic],
        });
      }
      if (SLOWDOWN_PATTERN.test(topic)) {
        pulses.push({
          pulse_type: 'market_slowdown',
          pulse_score: Math.min(1, cluster.avg_relevance * 0.7),
          affected_topics: [topic],
        });
      }
      if (VOLATILITY_PATTERN.test(topic)) {
        pulses.push({
          pulse_type: 'trend_volatility',
          pulse_score: Math.min(1, cluster.avg_relevance * 0.6 + 0.2),
          affected_topics: [topic],
        });
      }
    }
  }

  if (correlations.length >= 3) {
    const topics = new Set<string>();
    for (const c of correlations) {
      for (const p of c.correlated_signals) {
        if (p.topic_a) topics.add(p.topic_a);
        if (p.topic_b) topics.add(p.topic_b);
      }
    }
    const score = Math.min(1, correlations.length * 0.1 + 0.3);
    pulses.push({
      pulse_type: 'trend_volatility',
      pulse_score: score,
      affected_topics: Array.from(topics).slice(0, 5),
    });
  }

  return pulses
    .sort((a, b) => b.pulse_score - a.pulse_score)
    .slice(0, 10);
}
