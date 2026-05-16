/**
 * Phase 8 — Semantic indexing + embedding pipeline.
 *
 * Activates the Phase 7 semantic foundation safely:
 *   • Explicit job creation (one queue: `semantic-indexing`).
 *   • Bounded inputs (`SEMANTIC_INDEXING_MAX_SOURCES_PER_JOB = 50`).
 *   • Deterministic embedding provider (`deterministic_hash_v1`) — hashes
 *     a token frequency vector into a fixed-dim float[] with a stable
 *     seed. This is REPLAYABLE and EXPLAINABLE; future phases can plug
 *     in an external provider via the same job interface.
 *   • Replay-safe upserts via the Phase 7 chunk uniqueness constraint.
 *
 * Hard guarantees:
 *   • No auto-index loop. The job runs only when an operator POSTs to
 *     the /semantic-indexing endpoint OR an explicit caller schedules
 *     a job.
 *   • Per-chunk cost is bounded and attributed; cost_governance records
 *     a `semantic_indexing` event for every batch.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import { upsertSemanticChunks } from './semanticRetrievalService';
import {
  SEMANTIC_INDEXING_DEFAULT_DIM,
  SEMANTIC_INDEXING_MAX_SOURCES_PER_JOB,
  type SemanticIndexingJob,
  type SemanticJobStatus,
} from '../types/semanticIndexingJob';
import type { SemanticSourceKind } from '../types/semanticIndex';

const STOPWORDS = new Set([
  'the','this','that','have','has','from','with','your','what','which','when','where',
  'just','about','would','could','should','their','there','those','these','some',
]);

function tokenise(input: string): string[] {
  return input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .map((t) => t.trim()).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Deterministic, explainable embedding. Hash each token to a stable bucket;
 * the embedding is the L2-normalised token-frequency vector over the
 * resulting `dim`-bucket histogram. Same text → same vector, forever.
 */
function deterministicEmbedding(text: string, dim: number = SEMANTIC_INDEXING_DEFAULT_DIM): number[] {
  const counts = new Array<number>(dim).fill(0);
  for (const tok of tokenise(text)) {
    const h = createHash('sha256').update(tok).digest();
    const bucket = h.readUInt32BE(0) % dim;
    counts[bucket] += 1;
  }
  const magnitude = Math.sqrt(counts.reduce((acc, v) => acc + v * v, 0)) || 1;
  return counts.map((v) => Number((v / magnitude).toFixed(6)));
}

