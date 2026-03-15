/**
 * Signal Clustering Engine
 * Groups related intelligence signals by hybrid similarity (semantic + token).
 * Uses embeddings when available; falls back to token Jaccard when not.
 * Operates on intelligence_signals; does not modify ingestion or polling.
 */

import { supabase } from '../db/supabaseClient';
import {
  generateTopicEmbedding,
  cosineSimilarity,
  embeddingToPgVector,
} from './signalEmbeddingService';

const WINDOW_HOURS = 6;
const SIMILARITY_THRESHOLD = 0.75;
const HYBRID_THRESHOLD = 0.8;
const EMBEDDING_WEIGHT = 0.7;
const TOKEN_WEIGHT = 0.3;

type SignalRow = {
  id: string;
  topic: string | null;
  normalized_payload: Record<string, unknown> | null;
  detected_at: string;
  source_api_id?: string | null;
  topic_embedding?: number[] | null;
};

type ClusterRow = {
  cluster_id: string;
  cluster_topic: string;
  signal_count: number;
  created_at: string;
  last_updated: string;
  topic_embedding?: number[] | null;
};

function log(
  event: 'cluster_run_started' | 'cluster_created' | 'cluster_updated' | 'cluster_run_completed',
  data: Record<string, unknown>
) {
  console.log(JSON.stringify({ event, ...data }));
}

/**
 * Tokenize topic into set of normalized words (lowercase, non-empty).
 */
export function tokenizeTopic(topic: string | null | undefined): Set<string> {
  if (!topic || typeof topic !== 'string') return new Set();
  const tokens = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return new Set(tokens);
}

/**
 * Jaccard similarity: |intersection| / |union|.
 * Returns value in [0, 1].
 */
export function tokenSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 && tokensB.size === 0) return 1;
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Topic similarity using tokenized Jaccard. ≥ threshold => same cluster.
 */
export function topicSimilarity(
  topicA: string | null | undefined,
  topicB: string | null | undefined,
  threshold: number = SIMILARITY_THRESHOLD
): boolean {
  const a = tokenizeTopic(topicA);
  const b = tokenizeTopic(topicB);
  return tokenSimilarity(a, b) >= threshold;
}

/**
 * Similarity score for ordering (higher = more similar).
 */
export function topicSimilarityScore(
  topicA: string | null | undefined,
  topicB: string | null | undefined
): number {
  const a = tokenizeTopic(topicA);
  const b = tokenizeTopic(topicB);
  return tokenSimilarity(a, b);
}

/**
 * Hybrid similarity: 0.7 * embeddingSimilarity + 0.3 * tokenSimilarity.
 * When embeddings missing, fall back to tokenSimilarity >= SIMILARITY_THRESHOLD.
 */
function hybridSimilarity(
  topicA: string | null | undefined,
  topicB: string | null | undefined,
  embeddingA: number[] | null | undefined,
  embeddingB: number[] | null | undefined
): { score: number; sameCluster: boolean } {
  const tokenSim = tokenSimilarity(tokenizeTopic(topicA), tokenizeTopic(topicB));

  const hasEmbeddings = Array.isArray(embeddingA) && embeddingA.length > 0
    && Array.isArray(embeddingB) && embeddingB.length > 0;

  if (!hasEmbeddings) {
    return { score: tokenSim, sameCluster: tokenSim >= SIMILARITY_THRESHOLD };
  }

  const embSim = cosineSimilarity(embeddingA!, embeddingB!);
  const clampedEmb = Math.max(0, Math.min(1, (embSim + 1) / 2));
  const score = EMBEDDING_WEIGHT * clampedEmb + TOKEN_WEIGHT * tokenSim;
  return { score, sameCluster: score >= HYBRID_THRESHOLD };
}

