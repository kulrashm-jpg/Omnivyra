/**
 * Market Pulse aggregation from DB sources.
 * Aggregates from: signal_clusters, signal_intelligence, campaign_opportunities,
 * influencer_intelligence, lead_signals_v1 (BUYING_INTENT). Does NOT fetch raw APIs.
 * Feed limits: max 10 per category, max 40 total.
 * Deterministic hash ensures identical signals (same topic + category) collapse across sources.
 * Time-decay scoring: older signals lose priority via computeRecencyScore; sort by final_score DESC.
 */

import { createHash } from 'crypto';
import { supabase } from '../db/supabaseClient';
import {
  classifyMarketPulseSignal,
  type MarketPulseCategory,
  type RawSignalInput,
} from './marketPulseCategoryClassifier';

const MAX_SIGNALS_PER_CATEGORY = 10;
const MAX_TOTAL_SIGNALS = 40;

const BUYING_INTENT_INTENT_THRESHOLD = 0.6;

export type AggregatedPulseSignal = {
  id: string;
  topic: string;
  primary_category: MarketPulseCategory;
  secondary_tags: string[];
  momentum_score: number;
  confidence_score: number;
  recency: string;
  hash: string;
  /** Internal only; not persisted. Used for time-decay ranking. */
  final_score?: number;
  spike_reason?: string;
  shelf_life_days?: number;
  risk_level?: string;
  source: string;
  region?: string | null;
};

function generateSignalHash(topic: string, category: string): string {
  const normalized = topic
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized + '|' + category).digest('hex');
}

function computeRecencyScore(date: Date | string): number {
  const hoursOld = (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60);
  if (hoursOld <= 6) return 1;
  if (hoursOld <= 24) return 0.9;
  if (hoursOld <= 48) return 0.75;
  if (hoursOld <= 72) return 0.6;
  if (hoursOld <= 120) return 0.45;
  return 0.3;
}

function mergeOrKeepHigherMomentum(
  uniqueSignals: Map<string, AggregatedPulseSignal>,
  sig: AggregatedPulseSignal
): void {
  const h = sig.hash;
  if (!h) return;
  const existing = uniqueSignals.get(h);
  if (!existing || sig.momentum_score > existing.momentum_score) {
    uniqueSignals.set(h, sig);
  }
}

