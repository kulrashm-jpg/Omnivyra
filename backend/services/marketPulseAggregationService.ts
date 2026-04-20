/**
 * Market Pulse aggregation from DB sources.
 * Aggregates from: signal_clusters, signal_intelligence, campaign_opportunities,
 * influencer_intelligence, lead_signals (BUYING_INTENT). Does NOT fetch raw APIs.
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
  const existing = uniqueSignals.get(sig.hash);
  if (!existing || sig.momentum_score > existing.momentum_score) {
    uniqueSignals.set(sig.hash, sig);
  }
}

export async function aggregateMarketPulseFromDb(
  companyId: string,
  regions?: string[]
): Promise<AggregatedPulseSignal[]> {
  void regions;

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
      .from('lead_signals')
      .select('id, content_text, intent_score, total_score, detected_at, metadata')
      .eq('organization_id', companyId)
      .eq('source_type', 'listening')
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

  for (const row of clusterData) {
    const momentum = Math.min(1, (row.signal_count ?? 0) / 15);
    const confidence = Math.min(1, (row.signal_count ?? 0) / 10);
    const primary_category = 'MARKET_TREND';
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: row.cluster_id,
      topic: row.cluster_topic,
      primary_category,
      secondary_tags: ['cluster_detected'],
      momentum_score: momentum || 0.3,
      confidence_score: confidence || 0.3,
      recency: row.created_at,
      source: 'signal_clusters',
      hash: generateSignalHash(row.cluster_topic, primary_category),
    });
  }

  const intelligenceRows = (signalIntelligence.data ?? []) as Array<{
    id: string;
    topic: string;
    momentum_score: number | null;
    signal_count: number;
    first_detected_at: string | null;
    last_detected_at: string | null;
  }>;

  for (const row of intelligenceRows) {
    const input: RawSignalInput = {
      topic: row.topic,
      source: 'signal_intelligence',
      normalizedPayload: { signal_count: row.signal_count },
    };
    const { primary_category, secondary_tags } = classifyMarketPulseSignal(input);
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: row.id,
      topic: row.topic,
      primary_category,
      secondary_tags,
      momentum_score: row.momentum_score ?? 0.5,
      confidence_score: Math.min(1, (row.signal_count ?? 0) / 10),
      recency: row.last_detected_at ?? row.first_detected_at ?? new Date().toISOString(),
      source: 'signal_intelligence',
      hash: generateSignalHash(row.topic, primary_category),
    });
  }

  const campaignRows = (campaignOpportunities.data ?? []) as Array<{
    id: string;
    opportunity_title: string;
    momentum_score: number | null;
    created_at: string;
  }>;

  for (const row of campaignRows) {
    const input: RawSignalInput = {
      topic: row.opportunity_title,
      source: 'campaign_opportunities',
      normalizedPayload: {},
    };
    const { primary_category, secondary_tags } = classifyMarketPulseSignal(input);
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: row.id,
      topic: row.opportunity_title,
      primary_category,
      secondary_tags,
      momentum_score: row.momentum_score ?? 0.5,
      confidence_score: 0.7,
      recency: row.created_at,
      source: 'campaign_opportunities',
      hash: generateSignalHash(row.opportunity_title, primary_category),
    });
  }

  const influencerData = (influencerRows.data ?? []) as Array<{
    id: string;
    author_name: string | null;
    platform: string;
    influence_score: number;
    last_active_at: string | null;
  }>;

  for (const row of influencerData) {
    const topic = `${row.author_name ?? 'Influencer'} (${row.platform})`;
    const primary_category = 'INFLUENCER_ACTIVITY';
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: row.id,
      topic,
      primary_category,
      secondary_tags: [],
      momentum_score: Math.min(1, (row.influence_score ?? 0) / 100),
      confidence_score: 0.6,
      recency: row.last_active_at ?? new Date().toISOString(),
      source: 'influencer_intelligence',
      hash: generateSignalHash(topic, primary_category),
    });
  }

  const leadRows = (leadSignals.data ?? []) as Array<{
    id: string;
    content_text: string;
    intent_score: number;
    total_score: number;
    detected_at: string;
    metadata?: Record<string, unknown> | null;
  }>;

  for (const row of leadRows) {
    const contentText = row.content_text ?? '';
    const topic = contentText.slice(0, 120) + (contentText.length > 120 ? '...' : '');
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const primary_category = 'BUYING_INTENT';
    mergeOrKeepHigherMomentum(uniqueSignals, {
      id: row.id,
      topic,
      primary_category,
      secondary_tags: [],
      momentum_score: row.intent_score ?? 0.5,
      confidence_score: row.total_score ?? 0.5,
      recency: row.detected_at,
      source: 'lead_signals',
      region: typeof metadata.region === 'string' ? metadata.region : null,
      hash: generateSignalHash(topic, primary_category),
    });
  }

  const allSignals = Array.from(uniqueSignals.values());
  for (const signal of allSignals) {
    const recencyScore = computeRecencyScore(signal.recency);
    signal.final_score =
      signal.momentum_score * 0.6 + signal.confidence_score * 0.3 + recencyScore * 0.1;
  }

  allSignals.sort((left, right) => {
    const scoreDelta = (right.final_score ?? 0) - (left.final_score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return new Date(right.recency).getTime() - new Date(left.recency).getTime();
  });

  const byCategory = new Map<MarketPulseCategory, AggregatedPulseSignal[]>();
  for (const signal of allSignals) {
    const categoryList = byCategory.get(signal.primary_category) ?? [];
    if (categoryList.length < MAX_SIGNALS_PER_CATEGORY) {
      categoryList.push(signal);
      byCategory.set(signal.primary_category, categoryList);
    }
  }

  const collapsed = Array.from(byCategory.values()).flat();
  collapsed.sort((left, right) => {
    const scoreDelta = (right.final_score ?? 0) - (left.final_score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    return new Date(right.recency).getTime() - new Date(left.recency).getTime();
  });

  return collapsed.slice(0, MAX_TOTAL_SIGNALS);
}