/** Parse embedding from DB (may be string or array). */
function parseEmbedding(val: unknown): number[] | null {
  if (Array.isArray(val) && val.length > 0) return val as number[];
  if (typeof val === 'string' && val.startsWith('[')) {
    try {
      const arr = JSON.parse(val) as number[];
      return Array.isArray(arr) ? arr : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Most frequent topic among a list (mode). Falls back to first if tie or empty.
 */
function mostFrequentTopic(topics: (string | null)[]): string {
  const nonNull = topics.filter((t): t is string => !!t && t.trim().length > 0);
  if (nonNull.length === 0) return '';
  const counts = new Map<string, number>();
  let maxCount = 0;
  let mode = nonNull[0];
  for (const t of nonNull) {
    const normalized = t.trim().toLowerCase();
    const c = (counts.get(normalized) ?? 0) + 1;
    counts.set(normalized, c);
    if (c > maxCount) {
      maxCount = c;
      mode = t.trim();
    }
  }
  return mode;
}

/**
 * Ensure signal has topic_embedding; generate and persist if missing.
 */
async function ensureSignalEmbedding(signal: SignalRow): Promise<SignalRow> {
  const topic = signal.topic?.trim();
  if (!topic) return signal;

  let emb = parseEmbedding((signal as any).topic_embedding);
  if (emb && emb.length > 0) return { ...signal, topic_embedding: emb };

  try {
    emb = await generateTopicEmbedding(topic);
    const vecStr = embeddingToPgVector(emb);
    await supabase
      .from('intelligence_signals')
      .update({ topic_embedding: vecStr } as any)
      .eq('id', signal.id);
    return { ...signal, topic_embedding: emb };
  } catch (e) {
    return signal;
  }
}

/**
 * Fetch unclustered signals from the last 6 hours.
 */
async function fetchUnclusteredSignals(): Promise<SignalRow[]> {
  const { data, error } = await supabase
    .from('intelligence_signals')
    .select('id, topic, normalized_payload, detected_at, source_api_id, topic_embedding')
    .gt('detected_at', new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString())
    .is('cluster_id', null)
    .order('detected_at', { ascending: true });

  if (error) throw new Error(`Failed to fetch unclustered signals: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    ...r,
    topic_embedding: parseEmbedding(r.topic_embedding),
  })) as SignalRow[];
}

/**
 * Fetch existing clusters updated or created in the last 6 hours.
 * Schema-resilient: if topic_embedding column is missing, fetches without it.
 */
async function fetchRecentClusters(): Promise<ClusterRow[]> {
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const selectCols = 'cluster_id, cluster_topic, signal_count, created_at, last_updated, topic_embedding';
  let result = await supabase
    .from('signal_clusters')
    .select(selectCols)
    .gte('last_updated', since)
    .order('last_updated', { ascending: false });

  if (result.error && isSchemaError(result.error)) {
    result = (await supabase
      .from('signal_clusters')
      .select('cluster_id, cluster_topic, signal_count, created_at, last_updated')
      .gte('last_updated', since)
      .order('last_updated', { ascending: false })) as typeof result;
  }

  const { data, error } = result;
  if (error) throw new Error(`Failed to fetch recent clusters: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    ...r,
    topic_embedding: parseEmbedding(r.topic_embedding),
  })) as ClusterRow[];
}

/**
 * Assign signals to an existing cluster; update signal_count and last_updated.
 */
async function assignSignalsToCluster(
  signalIds: string[],
  clusterId: string,
  newCount: number
): Promise<void> {
  if (signalIds.length === 0) return;
  const now = new Date().toISOString();
  const { error: updateSignals } = await supabase
    .from('intelligence_signals')
    .update({ cluster_id: clusterId })
    .in('id', signalIds);
  if (updateSignals) throw new Error(`Failed to update signals: ${updateSignals.message}`);

  const { error: updateCluster } = await supabase
    .from('signal_clusters')
    .update({ signal_count: newCount, last_updated: now })
    .eq('cluster_id', clusterId);
  if (updateCluster) throw new Error(`Failed to update cluster: ${updateCluster.message}`);
}

function isSchemaError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = (err.message ?? '').toLowerCase();
  const code = (err as { code?: string }).code;
  return (
    code === 'PGRST205' ||
    msg.includes('could not find') ||
    msg.includes('does not exist') ||
    (msg.includes('column') && msg.includes('schema cache'))
  );
}

