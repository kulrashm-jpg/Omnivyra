/**
 * Phase 7 — Signal-Driven Scheduling Influence
 *
 * Uses signals from signalIntelligenceEngine to generate scheduling insights.
 * Signals do NOT automatically change the schedule — they only produce opportunity insights.
 * Users decide whether to apply them.
 */

import { getSignalsForWeek } from './signalIntelligenceEngine';
import type { SchedulingSignalRow } from './signalIntelligenceEngine';

const MIN_SCORE = 0.6;
const MAX_SIGNALS = 5;

export interface SignalSchedulingInsight {
  type: 'signal_opportunity';
  signal_type: string;
  signal_topic: string;
  signal_score: number;
  message: string;
  recommendation: string;
}

type WeekPlan = Record<string, unknown>;

/**
 * Build message and recommendation from a signal per Phase 7 rules.
 */
function buildInsightFromSignal(signal: SchedulingSignalRow): SignalSchedulingInsight {
  const { signal_type, signal_topic, signal_score } = signal;

  switch (signal_type) {
    case 'industry_trend':
      return {
        type: 'signal_opportunity',
        signal_type,
        signal_topic,
        signal_score,
        message: `Trending topic detected: ${signal_topic}.`,
        recommendation: `Consider scheduling content related to ${signal_topic} earlier this week.`,
      };
    case 'seasonal_event':
      return {
        type: 'signal_opportunity',
        signal_type,
        signal_topic,
        signal_score,
        message: 'Upcoming seasonal event may influence audience engagement.',
        recommendation: `Consider aligning content with seasonal context: ${signal_topic}.`,
      };
    case 'competitor_activity':
      return {
        type: 'signal_opportunity',
        signal_type,
        signal_topic,
        signal_score,
        message: `Competitor activity detected around ${signal_topic}.`,
        recommendation: `Consider responding or differentiating with content on ${signal_topic}.`,
      };
    case 'company_event':
      return {
        type: 'signal_opportunity',
        signal_type,
        signal_topic,
        signal_score,
        message: `Company event: ${signal_topic}.`,
        recommendation: `Consider scheduling supporting content around this event.`,
      };
    case 'market_news':
      return {
        type: 'signal_opportunity',
        signal_type,
        signal_topic,
        signal_score,
        message: `Market news: ${signal_topic}.`,
        recommendation: `Consider addressing this topic in your content this week.`,
      };
    default:
      return {
        type: 'signal_opportunity',
        signal_type,
        signal_topic,
        signal_score,
        message: `Signal: ${signal_topic}.`,
        recommendation: `Consider reviewing relevance to your content plan.`,
      };
  }
}

/**
 * Analyze signal influence for a week plan.
 * Retrieves signals from getSignalsForWeek, filters by score ≥ 0.6,
 * limits to top 5, and converts to SignalSchedulingInsight[].
 */
export async function analyzeSignalInfluence(
  _weekPlan: WeekPlan | null | undefined,
  companyId: string,
  weekStart: Date | string,
  weekEnd: Date | string
): Promise<SignalSchedulingInsight[]> {
  const signals = await getSignalsForWeek(companyId, weekStart, weekEnd);

  const filtered = signals
    .filter((s) => s.signal_score >= MIN_SCORE)
    .slice(0, MAX_SIGNALS);

  return filtered.map(buildInsightFromSignal);
}
