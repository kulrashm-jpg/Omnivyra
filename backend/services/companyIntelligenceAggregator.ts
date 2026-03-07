/**
 * Company Intelligence Aggregator
 * Phase 2: Aggregates company signals into insights (trend clusters, competitor activity, market shifts, customer sentiment).
 */

import { supabase } from '../db/supabaseClient';

export type TrendClusterItem = {
  topic: string;
  signal_count: number;
  avg_relevance: number;
  top_signals: Array<{ signal_id: string; topic: string; relevance_score: number }>;
};

export type CompetitorActivityItem = {
  competitor_hint: string;
  signal_count: number;
  signals: Array<{ signal_id: string; topic: string; relevance_score: number }>;
};

export type MarketShiftItem = {
  topic: string;
  signal_count: number;
  avg_impact: number;
};

export type CustomerSentimentItem = {
  topic: string;
  signal_count: number;
  sentiment_hint: string;
};

export type CompanyIntelligenceInsights = {
  company_id: string;
  window_hours: number;
  trend_clusters: TrendClusterItem[];
  competitor_activity: CompetitorActivityItem[];
  market_shifts: MarketShiftItem[];
  customer_sentiment: CustomerSentimentItem[];
};

const WINDOW_24H = 24;
const WINDOW_7D = 24 * 7;

/**
 * Fetch company intelligence signals with joined global signal data.
 */
async function fetchCompanySignalsWithTopics(
  companyId: string,
  windowHours: number
): Promise<
  Array<{
    id: string;
    signal_id: string;
    relevance_score: number | null;
    impact_score: number | null;
    signal_type: string | null;
    created_at: string;
    topic: string | null;
  }>
> {
  const since = new Date();
  since.setHours(since.getHours() - windowHours);
  const sinceStr = since.toISOString();

  const { data, error } = await supabase
    .from('company_intelligence_signals')
    .select(
      'id, signal_id, relevance_score, impact_score, signal_type, created_at, intelligence_signals!inner(topic)'
    )
    .eq('company_id', companyId)
    .gte('created_at', sinceStr);

  if (error) throw new Error(`Failed to fetch company signals: ${error.message}`);

  const rows = (data ?? []) as Array<{
    id: string;
    signal_id: string;
    relevance_score: number | null;
    impact_score: number | null;
    signal_type: string | null;
    created_at: string;
    intelligence_signals: { topic: string | null } | { topic: string | null }[] | null;
  }>;

  const getTopic = (rel: { topic?: string | null } | { topic?: string | null }[] | null): string | null => {
    if (!rel) return null;
    const r = Array.isArray(rel) ? rel[0] : rel;
    return (r as { topic?: string | null })?.topic ?? null;
  };

  return rows.map((r) => ({
    id: r.id,
    signal_id: r.signal_id,
    relevance_score: r.relevance_score ?? 0,
    impact_score: r.impact_score ?? 0,
    signal_type: r.signal_type,
    created_at: r.created_at,
    topic: getTopic(r.intelligence_signals),
  }));
}

function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 5)
    .join(' ');
}

function clusterTopics(
  signals: Array<{ signal_id: string; topic: string | null; relevance_score: number }>
): Map<string, { count: number; totalRel: number; items: Array<{ signal_id: string; topic: string; relevance_score: number }> }> {
  const clusters = new Map<
    string,
    { count: number; totalRel: number; items: Array<{ signal_id: string; topic: string; relevance_score: number }> }
  >();
  for (const s of signals) {
    const topic = (s.topic ?? '').trim();
    if (!topic) continue;
    const key = normalizeTopic(topic);
    if (!key) continue;
    const existing = clusters.get(key) ?? { count: 0, totalRel: 0, items: [] };
    existing.count += 1;
    existing.totalRel += s.relevance_score;
    existing.items.push({
      signal_id: s.signal_id,
      topic,
      relevance_score: s.relevance_score,
    });
    clusters.set(key, existing);
  }
  return clusters;
}

