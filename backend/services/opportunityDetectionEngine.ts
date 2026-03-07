/**
 * Opportunity Detection Engine
 * Phase 3: Detects strategic opportunities from signal clusters, company signals, and correlation graph.
 * Types: emerging_trends, competitor_weaknesses, market_gaps, customer_pain_signals
 */

import { supabase } from '../db/supabaseClient';
import type { CompanyIntelligenceInsights } from './companyIntelligenceAggregator';

export type OpportunityType =
  | 'emerging_trend'
  | 'competitor_weakness'
  | 'market_gap'
  | 'customer_pain_signal';

export type Opportunity = {
  opportunity_type: OpportunityType;
  opportunity_score: number;
  supporting_signals: Array<{ signal_id: string; topic: string | null; relevance?: number }>;
  summary: string;
};

const EMERGING_PATTERN = /emerging|growth|rise|trend|new|increasing|surge|momentum/i;
const WEAKNESS_PATTERN = /weakness|problem|failure|struggle|decline|complaint|issue|losing/i;
const GAP_PATTERN = /gap|opportunity|underserved|unmet|lack|missing|need|demand/i;
const PAIN_PATTERN = /pain|complaint|frustrat|problem|issue|struggle|difficult|challenge/i;

/**
 * Detect opportunities from company intelligence insights and graph edges.
 */
export async function detectOpportunities(
  companyId: string,
  insights: CompanyIntelligenceInsights,
  windowHours: number = 24
): Promise<Opportunity[]> {
  const opportunities: Opportunity[] = [];

  for (const cluster of insights.trend_clusters) {
    if (cluster.signal_count >= 3 && cluster.avg_relevance >= 0.4) {
      const topic = cluster.topic ?? '';
      if (EMERGING_PATTERN.test(topic)) {
        opportunities.push({
          opportunity_type: 'emerging_trend',
          opportunity_score: Math.min(1, cluster.avg_relevance * 1.2 + cluster.signal_count * 0.05),
          supporting_signals: cluster.top_signals.map((s) => ({
            signal_id: s.signal_id,
            topic: s.topic,
            relevance: s.relevance_score,
          })),
          summary: `Emerging trend: ${topic}`,
        });
      }
    }
  }

  for (const comp of insights.competitor_activity) {
    for (const s of comp.signals) {
      const topic = (s.topic ?? '').toLowerCase();
      if (WEAKNESS_PATTERN.test(topic)) {
        opportunities.push({
          opportunity_type: 'competitor_weakness',
          opportunity_score: 0.5 + s.relevance_score * 0.3,
          supporting_signals: comp.signals.map((x) => ({
            signal_id: x.signal_id,
            topic: x.topic,
            relevance: x.relevance_score,
          })),
          summary: `Competitor weakness signal: ${s.topic?.slice(0, 80) ?? 'competitor'}`,
        });
        break;
      }
    }
  }

  for (const shift of insights.market_shifts) {
    const topic = (shift.topic ?? '').toLowerCase();
    if (GAP_PATTERN.test(topic) || (shift.avg_impact >= 0.5 && shift.signal_count >= 2)) {
      opportunities.push({
        opportunity_type: 'market_gap',
        opportunity_score: Math.min(1, shift.avg_impact * 0.8 + shift.signal_count * 0.1),
        supporting_signals: [],
        summary: `Market shift/gap: ${shift.topic}`,
      });
    }
  }

  for (const sent of insights.customer_sentiment) {
    const topic = (sent.topic ?? '').toLowerCase();
    if (PAIN_PATTERN.test(topic) || sent.sentiment_hint === 'negative') {
      opportunities.push({
        opportunity_type: 'customer_pain_signal',
        opportunity_score: 0.5 + sent.signal_count * 0.1,
        supporting_signals: [],
        summary: `Customer pain: ${sent.topic}`,
      });
    }
  }

  const edges = await fetchRecentEdgesForCompany(companyId, windowHours);
  if (edges.length >= 2) {
    for (const e of edges) {
      if (e.edge_type === 'market_shift_linkage' && e.edge_strength >= 0.5) {
        if (!opportunities.some((o) => o.opportunity_type === 'market_gap' && o.summary.includes('graph'))) {
          opportunities.push({
            opportunity_type: 'market_gap',
            opportunity_score: 0.5 + (e.edge_strength ?? 0) * 0.3,
            supporting_signals: [
              { signal_id: e.source_signal_id, topic: null },
              { signal_id: e.target_signal_id, topic: null },
            ],
            summary: `Market shift linkage detected (graph edges: ${edges.length})`,
          });
        }
        break;
      }
    }
  }

  return opportunities
    .sort((a, b) => b.opportunity_score - a.opportunity_score)
    .slice(0, 20);
}

async function fetchRecentEdgesForCompany(
  companyId: string,
  windowHours: number
): Promise<Array<{ source_signal_id: string; target_signal_id: string; edge_type: string; edge_strength: number | null }>> {
  const since = new Date();
  since.setHours(since.getHours() - windowHours);
  const sinceStr = since.toISOString();

  const { data: cis } = await supabase
    .from('company_intelligence_signals')
    .select('signal_id')
    .eq('company_id', companyId)
    .gte('created_at', sinceStr);

  const signalIdSet = new Set((cis ?? []).map((r: { signal_id: string }) => r.signal_id));
  if (signalIdSet.size === 0) return [];

  const { data: edges } = await supabase
    .from('intelligence_graph_edges')
    .select('source_signal_id, target_signal_id, edge_type, edge_strength')
    .gte('created_at', sinceStr);

  const filtered = (edges ?? []).filter(
    (e: { source_signal_id: string; target_signal_id: string }) =>
      signalIdSet.has(e.source_signal_id) || signalIdSet.has(e.target_signal_id)
  );

  return filtered as Array<{
    source_signal_id: string;
    target_signal_id: string;
    edge_type: string;
    edge_strength: number | null;
  }>;
}
