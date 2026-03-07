/**
 * Signal Intelligence Engine
 * Converts signal clusters into actionable intelligence (momentum, direction, entities).
 * Does not modify signal ingestion, polling, or clustering.
 */

import { supabase } from '../db/supabaseClient';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;
const WINDOW_6H_MS = 6 * 60 * 60 * 1000;
const WINDOW_12H_MS = 12 * 60 * 60 * 1000;
const MOMENTUM_6H_WEIGHT = 0.6;
const MOMENTUM_24H_WEIGHT = 0.4;

type ClusterRow = {
  cluster_id: string;
  cluster_topic: string;
  signal_count: number;
  last_updated: string;
};

type SignalRow = {
  id: string;
  detected_at: string;
};

function log(
  event: 'intelligence_run_started' | 'intelligence_generated' | 'intelligence_run_completed',
  data: Record<string, unknown>
) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Load clusters updated in the last 24 hours.
 */
async function loadClustersUpdatedLast24h(): Promise<ClusterRow[]> {
  const since = new Date(Date.now() - WINDOW_24H_MS).toISOString();
  const { data, error } = await supabase
    .from('signal_clusters')
    .select('cluster_id, cluster_topic, signal_count, last_updated')
    .gte('last_updated', since)
    .order('last_updated', { ascending: false });

  if (error) throw new Error(`Failed to load clusters: ${error.message}`);
  return (data ?? []) as ClusterRow[];
}

/**
 * Load signals for a cluster with detected_at.
 */
async function loadSignalsForCluster(clusterId: string): Promise<SignalRow[]> {
  const { data, error } = await supabase
    .from('intelligence_signals')
    .select('id, detected_at')
    .eq('cluster_id', clusterId);

  if (error) throw new Error(`Failed to load signals for cluster ${clusterId}: ${error.message}`);
  return (data ?? []) as SignalRow[];
}

/**
 * Count signals in time windows (by detected_at).
 */
function countSignalsInWindows(signals: SignalRow[], now: number): {
  countLast6h: number;
  countLast24h: number;
  countPrev6h: number;
  firstDetectedAt: string | null;
  lastDetectedAt: string | null;
} {
  const cutoff6h = now - WINDOW_6H_MS;
  const cutoff24h = now - WINDOW_24H_MS;
  const cutoff12h = now - WINDOW_12H_MS;

  let countLast6h = 0;
  let countLast24h = 0;
  let countPrev6h = 0;
  let firstDetectedAt: string | null = null;
  let lastDetectedAt: string | null = null;

  for (const s of signals) {
    const t = new Date(s.detected_at).getTime();
    if (t >= cutoff6h) countLast6h++;
    if (t >= cutoff24h) countLast24h++;
    if (t >= cutoff12h && t < cutoff6h) countPrev6h++;

    if (!firstDetectedAt || s.detected_at < firstDetectedAt) firstDetectedAt = s.detected_at;
    if (!lastDetectedAt || s.detected_at > lastDetectedAt) lastDetectedAt = s.detected_at;
  }

  return {
    countLast6h,
    countLast24h,
    countPrev6h,
    firstDetectedAt,
    lastDetectedAt,
  };
}

/**
 * Momentum: (signal_count_last_6h * 0.6) + (signal_count_last_24h * 0.4).
 * Normalized to [0, 1] using max raw value across clusters.
 */
function computeMomentumScore(countLast6h: number, countLast24h: number): number {
  const raw =
    countLast6h * MOMENTUM_6H_WEIGHT + countLast24h * MOMENTUM_24H_WEIGHT;
  return Math.round(raw * 1000) / 1000;
}

/**
 * Normalize momentum scores to [0, 1] by dividing by max (or 1 if max is 0).
 */
function normalizeMomentumScores(scores: number[]): number[] {
  const max = Math.max(...scores, 1);
  return scores.map((s) => Math.round(Math.min(1, Math.max(0, s / max)) * 1000) / 1000);
}

/**
 * Trend direction: compare last 6h vs previous 6h.
 * UP = increasing, DOWN = decreasing, STABLE = roughly constant.
 */
function getTrendDirection(countLast6h: number, countPrev6h: number): 'UP' | 'STABLE' | 'DOWN' {
  if (countLast6h > countPrev6h) return 'UP';
  if (countLast6h < countPrev6h) return 'DOWN';
  return 'STABLE';
}

/**
 * Aggregate entities (companies, keywords, influencers) for signals in a cluster.
 */
