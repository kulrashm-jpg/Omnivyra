/**
 * Company Signal Ranking Engine
 * Phase-4: Computes company-specific signal_score for filtered signals.
 * Combines momentum_score, topic_match, competitor_match, region_match, recency.
 */

import { supabase } from '../db/supabaseClient';
import type {
  FilteredSignalWithEvaluation,
  SignalMatchEvaluation,
} from './companySignalFilteringEngine';

const WEIGHT_MOMENTUM = 0.35;
const WEIGHT_TOPIC_MATCH = 0.2;
const WEIGHT_COMPETITOR_MATCH = 0.15;
const WEIGHT_REGION_MATCH = 0.1;
const WEIGHT_RECENCY = 0.2;

export type SignalIntelligenceRow = {
  id: string;
  cluster_id: string;
  momentum_score: number | null;
  signal_count?: number | null;
};

export type RankedSignalOutput = {
  signal_id: string;
  signal_score: number;
  momentum_score: number;
  matched_topics: string[];
  matched_competitors: string[];
  matched_regions: string[];
  topic_match: boolean;
  competitor_match: boolean;
  region_match: boolean;
};

export type SignalScoreInputs = {
  momentum_score: number;
  topic_match: boolean;
};

/** HIGH: momentum_score > 0.7 AND topic_match. MEDIUM: momentum_score > 0.5. LOW: else */
export function computeSignalPriority(inputs: SignalScoreInputs): 'HIGH' | 'MEDIUM' | 'LOW' {
  const { momentum_score, topic_match } = inputs;
  if (momentum_score > 0.7 && topic_match) return 'HIGH';
  if (momentum_score > 0.5) return 'MEDIUM';
  return 'LOW';
}

type FilteredSignalLike = {
  signal: { id: string; detected_at?: string | null; normalized_payload?: Record<string, unknown> | null };
  evaluation: SignalMatchEvaluation;
};

/**
 * Compute recency score from signal age (uses created_at or detected_at).
 * 0-24h → 1.0, 1-3d → 0.8, 3-7d → 0.6, 7-14d → 0.4, >14d → 0.2
 */
export function computeRecencyScore(createdAt: string | Date | null | undefined): number {
  if (!createdAt) return 0.2;
  const then = typeof createdAt === 'string' ? new Date(createdAt) : createdAt;
  const now = new Date();
  const ageHours = (now.getTime() - then.getTime()) / (1000 * 60 * 60);

  if (ageHours <= 24) return 1.0;
  if (ageHours <= 72) return 0.8;
  if (ageHours <= 168) return 0.6;
  if (ageHours <= 336) return 0.4;
  return 0.2;
}

/** Returns { score, momentumScore } */
function computeSignalScoreAndMomentum(
  filteredSignal: FilteredSignalLike,
  signalIntelligence: SignalIntelligenceRow | null
): { score: number; momentumScore: number } {
  const { evaluation } = filteredSignal;
  const np = filteredSignal.signal.normalized_payload ?? {};
  const detectedAt = filteredSignal.signal.detected_at;

  let momentumScore = 0;
  if (signalIntelligence?.momentum_score != null) {
    momentumScore = Math.min(1, Math.max(0, Number(signalIntelligence.momentum_score)));
  } else {
    const velocity = (np.velocity as number) ?? 0;
    const volume = (np.volume as number) ?? 0;
    momentumScore = Math.min(1, (velocity / 10) * 0.5 + (volume / 100) * 0.5);
  }

  const topicMatchScore = evaluation.topic_match ? 1 : 0;
  const competitorMatchScore = evaluation.competitor_match ? 1 : 0;
  const regionMatchScore = evaluation.region_match ? 1 : 0;
  const recencyScore = computeRecencyScore(detectedAt);

  const score =
    WEIGHT_MOMENTUM * momentumScore +
    WEIGHT_TOPIC_MATCH * topicMatchScore +
    WEIGHT_COMPETITOR_MATCH * competitorMatchScore +
    WEIGHT_REGION_MATCH * regionMatchScore +
    WEIGHT_RECENCY * recencyScore;

  return {
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    momentumScore,
  };
}

/**
 * Compute signal score. Uses signal_intelligence when available; falls back to intelligence_signals.
 */
export function computeSignalScore(
  filteredSignal: FilteredSignalLike,
  signalIntelligence: SignalIntelligenceRow | null
): number {
  return computeSignalScoreAndMomentum(filteredSignal, signalIntelligence).score;
}

/**
 * Fetch signal_intelligence by cluster_id for intelligence_signals.
 * Returns map: signal_id -> signal_intelligence row (or null).
 */
async function fetchSignalIntelligenceByClusterIds(
  clusterIds: string[]
): Promise<Map<string, SignalIntelligenceRow>> {
  if (clusterIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('signal_intelligence')
    .select('id, cluster_id, momentum_score, signal_count')
    .in('cluster_id', clusterIds);

  if (error) return new Map();
  const rows = (data ?? []) as SignalIntelligenceRow[];
  const byCluster = new Map<string, SignalIntelligenceRow>();
  for (const r of rows) {
    byCluster.set(r.cluster_id, r);
  }
  return byCluster;
}

type SignalMeta = {
  id: string;
  cluster_id: string | null;
  detected_at: string | null;
  created_at: string | null;
};

/**
 * Main service method. Ranks filtered signals by signal_score DESC.
 */
export async function rankSignalsForCompany(
  _companyId: string,
  filteredSignals: FilteredSignalWithEvaluation[]
): Promise<RankedSignalOutput[]> {
  if (filteredSignals.length === 0) return [];

  const signalIds = filteredSignals.map((f) => f.signal.id);

  const { data: signalRows } = await supabase
    .from('intelligence_signals')
    .select('id, cluster_id, detected_at, created_at')
    .in('id', signalIds);

  const metaById = new Map<string, SignalMeta>();
  const clusterIds: string[] = [];
  for (const r of signalRows ?? []) {
    const row = r as SignalMeta;
    metaById.set(row.id, row);
    if (row.cluster_id) clusterIds.push(row.cluster_id);
  }
  const uniqueClusterIds = [...new Set(clusterIds)];
  const intelByCluster = await fetchSignalIntelligenceByClusterIds(uniqueClusterIds);

  const results: RankedSignalOutput[] = [];
  for (const item of filteredSignals) {
    const meta = metaById.get(item.signal.id);
    const clusterId = meta?.cluster_id ?? null;
    const intel = clusterId ? intelByCluster.get(clusterId) ?? null : null;
    const createdAt = meta?.created_at ?? meta?.detected_at ?? null;

    const signalWithTime = {
      ...item.signal,
      detected_at: createdAt,
    };
    const { score, momentumScore } = computeSignalScoreAndMomentum(
      { signal: signalWithTime, evaluation: item.evaluation },
      intel
    );

    results.push({
      signal_id: item.signal.id,
      signal_score: score,
      momentum_score: momentumScore,
      matched_topics: item.evaluation.matched_topics,
      matched_competitors: item.evaluation.matched_competitors,
      matched_regions: item.evaluation.matched_regions,
      topic_match: item.evaluation.topic_match,
      competitor_match: item.evaluation.competitor_match,
      region_match: item.evaluation.region_match,
    });
  }

  results.sort((a, b) => b.signal_score - a.signal_score);
  return results;
}