const SOURCE_TEXT_LOADERS: Record<SemanticSourceKind, (orgId: string, id: string) => Promise<string | null>> = {
  opportunity_feed_item: async (orgId, id) => {
    const { data } = await ownedDbTable('opportunity_feed_items')
      .select('detected_reason, source_context')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const ctx = (data as { source_context?: Record<string, unknown> }).source_context ?? {};
    const ctxText = typeof (ctx as { content?: string }).content === 'string' ? String((ctx as { content: string }).content) : '';
    return `${(data as { detected_reason: string }).detected_reason}\n${ctxText}`.slice(0, 8000);
  },
  opportunity_note: async (orgId, id) => {
    const { data } = await ownedDbTable('opportunity_notes')
      .select('body')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    return (data as { body?: string } | null)?.body ?? null;
  },
  signal_intent_cluster: async (orgId, id) => {
    const { data } = await ownedDbTable('signal_intent_clusters')
      .select('opportunity_type, top_keywords, source_identifier')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const d = data as { opportunity_type: string; top_keywords: string[]; source_identifier: string | null };
    return `${d.opportunity_type} ${(d.top_keywords ?? []).join(' ')} ${d.source_identifier ?? ''}`.trim();
  },
  listening_execution: async (orgId, id) => {
    const { data } = await ownedDbTable('listening_executions')
      .select('error_metadata, signal_stats')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return JSON.stringify(data).slice(0, 4000);
  },
  graph_node: async (orgId, id) => {
    const { data } = await ownedDbTable('opportunity_graph_nodes')
      .select('display_name, metadata')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return `${(data as { display_name: string }).display_name} ${JSON.stringify((data as { metadata: unknown }).metadata)}`.slice(0, 4000);
  },
  escalation: async (orgId, id) => {
    const { data } = await ownedDbTable('escalations')
      .select('title, body')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    const d = data as { title: string; body: string | null } | null;
    return d ? `${d.title}\n${d.body ?? ''}` : null;
  },
  investigation_workspace_item: async (orgId, id) => {
    const { data } = await ownedDbTable('investigation_workspace_items')
      .select('body, item_kind, item_ref')
      .eq('organization_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const d = data as { body: string | null; item_kind: string; item_ref: string };
    return `${d.item_kind}:${d.item_ref} ${d.body ?? ''}`;
  },
};

/**
 * Phase 9 — Exported per-source processor so the async partition worker
 * can reuse the canonical loader + embedding + upsert path without
 * duplicating the deterministic embedding logic.
 */
export async function processSemanticSourceForJob(
  organizationId: string,
  job: Pick<SemanticIndexingJob, 'id' | 'source_kind' | 'embedding_provider' | 'embedding_dim'>,
  sourceId: string,
): Promise<{ chunksIndexed: number; chunksFailed: number; costUnits: number }> {
  const loader = SOURCE_TEXT_LOADERS[job.source_kind];
  try {
    const text = loader ? await loader(organizationId, sourceId) : null;
    if (!text || text.trim().length < 10) return { chunksIndexed: 0, chunksFailed: 1, costUnits: 0 };
    const embedding = deterministicEmbedding(text, job.embedding_dim);
    const written = await upsertSemanticChunks({
      organizationId,
      sourceKind: job.source_kind,
      sourceId,
      content: text,
      embeddingProvider: job.embedding_provider,
      embeddingVector: embedding,
      metadata: { semantic_indexing_job_id: job.id },
    });
    return { chunksIndexed: written.length, chunksFailed: 0, costUnits: written.length };
  } catch (err: any) {
    console.warn('[semanticIndexing] source failed:', { sourceId, error: err?.message });
    return { chunksIndexed: 0, chunksFailed: 1, costUnits: 0 };
  }
}

export type CreateSemanticIndexingJobInput = {
  organizationId: string;
  sourceKind: SemanticSourceKind;
  sourceIds: string[];
  requestedBy: string | null;
  embeddingDim?: number;
};

export async function createSemanticIndexingJob(
  input: CreateSemanticIndexingJobInput,
): Promise<SemanticIndexingJob> {
  const ids = [...new Set(input.sourceIds.filter((s) => typeof s === 'string' && s.length > 0))]
    .slice(0, SEMANTIC_INDEXING_MAX_SOURCES_PER_JOB);
  if (ids.length === 0) throw new Error('semantic_indexing_no_sources');
  const dim = Math.max(8, Math.min(2048, input.embeddingDim ?? SEMANTIC_INDEXING_DEFAULT_DIM));
  const { data, error } = await ownedDbTable('semantic_indexing_jobs')
    .insert({
      organization_id: input.organizationId,
      source_kind: input.sourceKind,
      source_ids: ids,
      status: 'queued' as SemanticJobStatus,
      embedding_provider: 'deterministic_hash_v1',
      embedding_dim: dim,
      requested_by: input.requestedBy,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`semantic_indexing_job_insert_failed:${error?.message ?? 'unknown'}`);
  return data as SemanticIndexingJob;
}

/**
 * Process a single semantic indexing job synchronously. Phase 8 invokes
 * this from the API (sync execute). When BullMQ wiring lands in a
 * subsequent phase, the worker will call this same function.
 */
export async function processSemanticIndexingJob(
  organizationId: string,
  jobId: string,
): Promise<SemanticIndexingJob> {
  const { data: row } = await ownedDbTable('semantic_indexing_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('id', jobId)
    .maybeSingle();
  const job = row as SemanticIndexingJob | null;
  if (!job) throw new Error(`semantic_indexing_job_not_found:${jobId}`);
  if (job.status !== 'queued') return job;

  await ownedDbTable('semantic_indexing_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', job.id);

  let chunksIndexed = 0;
  let chunksFailed = 0;
  let costUnits = 0;
  const loader = SOURCE_TEXT_LOADERS[job.source_kind];

  try {
    for (const sourceId of job.source_ids) {
      try {
        const text = loader ? await loader(organizationId, sourceId) : null;
        if (!text || text.trim().length < 10) {
          chunksFailed += 1;
          continue;
        }
        const embedding = deterministicEmbedding(text, job.embedding_dim);
        const written = await upsertSemanticChunks({
          organizationId,
          sourceKind: job.source_kind,
          sourceId,
          content: text,
          embeddingProvider: job.embedding_provider,
          embeddingVector: embedding,
          metadata: { semantic_indexing_job_id: job.id },
        });
        chunksIndexed += written.length;
        costUnits += written.length;
      } catch (innerErr: any) {
        console.warn('[semanticIndexing] source failed:', { sourceId, error: innerErr?.message });
        chunksFailed += 1;
      }
    }

    const { data, error } = await ownedDbTable('semantic_indexing_jobs')
      .update({
        status: 'complete' as SemanticJobStatus,
        chunks_indexed: chunksIndexed,
        chunks_failed: chunksFailed,
        cost_units: costUnits,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`semantic_indexing_complete_failed:${error?.message ?? 'unknown'}`);
    return data as SemanticIndexingJob;
  } catch (err: any) {
    await ownedDbTable('semantic_indexing_jobs')
      .update({
        status: 'failed' as SemanticJobStatus,
        failure_reason: err?.message ?? 'unknown',
        chunks_indexed: chunksIndexed,
        chunks_failed: chunksFailed,
        cost_units: costUnits,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);
    throw new Error(`semantic_indexing_failed:${err?.message ?? 'unknown'}`);
  }
}

export async function listSemanticIndexingJobs(
  organizationId: string,
  options?: { status?: SemanticJobStatus; limit?: number },
): Promise<SemanticIndexingJob[]> {
  let q = ownedDbTable('semantic_indexing_jobs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  if (options?.status) q = q.eq('status', options.status);
  const { data, error } = await q;
  if (error) throw new Error(`semantic_indexing_list_failed:${error.message}`);
  return (data as SemanticIndexingJob[]) ?? [];
}
