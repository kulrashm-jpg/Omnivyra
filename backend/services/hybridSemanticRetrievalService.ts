/**
 * Phase 9 — Hybrid semantic retrieval (lexical + semantic) with
 * deterministic reranking and an explanation cache.
 *
 * Retrieval modes:
 *   • lexical_only   — substring/token frequency over `content_excerpt`
 *   • semantic_only  — cosine similarity over `embedding_vector` against a
 *                      deterministically-embedded query
 *   • hybrid         — weighted sum of both, normalised to [0,1]
 *
 * Hard guarantees:
 *   • Every hit carries a human-readable `explanation` describing both
 *     score components. No opaque ranking.
 *   • Embedding is the Phase 8 `deterministic_hash_v1` provider — same
 *     query → same vector. No external LLM call.
 *   • Every retrieval is recorded in `semantic_retrieval_explanations`
 *     for audit + cache; cached entries within the TTL window are
 *     returned verbatim. Cache key is (org, query_hash, mode).
 *   • Bounded top-k, bounded candidate sweep.
 *   • Tenant-first filter on every read.
 */

import { createHash } from 'crypto';
import { ownedDbTable } from '../db/writeOwner';
import {
  RETRIEVAL_DEFAULT_TOPK,
  RETRIEVAL_EXPLANATION_TTL_HOURS,
  RETRIEVAL_MAX_TOPK,
  type RetrievalComposition,
  type RetrievalHit,
  type RetrievalMode,
  type SemanticRetrievalExplanation,
} from '../types/semanticRetrievalExplanation';
import {
  SEMANTIC_INDEXING_DEFAULT_DIM,
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

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

function buildQueryHash(orgId: string, query: string, mode: RetrievalMode, sourceKind?: string): string {
  return createHash('sha256').update(`${orgId}|${query.trim().toLowerCase()}|${mode}|${sourceKind ?? ''}`).digest('hex').slice(0, 32);
}

export type HybridRetrieveInput = {
  organizationId: string;
  query: string;
  mode?: RetrievalMode;
  sourceKind?: SemanticSourceKind;
  topK?: number;
  lexicalWeight?: number;
  semanticWeight?: number;
  requestedBy?: string | null;
  useCache?: boolean;
};

export type HybridRetrieveResult = {
  cached: boolean;
  mode: RetrievalMode;
  composition: RetrievalComposition;
  hits: RetrievalHit[];
  explanation_id: string | null;
};

export async function retrieveHybrid(input: HybridRetrieveInput): Promise<HybridRetrieveResult> {
  const mode: RetrievalMode = input.mode ?? 'hybrid';
  const topK = Math.min(RETRIEVAL_MAX_TOPK, Math.max(1, input.topK ?? RETRIEVAL_DEFAULT_TOPK));
  const lexicalWeight = mode === 'semantic_only' ? 0 : Math.min(1, Math.max(0, input.lexicalWeight ?? 0.4));
  const semanticWeight = mode === 'lexical_only' ? 0 : Math.min(1, Math.max(0, input.semanticWeight ?? 0.6));
  const normLex = lexicalWeight / (lexicalWeight + semanticWeight || 1);
  const normSem = semanticWeight / (lexicalWeight + semanticWeight || 1);

  const queryHash = buildQueryHash(input.organizationId, input.query, mode, input.sourceKind);

  if (input.useCache !== false) {
    const cached = await readCache(input.organizationId, queryHash);
    if (cached) {
      return {
        cached: true,
        mode: cached.retrieval_mode,
        composition: cached.composition,
        hits: cached.hits,
        explanation_id: cached.id,
      };
    }
  }

  const term = input.query.trim().toLowerCase();
  if (term.length < 2) {
    return { cached: false, mode, composition: { lexical_weight: normLex, semantic_weight: normSem, k_lexical_candidates: 0, k_semantic_candidates: 0, reranked: false }, hits: [], explanation_id: null };
  }

  // 1. Lexical candidates
  let lexQ = ownedDbTable('semantic_index_entries')
    .select('source_kind, source_id, chunk_index, content_excerpt, embedding_vector, embedding_dim')
    .eq('organization_id', input.organizationId)
    .ilike('content_excerpt', `%${term.replace(/[%_]/g, (m) => `\\${m}`)}%`)
    .limit(Math.min(500, topK * 5));
  if (input.sourceKind) lexQ = lexQ.eq('source_kind', input.sourceKind);
  const lexRows = (await lexQ).data as Array<{
    source_kind: SemanticSourceKind;
    source_id: string;
    chunk_index: number;
    content_excerpt: string;
    embedding_vector: number[] | null;
    embedding_dim: number | null;
  }> ?? [];

  // 2. Semantic candidates (when mode != lexical_only). Pull any rows with
  //    embeddings in this org (bounded sweep), then cosine vs the query
  //    embedding.
  let semRows: typeof lexRows = [];
  if (mode !== 'lexical_only') {
    let semQ = ownedDbTable('semantic_index_entries')
      .select('source_kind, source_id, chunk_index, content_excerpt, embedding_vector, embedding_dim')
      .eq('organization_id', input.organizationId)
      .not('embedding_vector', 'is', null)
      .limit(Math.min(500, topK * 5));
    if (input.sourceKind) semQ = semQ.eq('source_kind', input.sourceKind);
    semRows = (await semQ).data as typeof lexRows ?? [];
  }

  const candidateMap = new Map<string, typeof lexRows[number]>();
  for (const r of lexRows) candidateMap.set(`${r.source_kind}|${r.source_id}|${r.chunk_index}`, r);
  for (const r of semRows) candidateMap.set(`${r.source_kind}|${r.source_id}|${r.chunk_index}`, r);

  const tokens = tokenise(input.query);
  const queryEmbedding = mode === 'lexical_only' ? null : deterministicEmbedding(input.query, SEMANTIC_INDEXING_DEFAULT_DIM);

  const hits: RetrievalHit[] = [];
  for (const r of candidateMap.values()) {
    const lower = r.content_excerpt.toLowerCase();
    let lexicalScore = 0;
    if (mode !== 'semantic_only') {
      const matched = tokens.filter((t) => lower.includes(t)).length;
      const occurrences = (lower.match(new RegExp(term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g')) ?? []).length;
      lexicalScore = Math.min(1, (tokens.length === 0 ? 0 : matched / tokens.length) * 0.7 + occurrences * 0.05);
    }
    let semanticScore = 0;
    if (queryEmbedding && Array.isArray(r.embedding_vector) && r.embedding_dim === queryEmbedding.length) {
      semanticScore = cosine(r.embedding_vector, queryEmbedding);
    }
    const combined =
      mode === 'lexical_only' ? lexicalScore :
      mode === 'semantic_only' ? semanticScore :
      Number((normLex * lexicalScore + normSem * semanticScore).toFixed(4));

    if (combined <= 0) continue;
    const explanation =
      `lex=${lexicalScore.toFixed(3)} (w=${normLex.toFixed(2)}); ` +
      `sem=${semanticScore.toFixed(3)} (w=${normSem.toFixed(2)}); ` +
      `combined=${combined.toFixed(3)}`;
    hits.push({
      source_kind: r.source_kind,
      source_id: r.source_id,
      chunk_id: null,
      lexical_score: Number(lexicalScore.toFixed(4)),
      semantic_score: Number(semanticScore.toFixed(4)),
      combined_score: combined,
      preview: r.content_excerpt.slice(0, 400),
      explanation,
    });
  }

  hits.sort((a, b) => b.combined_score - a.combined_score);
  const top = hits.slice(0, topK);

  const composition: RetrievalComposition = {
    lexical_weight: Number(normLex.toFixed(3)),
    semantic_weight: Number(normSem.toFixed(3)),
    k_lexical_candidates: lexRows.length,
    k_semantic_candidates: semRows.length,
    reranked: mode === 'hybrid',
  };

  const explanationId = await writeCache({
    organizationId: input.organizationId,
    queryHash,
    queryText: input.query,
    retrievalMode: mode,
    hits: top,
    composition,
    requestedBy: input.requestedBy ?? null,
  });

  return { cached: false, mode, composition, hits: top, explanation_id: explanationId };
}

async function readCache(
  organizationId: string,
  queryHash: string,
): Promise<SemanticRetrievalExplanation | null> {
  const cutoff = new Date(Date.now() - RETRIEVAL_EXPLANATION_TTL_HOURS * 3600 * 1000).toISOString();
  const { data } = await ownedDbTable('semantic_retrieval_explanations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('query_hash', queryHash)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SemanticRetrievalExplanation | null) ?? null;
}

async function writeCache(args: {
  organizationId: string;
  queryHash: string;
  queryText: string;
  retrievalMode: RetrievalMode;
  hits: RetrievalHit[];
  composition: RetrievalComposition;
  requestedBy: string | null;
}): Promise<string | null> {
  try {
    const { data } = await ownedDbTable('semantic_retrieval_explanations')
      .insert({
        organization_id: args.organizationId,
        query_hash: args.queryHash,
        query_text: args.queryText.slice(0, 2000),
        retrieval_mode: args.retrievalMode,
        hits: args.hits,
        composition: args.composition,
        requested_by: args.requestedBy,
      })
      .select('id')
      .single();
    return (data as { id: string } | null)?.id ?? null;
  } catch (err: any) {
    console.warn('[hybridRetrieval] explanation write failed:', err?.message);
    return null;
  }
}

export async function listRecentExplanations(
  organizationId: string,
  options?: { limit?: number },
): Promise<SemanticRetrievalExplanation[]> {
  const { data } = await ownedDbTable('semantic_retrieval_explanations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(Math.min(200, Math.max(1, options?.limit ?? 50)));
  return (data as SemanticRetrievalExplanation[]) ?? [];
}