/**
 * Create a new cluster and assign signals.
 * sourceApiId is stored on the cluster for theme filtering (cluster → source API lookup).
 * topic_embedding is generated from cluster_topic for vector search.
 * Schema-resilient: if source_api_id or topic_embedding columns are missing, retries with minimal row.
 */
async function createClusterAndAssign(
  clusterTopic: string,
  signalIds: string[],
  sourceApiId?: string | null,
  topicEmbedding?: number[] | null
): Promise<string> {
  if (signalIds.length === 0) throw new Error('createClusterAndAssign requires at least one signal');
  const now = new Date().toISOString();
  const baseRow: Record<string, unknown> = {
    cluster_topic: clusterTopic,
    signal_count: signalIds.length,
    created_at: now,
    last_updated: now,
  };
  const rowWithOptional: Record<string, unknown> = { ...baseRow };
  if (sourceApiId) rowWithOptional.source_api_id = sourceApiId;
  if (topicEmbedding?.length) {
    rowWithOptional.topic_embedding = embeddingToPgVector(topicEmbedding);
  }

  let result = await supabase.from('signal_clusters').insert(rowWithOptional).select('cluster_id').single();

  if (result.error && isSchemaError(result.error)) {
    if (!(globalThis as any).__signal_clusters_schema_hint_shown) {
      (globalThis as any).__signal_clusters_schema_hint_shown = true;
      console.warn(
        'signal_clusters: source_api_id or topic_embedding column missing. Run database/signal_clusters_source_api_id.sql and database/add_signal_embeddings.sql. Clustering will continue with minimal schema.'
      );
    }
    result = await supabase.from('signal_clusters').insert(baseRow).select('cluster_id').single();
  }

  const { data: inserted, error: insertError } = result;
  if (insertError || !inserted) throw new Error(`Failed to create cluster: ${insertError?.message}`);

  const clusterId = inserted.cluster_id as string;
  const { error: updateSignals } = await supabase
    .from('intelligence_signals')
    .update({ cluster_id: clusterId })
    .in('id', signalIds);
  if (updateSignals) throw new Error(`Failed to assign signals to new cluster: ${updateSignals.message}`);

  return clusterId;
}

/**
 * Greedy clustering: group signals by hybrid or token similarity.
 * Returns array of groups (each group = array of SignalRow).
 */