async function extractEntitiesForCluster(signalIds: string[]): Promise<{
  companies: string[];
  keywords: string[];
  influencers: string[];
}> {
  if (signalIds.length === 0) {
    return { companies: [], keywords: [], influencers: [] };
  }

  const [companiesRes, keywordsRes, influencersRes] = await Promise.all([
    supabase.from('signal_companies').select('value').in('signal_id', signalIds),
    supabase.from('signal_keywords').select('value').in('signal_id', signalIds),
    supabase.from('signal_influencers').select('value').in('signal_id', signalIds),
  ]);

  const unique = (rows: { value: string }[] | null): string[] =>
    Array.from(new Set((rows ?? []).map((r) => r.value?.trim()).filter(Boolean)));

  return {
    companies: unique(companiesRes.data ?? []),
    keywords: unique(keywordsRes.data ?? []),
    influencers: unique(influencersRes.data ?? []),
  };
}

export type GenerateSignalIntelligenceResult = {
  clusters_processed: number;
  records_upserted: number;
};

/**
 * Generate signal intelligence from clusters updated in the last 24h.
 * 1. Load clusters updated in last 24h
 * 2. Aggregate cluster signals, compute momentum and direction
 * 3. Extract entities, upsert signal_intelligence
 */
export async function generateSignalIntelligence(): Promise<GenerateSignalIntelligenceResult> {
  const start = Date.now();
  log('intelligence_run_started', {});

  const clusters = await loadClustersUpdatedLast24h();

  if (clusters.length === 0) {
    log('intelligence_run_completed', {
      duration_ms: Date.now() - start,
      clusters_processed: 0,
      records_upserted: 0,
    });
    return { clusters_processed: 0, records_upserted: 0 };
  }

  const now = Date.now();
  const rawMomentums: number[] = [];
  const clusterData: Array<{
    cluster: ClusterRow;
    momentumRaw: number;
    trendDirection: 'UP' | 'STABLE' | 'DOWN';
    signalCount: number;
    firstDetectedAt: string | null;
    lastDetectedAt: string | null;
    companies: string[];
    keywords: string[];
    influencers: string[];
  }> = [];

  for (const cluster of clusters) {
    const signals = await loadSignalsForCluster(cluster.cluster_id);
    const { countLast6h, countLast24h, countPrev6h, firstDetectedAt, lastDetectedAt } =
      countSignalsInWindows(signals, now);

    const momentumRaw = computeMomentumScore(countLast6h, countLast24h);
    rawMomentums.push(momentumRaw);
    const trendDirection = getTrendDirection(countLast6h, countPrev6h);

    const entities = await extractEntitiesForCluster(signals.map((s) => s.id));

    clusterData.push({
      cluster,
      momentumRaw,
      trendDirection,
      signalCount: signals.length,
      firstDetectedAt,
      lastDetectedAt,
      companies: entities.companies,
      keywords: entities.keywords,
      influencers: entities.influencers,
    });
  }

  const normalized = normalizeMomentumScores(rawMomentums);

  let recordsUpserted = 0;
  for (let i = 0; i < clusterData.length; i++) {
    const { cluster, trendDirection, signalCount, firstDetectedAt, lastDetectedAt, companies, keywords, influencers } =
      clusterData[i];
    const momentumScore = normalized[i];

    const row = {
      cluster_id: cluster.cluster_id,
      topic: cluster.cluster_topic,
      momentum_score: momentumScore,
      trend_direction: trendDirection,
      signal_count: signalCount,
      first_detected_at: firstDetectedAt,
      last_detected_at: lastDetectedAt,
      companies: companies,
      keywords: keywords,
      influencers: influencers,
    };

    const { error } = await supabase.from('signal_intelligence').upsert(row, {
      onConflict: 'cluster_id',
      ignoreDuplicates: false,
    });

    if (error) throw new Error(`Failed to upsert signal_intelligence: ${error.message}`);
    recordsUpserted++;

    log('intelligence_generated', {
      cluster_id: cluster.cluster_id,
      topic: cluster.cluster_topic,
      momentum_score: momentumScore,
      trend_direction: trendDirection,
      signal_count: signalCount,
    });
  }

  const durationMs = Date.now() - start;
  log('intelligence_run_completed', {
    duration_ms: durationMs,
    clusters_processed: clusters.length,
    records_upserted: recordsUpserted,
  });

  return {
    clusters_processed: clusters.length,
    records_upserted: recordsUpserted,
  };
}

// =============================================================================
// Phase 6A — Scheduling Signal Intelligence
// Records and scores external signals for scheduling influence.
// Does NOT modify schedules; stores and scores signals only.
// Table: scheduling_intelligence_signals
// =============================================================================