export async function aggregateCompanyIntelligence(
  companyId: string,
  windowHours: number = WINDOW_24H
): Promise<CompanyIntelligenceInsights> {
  const signals = await fetchCompanySignalsWithTopics(companyId, windowHours);
  const rel = (r: number | null) => r ?? 0;

  const trendClusters: TrendClusterItem[] = [];
  const clusterMap = clusterTopics(
    signals.map((s) => ({
      signal_id: s.signal_id,
      topic: s.topic,
      relevance_score: rel(s.relevance_score),
    }))
  );
  for (const [key, data] of clusterMap.entries()) {
    const topTopic = data.items[0]?.topic ?? key;
    trendClusters.push({
      topic: topTopic,
      signal_count: data.count,
      avg_relevance: data.count > 0 ? data.totalRel / data.count : 0,
      top_signals: data.items
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .slice(0, 5)
        .map((i) => ({ signal_id: i.signal_id, topic: i.topic, relevance_score: i.relevance_score })),
    });
  }
  trendClusters.sort((a, b) => b.signal_count - a.signal_count);

  const competitorSignals = signals.filter((s) => s.signal_type === 'competitor_activity');
  const competitorActivity: CompetitorActivityItem[] = [];
  const compByTopic = new Map<string, Array<{ signal_id: string; topic: string; relevance_score: number }>>();
  for (const s of competitorSignals) {
    const topic = (s.topic ?? '').trim();
    if (!topic) continue;
    const key = normalizeTopic(topic);
    if (!key) continue;
    const arr = compByTopic.get(key) ?? [];
    arr.push({ signal_id: s.signal_id, topic, relevance_score: rel(s.relevance_score) });
    compByTopic.set(key, arr);
  }
  for (const [, items] of compByTopic.entries()) {
    const hint = items[0]?.topic ?? 'competitor';
    competitorActivity.push({
      competitor_hint: hint.slice(0, 80),
      signal_count: items.length,
      signals: items.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 5),
    });
  }
  competitorActivity.sort((a, b) => b.signal_count - a.signal_count);

  const marketSignals = signals.filter(
    (s) => s.signal_type === 'market_shift' || s.signal_type === 'trend'
  );
  const marketShiftMap = clusterTopics(
    marketSignals.map((s) => ({
      signal_id: s.signal_id,
      topic: s.topic,
      relevance_score: rel(s.relevance_score),
    }))
  );
  const marketShifts: MarketShiftItem[] = [];
  for (const [key, data] of marketShiftMap.entries()) {
    const topTopic = data.items[0]?.topic ?? key;
    const clusterSignals = marketSignals.filter((s) => normalizeTopic(s.topic ?? '') === key);
    const avgImpact =
      clusterSignals.length > 0
        ? clusterSignals.reduce((sum, s) => sum + rel(s.impact_score), 0) / clusterSignals.length
        : 0;
    marketShifts.push({
      topic: topTopic,
      signal_count: data.count,
      avg_impact: avgImpact,
    });
  }
  marketShifts.sort((a, b) => b.signal_count - a.signal_count);

  const sentimentSignals = signals.filter((s) => s.signal_type === 'customer_sentiment');
  const sentimentMap = clusterTopics(
    sentimentSignals.map((s) => ({
      signal_id: s.signal_id,
      topic: s.topic,
      relevance_score: rel(s.relevance_score),
    }))
  );
  const customerSentiment: CustomerSentimentItem[] = [];
  for (const [key, data] of sentimentMap.entries()) {
    const topTopic = data.items[0]?.topic ?? key;
    const hint = /complaint|issue|problem|negative/i.test(topTopic) ? 'negative' : 'feedback';
    customerSentiment.push({
      topic: topTopic,
      signal_count: data.count,
      sentiment_hint: hint,
    });
  }
  customerSentiment.sort((a, b) => b.signal_count - a.signal_count);

  return {
    company_id: companyId,
    window_hours: windowHours,
    trend_clusters: trendClusters.slice(0, 20),
    competitor_activity: competitorActivity.slice(0, 10),
    market_shifts: marketShifts.slice(0, 10),
    customer_sentiment: customerSentiment.slice(0, 10),
  };
}

export async function getCompanyIntelligenceFor24hAnd7d(
  companyId: string
): Promise<{ insights_24h: CompanyIntelligenceInsights; insights_7d: CompanyIntelligenceInsights }> {
  const [insights_24h, insights_7d] = await Promise.all([
    aggregateCompanyIntelligence(companyId, WINDOW_24H),
    aggregateCompanyIntelligence(companyId, WINDOW_7D),
  ]);
  return { insights_24h, insights_7d };
}