function groupSignalsBySimilarity(signals: SignalRow[]): SignalRow[][] {
  if (signals.length === 0) return [];
  const groups: SignalRow[][] = [];

  for (const signal of signals) {
    let placed = false;
    const topicA = signal.topic ?? '';

    for (const group of groups) {
      const representative = group[0]!;
      const { sameCluster } = hybridSimilarity(
        topicA,
        representative.topic,
        signal.topic_embedding,
        representative.topic_embedding
      );
      if (sameCluster) {
        group.push(signal);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([signal]);
  }

  return groups;
}

export type ClusterRecentSignalsResult = {
  signals_processed: number;
  clusters_created: number;
  clusters_updated: number;
  signals_assigned_to_existing: number;
  signals_in_new_clusters: number;
};

/**
 * Process signals from the last 6 hours: assign to existing similar clusters or create new ones.
 * Incremental: if a similar cluster exists (last 6h), assign to it; otherwise form new clusters.
 */
export async function clusterRecentSignals(): Promise<ClusterRecentSignalsResult> {
  const start = Date.now();
  log('cluster_run_started', { window_hours: WINDOW_HOURS });

  const signals = await fetchUnclusteredSignals();
  const recentClusters = await fetchRecentClusters();

  let clustersCreated = 0;
  const updatedClusterIds = new Set<string>();
  let signalsAssignedToExisting = 0;
  let signalsInNewClusters = 0;

  if (signals.length === 0) {
    log('cluster_run_completed', {
      duration_ms: Date.now() - start,
      signals_processed: 0,
      clusters_created: 0,
      clusters_updated: 0,
    });
    return {
      signals_processed: 0,
      clusters_created: 0,
      clusters_updated: 0,
      signals_assigned_to_existing: 0,
      signals_in_new_clusters: 0,
    };
  }

  const remaining: SignalRow[] = [];
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  for (const signal of signals) {
    const signalWithEmb = await ensureSignalEmbedding(signal);
    const topic = signalWithEmb.topic ?? '';
    let assigned = false;

    let clustersToCheck: ClusterRow[] = recentClusters;
    if (signalWithEmb.topic_embedding?.length) {
      try {
        const { data: nearest } = await supabase.rpc('match_clusters_by_embedding', {
          query_embedding: embeddingToPgVector(signalWithEmb.topic_embedding),
          match_limit: 5,
          since_ts: since,
        });
        if (Array.isArray(nearest) && nearest.length > 0) {
          clustersToCheck = nearest.map((r: any) => ({
            cluster_id: r.cluster_id,
            cluster_topic: r.cluster_topic,
            signal_count: r.signal_count,
            created_at: '',
            last_updated: r.last_updated,
            topic_embedding: parseEmbedding(r.topic_embedding),
          }));
        }
      } catch { /* fallback to full scan */ }
    }

    for (const cluster of clustersToCheck) {
      const { sameCluster } = hybridSimilarity(
        topic,
        cluster.cluster_topic,
        signalWithEmb.topic_embedding,
        cluster.topic_embedding
      );
      if (sameCluster) {
        await assignSignalsToCluster(
          [signalWithEmb.id],
          cluster.cluster_id,
          cluster.signal_count + 1
        );
        cluster.signal_count += 1;
        cluster.last_updated = new Date().toISOString();
        signalsAssignedToExisting++;
        updatedClusterIds.add(cluster.cluster_id);
        log('cluster_updated', {
          cluster_id: cluster.cluster_id,
          cluster_topic: cluster.cluster_topic,
          signal_count: cluster.signal_count,
        });
        assigned = true;
        break;
      }
    }

    if (!assigned) remaining.push(signalWithEmb);
  }

  const groups = groupSignalsBySimilarity(remaining);

  for (const group of groups) {
    if (group.length === 0) continue;
    const clusterTopic = mostFrequentTopic(group.map((s) => s.topic));
    const topicToUse = clusterTopic || (group[0]!.topic ?? 'unknown');
    const sourceApiId = group[0]!.source_api_id ?? null;
    let clusterEmb: number[] | null = null;
    try {
      clusterEmb = await generateTopicEmbedding(topicToUse);
    } catch { /* use token-only cluster */ }
    const clusterId = await createClusterAndAssign(
      topicToUse,
      group.map((s) => s.id),
      sourceApiId,
      clusterEmb
    );
    clustersCreated++;
    signalsInNewClusters += group.length;
    log('cluster_created', {
      cluster_id: clusterId,
      cluster_topic: topicToUse,
      signal_count: group.length,
    });
  }

  const durationMs = Date.now() - start;
  const clustersUpdated = updatedClusterIds.size;
  log('cluster_run_completed', {
    duration_ms: durationMs,
    signals_processed: signals.length,
    clusters_created: clustersCreated,
    clusters_updated: clustersUpdated,
  });

  return {
    signals_processed: signals.length,
    clusters_created: clustersCreated,
    clusters_updated: clustersUpdated,
    signals_assigned_to_existing: signalsAssignedToExisting,
    signals_in_new_clusters: signalsInNewClusters,
  };
}