export async function aggregateMarketPulseFromDb(
  companyId: string,
  regions?: string[]
): Promise<AggregatedPulseSignal[]> {
  const uniqueSignals = new Map<string, AggregatedPulseSignal>();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    clusterRows,
    signalIntelligence,
    campaignOpportunities,
    influencerRows,
    leadSignals,
  ] = await Promise.all([
    supabase
      .from('signal_clusters')
      .select('cluster_id, cluster_topic, signal_count, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('signal_count', { ascending: false })
      .limit(100),
    supabase
      .from('signal_intelligence')
      .select('id, topic, momentum_score, signal_count, first_detected_at, last_detected_at')
      .gte('momentum_score', 0.3)
      .or(`first_detected_at.gte.${sevenDaysAgo},last_detected_at.gte.${sevenDaysAgo}`)
      .order('momentum_score', { ascending: false })
      .limit(50),
    supabase
      .from('campaign_opportunities')
      .select('id, opportunity_title, momentum_score, created_at')
      .gte('momentum_score', 0.3)
      .order('momentum_score', { ascending: false })
      .limit(30),
    supabase
      .from('influencer_intelligence')
      .select('id, author_name, platform, influence_score, last_active_at')
      .eq('organization_id', companyId)
      .order('influence_score', { ascending: false })
      .limit(20),
    supabase
      .from('lead_signals_v1')
      .select('id, snippet, intent_score, total_score, region, created_at')
      .eq('company_id', companyId)
      .eq('status', 'ACTIVE')
      .gte('intent_score', BUYING_INTENT_INTENT_THRESHOLD)
      .order('total_score', { ascending: false })
      .limit(20),
  ]);

  const clusterData = (clusterRows.data ?? []) as Array<{
    cluster_id: string;
    cluster_topic: string;
    signal_count: number;
    created_at: string;
  }>;

  for (const r of clusterData) {
    const momentum = Math.min(1, (r.signal_count ?? 0) / 15);
    const confidence = Math.min(1, (r.signal_count ?? 0) / 10);
    const primary_category = 'MARKET_TREND';
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: r.cluster_id,
      topic: r.cluster_topic,
      primary_category,
      secondary_tags: ['cluster_detected'],
      momentum_score: momentum || 0.3,
      confidence_score: confidence || 0.3,
      recency: r.created_at,
      source: 'signal_clusters',
      hash: generateSignalHash(r.cluster_topic, primary_category),
    });
  }

  const siRows = (signalIntelligence.data ?? []) as Array<{
    id: string;
    topic: string;
    momentum_score: number | null;
    signal_count: number;
    first_detected_at: string | null;
    last_detected_at: string | null;
  }>;

  for (const r of siRows) {
    const input: RawSignalInput = {
      topic: r.topic,
      source: 'signal_intelligence',
      normalizedPayload: { signal_count: r.signal_count },
    };
    const { primary_category, secondary_tags } = classifyMarketPulseSignal(input);
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: r.id,
      topic: r.topic,
      primary_category,
      secondary_tags,
      momentum_score: r.momentum_score ?? 0.5,
      confidence_score: Math.min(1, (r.signal_count ?? 0) / 10),
      recency: r.last_detected_at ?? r.first_detected_at ?? new Date().toISOString(),
      source: 'signal_intelligence',
      hash: generateSignalHash(r.topic, primary_category),
    });
  }

  const coRows = (campaignOpportunities.data ?? []) as Array<{
    id: string;
    opportunity_title: string;
    momentum_score: number | null;
    created_at: string;
  }>;

  for (const r of coRows) {
    const input: RawSignalInput = {
      topic: r.opportunity_title,
      source: 'campaign_opportunities',
      normalizedPayload: {},
    };
    const { primary_category, secondary_tags } = classifyMarketPulseSignal(input);
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: r.id,
      topic: r.opportunity_title,
      primary_category,
      secondary_tags,
      momentum_score: r.momentum_score ?? 0.5,
      confidence_score: 0.7,
      recency: r.created_at,
      source: 'campaign_opportunities',
      hash: generateSignalHash(r.opportunity_title, primary_category),
    });
  }

  const infRows = (influencerRows.data ?? []) as Array<{
    id: string;
    author_name: string | null;
    platform: string;
    influence_score: number;
    last_active_at: string | null;
  }>;

  for (const r of infRows) {
    const topic = `${r.author_name ?? 'Influencer'} (${r.platform})`;
    const primary_category = 'INFLUENCER_ACTIVITY';
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: r.id,
      topic,
      primary_category,
      secondary_tags: [],
      momentum_score: Math.min(1, (r.influence_score ?? 0) / 100),
      confidence_score: 0.6,
      recency: r.last_active_at ?? new Date().toISOString(),
      source: 'influencer_intelligence',
      hash: generateSignalHash(topic, primary_category),
    });
  }

  const leadRows = (leadSignals.data ?? []) as Array<{
    id: string;
    snippet: string;
    intent_score: number;
    total_score: number;
    region: string | null;
    created_at: string;
  }>;

  for (const r of leadRows) {
    const topic = r.snippet.slice(0, 120) + (r.snippet.length > 120 ? '…' : '');
    const primary_category = 'BUYING_INTENT';
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: r.id,
      topic,
      primary_category,
      secondary_tags: [],
      momentum_score: r.intent_score ?? 0.5,
      confidence_score: r.total_score ?? 0.5,
      recency: r.created_at,
      source: 'lead_signals',
      region: r.region,
      hash: generateSignalHash(topic, primary_category),
    });
  }

  const allSignals = Array.from(uniqueSignals.values());

  for (const sig of allSignals) {
    const recencyScore = computeRecencyScore(sig.recency);
    sig.final_score =
      sig.momentum_score * 0.6 + sig.confidence_score * 0.3 + recencyScore * 0.1;
  }

  allSignals.sort((a, b) => {
    const scoreA = a.final_score ?? 0;
    const scoreB = b.final_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.recency).getTime() - new Date(a.recency).getTime();
  });

  const byCategory = new Map<MarketPulseCategory, AggregatedPulseSignal[]>();
  for (const sig of allSignals) {
    const list = byCategory.get(sig.primary_category) ?? [];
    if (list.length < MAX_SIGNALS_PER_CATEGORY) {
      list.push(sig);
      byCategory.set(sig.primary_category, list);
    }
  }
  const all = Array.from(byCategory.values()).flat();
  all.sort((a, b) => {
    const scoreA = a.final_score ?? 0;
    const scoreB = b.final_score ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return new Date(b.recency).getTime() - new Date(a.recency).getTime();
  });

  return all.slice(0, MAX_TOTAL_SIGNALS);
}
