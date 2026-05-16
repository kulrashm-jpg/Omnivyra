/**
 * Phase 7 — Semantic retrieval foundation.
 *
 * Phase 7 ships only the SCHEMA + WRITE PATH for semantic index entries.
 * No embedding writer is auto-invoked; no autonomous reasoning agent exists.
 * The intent: future phases call `upsertSemanticChunk` with an
 * externally-computed embedding (e.g. from an explicit user-triggered
 * re-index operation). Until then, the entries can be populated with
 * `embedding_vector = null` so the chunked text is still queryable.
 *
 * Retrieval here is text-only (lexical via the search service) until an
 * embedding writer lands. The methods are exposed so the UI surface is
 * complete; callers see clearly that semantic search returns the lexical
 * fallback when no embeddings exist.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import {
  SEMANTIC_CHUNK_MAX_CHARS,
  SEMANTIC_MAX_CHUNKS_PER_SOURCE,
  type SemanticIndexEntry,
  type SemanticSourceKind,
} from '../types/semanticIndex';

function contentHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

function chunkText(input: string, maxChars: number, maxChunks: number): string[] {
  const text = input.trim();
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length && chunks.length < maxChunks) {
    chunks.push(text.slice(i, i + maxChars));
    i += maxChars;
  }
  return chunks;
}

export type UpsertChunkInput = {
  organizationId: string;
  sourceKind: SemanticSourceKind;
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
  embeddingProvider?: string | null;
  embeddingVector?: number[] | null;
};

export async function upsertSemanticChunks(input: UpsertChunkInput): Promise<SemanticIndexEntry[]> {
  const chunks = chunkText(input.content, SEMANTIC_CHUNK_MAX_CHARS, SEMANTIC_MAX_CHUNKS_PER_SOURCE);
  const results: SemanticIndexEntry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const excerpt = chunks[i];
    const hash = contentHash(excerpt);
    const payload = {
      organization_id: input.organizationId,
      source_kind: input.sourceKind,
      source_id: input.sourceId,
      chunk_index: i,
      content_excerpt: excerpt,
      content_hash: hash,
      embedding_provider: input.embeddingProvider ?? null,
      embedding_dim: Array.isArray(input.embeddingVector) ? input.embeddingVector.length : null,
      embedding_vector: input.embeddingVector ?? null,
      metadata: input.metadata ?? {},
    };
    const { data: existing } = await ownedDbTable('semantic_index_entries')
      .select('*')
      .eq('organization_id', input.organizationId)
      .eq('source_kind', input.sourceKind)
      .eq('source_id', input.sourceId)
      .eq('chunk_index', i)
      .maybeSingle();
    if (existing) {
      const { data, error } = await ownedDbTable('semantic_index_entries')
        .update(payload)
        .eq('id', (existing as { id: string }).id)
        .select('*')
        .single();
      if (error || !data) throw new Error(`semantic_chunk_update_failed:${error?.message ?? 'unknown'}`);
      results.push(data as SemanticIndexEntry);
    } else {
      const { data, error } = await ownedDbTable('semantic_index_entries')
        .insert(payload)
        .select('*')
        .single();
      if (error || !data) throw new Error(`semantic_chunk_insert_failed:${error?.message ?? 'unknown'}`);
      results.push(data as SemanticIndexEntry);
    }
  }
  return results;
}

export type RetrieveInput = {
  organizationId: string;
  query: string;
  sourceKind?: SemanticSourceKind;
  limit?: number;
};

export type RetrievalHit = {
  source_kind: SemanticSourceKind;
  source_id: string;
  chunk_index: number;
  content_excerpt: string;
  score: number;
  score_explanation: string;
};

/**
 * Retrieve top-k chunks. Phase 7 uses lexical scoring (token-frequency over
 * the term) until an embedding writer lands. Scores are bounded [0,1] and
 * explained.
 */
export async function retrieveSemanticChunks(input: RetrieveInput): Promise<RetrievalHit[]> {
  const term = input.query.trim().toLowerCase();
  if (term.length < 2) return [];
  let q = ownedDbTable('semantic_index_entries')
    .select('source_kind, source_id, chunk_index, content_excerpt')
    .eq('organization_id', input.organizationId)
    .ilike('content_excerpt', `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`)
    .limit(Math.min(200, Math.max(1, (input.limit ?? 25) * 4)));
  if (input.sourceKind) q = q.eq('source_kind', input.sourceKind);
  const { data, error } = await q;
  if (error) throw new Error(`semantic_retrieve_failed:${error.message}`);
  const rows = (data ?? []) as Array<{ source_kind: SemanticSourceKind; source_id: string; chunk_index: number; content_excerpt: string }>;
  const tokens = term.split(/\s+/);
  const scored: RetrievalHit[] = rows.map((r) => {
    const lower = r.content_excerpt.toLowerCase();
    let hits = 0;
    for (const tok of tokens) {
      if (!tok) continue;
      const idx = lower.indexOf(tok);
      if (idx !== -1) hits += 1;
    }
    const totalHits = (lower.match(new RegExp(term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) ?? []).length;
    const score = Math.min(1, hits * 0.25 + totalHits * 0.05);
    return {
      source_kind: r.source_kind,
      source_id: r.source_id,
      chunk_index: r.chunk_index,
      content_excerpt: r.content_excerpt.slice(0, 400),
      score: Number(score.toFixed(3)),
      score_explanation: `${hits}/${tokens.length} tokens matched; ${totalHits} total occurrences. Lexical fallback (no embeddings yet).`,
    };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(50, Math.max(1, input.limit ?? 25)));
}