export const SIGNAL_TYPES = [
  'industry_trend',
  'competitor_activity',
  'company_event',
  'seasonal_event',
  'market_news',
] as const;

export type SchedulingSignalType = (typeof SIGNAL_TYPES)[number];

export type SchedulingSignalInput = {
  company_id: string;
  signal_type: SchedulingSignalType;
  signal_source: string;
  signal_topic: string;
  signal_timestamp: string; // ISO 8601
  metadata?: Record<string, unknown>;
  /** Override: if provided, used instead of computed score */
  signal_score?: number;
  /** Optional: for score computation (0–1) */
  topic_relevance?: number;
  /** Optional: for score computation (0–1) */
  source_reliability?: number;
};

export type SchedulingSignalRow = {
  id: string;
  company_id: string;
  signal_type: string;
  signal_source: string;
  signal_topic: string;
  signal_score: number;
  signal_timestamp: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const RECENCY_WEIGHT = 0.4;
const TOPIC_RELEVANCE_WEIGHT = 0.4;
const SOURCE_RELIABILITY_WEIGHT = 0.2;

const SOURCE_RELIABILITY_MAP: Record<string, number> = {
  news: 0.9,
  api: 0.85,
  internal: 0.8,
  manual: 0.75,
  social: 0.7,
  research: 0.85,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Compute recency weight from signal timestamp.
 * Newer signals score higher (0–1).
 */
function computeRecencyWeight(signalTimestamp: string): number {
  const ts = new Date(signalTimestamp).getTime();
  const now = Date.now();
  const ageHours = (now - ts) / (60 * 60 * 1000);
  if (ageHours <= 24) return 1;
  if (ageHours <= 48) return 0.8;
  if (ageHours <= 72) return 0.6;
  if (ageHours <= 168) return 0.4; // 7 days
  return 0.2;
}

/**
 * Score a scheduling signal.
 * Formula: recencyWeight * 0.4 + topicRelevance * 0.4 + sourceReliability * 0.2
 * All factors normalized 0–1.
 */
export function scoreSignal(signal: SchedulingSignalInput): number {
  const recencyWeight = computeRecencyWeight(signal.signal_timestamp);
  const topicRelevance = clamp01(signal.topic_relevance ?? 0.7);
  const sourceReliability = clamp01(
    signal.source_reliability ?? SOURCE_RELIABILITY_MAP[signal.signal_source.toLowerCase()] ?? 0.6
  );
  const raw =
    recencyWeight * RECENCY_WEIGHT +
    topicRelevance * TOPIC_RELEVANCE_WEIGHT +
    sourceReliability * SOURCE_RELIABILITY_WEIGHT;
  return Math.round(raw * 1000) / 1000;
}

/**
 * Record a scheduling signal and persist to scheduling_intelligence_signals.
 * Computes score via scoreSignal() unless signal_score is provided.
 */
export async function recordSignal(signal: SchedulingSignalInput): Promise<SchedulingSignalRow> {
  const signalScore = signal.signal_score ?? scoreSignal(signal);
  const clampedScore = clamp01(signalScore);

  const row = {
    company_id: signal.company_id,
    signal_type: signal.signal_type,
    signal_source: signal.signal_source,
    signal_topic: signal.signal_topic,
    signal_score: clampedScore,
    signal_timestamp: signal.signal_timestamp,
    metadata: signal.metadata ?? {},
  };

  const { data, error } = await supabase
    .from('scheduling_intelligence_signals')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(`Failed to record scheduling signal: ${error.message}`);
  return data as SchedulingSignalRow;
}

/**
 * Get signals for a company within a week range, sorted by score descending.
 */
export async function getSignalsForWeek(
  companyId: string,
  weekStart: Date | string,
  weekEnd: Date | string
): Promise<SchedulingSignalRow[]> {
  const startStr = typeof weekStart === 'string' ? weekStart : weekStart.toISOString();
  const endStr = typeof weekEnd === 'string' ? weekEnd : weekEnd.toISOString();

  const { data, error } = await supabase
    .from('scheduling_intelligence_signals')
    .select('*')
    .eq('company_id', companyId)
    .gte('signal_timestamp', startStr)
    .lte('signal_timestamp', endStr)
    .order('signal_score', { ascending: false });

  if (error) throw new Error(`Failed to fetch scheduling signals: ${error.message}`);
  return (data ?? []) as SchedulingSignalRow[];
}
