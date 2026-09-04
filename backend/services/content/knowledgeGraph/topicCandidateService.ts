/**
 * B7.7 — SEMANTIC TOPIC CANDIDATE GENERATION (RECALL ONLY).
 *
 * Surfaces "these two topics might be the same" for an operator to judge. It is
 * a RETRIEVAL mechanism, not a classifier.
 *
 * ── WHY NO THRESHOLD DECIDES ANYTHING ──────────────────────────────────────
 * B7.3 measured, with real text-embedding-3-small vectors, that label-level
 * cosine cannot separate semantic equivalence from topical relatedness:
 *
 *     C semantic-equivalent   0.6498 .. 0.7906   (n=6)
 *     D related-but-distinct  0.2919 .. 0.7594   (n=6)
 *
 * The ranges OVERLAP, and "AI lead scoring models" — a genuinely distinct
 * topic — scored 0.7594, above five of six true equivalents. So a score is
 * EVIDENCE FOR A HUMAN, never a decision. `MIN_RETRIEVAL_SIMILARITY` below is a
 * retrieval/performance parameter that bounds how much noise reaches the review
 * queue; it is explicitly NOT an identity boundary, and nothing in this module
 * treats crossing it as "same topic".
 *
 * ── WHAT THIS MODULE MAY NEVER DO ──────────────────────────────────────────
 * It never writes canonical_topic_id or parent_topic_id, never deletes or
 * merges topics, never rewrites a label, never touches coverage or company
 * data, and never calls an LLM. The ONLY writes it performs are to the
 * `embedding`, `embedding_model` and `embedding_version` columns of a topic it
 * was asked to embed. B7.5's curation writer remains the sole path to identity.
 *
 * ── PRIVACY ────────────────────────────────────────────────────────────────
 * Only `canonical_label` is embedded — a platform-scoped identity field.
 * platform_topic_node holds no company, campaign, content or visitor data, so
 * there is nothing tenant-derived here to embed even by accident. B7.3 flagged
 * that embedding richer, content-derived text would breach the platform privacy
 * model; this module deliberately does not.
 *
 * ── DEPENDENCY INJECTION ───────────────────────────────────────────────────
 * The embedder and the usage ledger are INJECTED. `signalEmbeddingService`
 * writes usage_events through the configured Supabase client, which resolves to
 * PRODUCTION via .env.local — so binding it directly would make every rehearsal
 * a production write. Injection lets a rehearsal supply an isolated embedder and
 * an isolated ledger while production would wire the real ones, with no second
 * billing system and no duplicated provider architecture.
 */

import { supabase } from '../../../db/supabaseClient';
import { cosine } from '../../../../lib/content/originality/similarity';

const TABLE = 'platform_topic_node';

export const EMBEDDING_DIM = 1536;
export const DEFAULT_CANDIDATE_LIMIT = 10;
export const MAX_CANDIDATE_LIMIT = 25;

/**
 * Retrieval floor. A PERFORMANCE parameter, not a correctness boundary: it caps
 * how much obvious noise reaches a human queue. It sits BELOW the measured
 * C-range minimum (0.6498) on purpose, so it cannot silently act as a hidden
 * identity threshold by excluding true equivalents.
 */
export const MIN_RETRIEVAL_SIMILARITY = 0.30;

/** Injected embedder. Production wires signalEmbeddingService; rehearsal an isolated one. */
export interface EmbedderDeps {
  embed: (text: string) => Promise<number[] | null>;
  /** Observability for provider spend. Injected so a rehearsal never writes production usage. */
  recordUsage?: (info: { model: string; inputs: number; tokens?: number | null }) => void | Promise<void>;
  model?: string;
  version?: number;
}

export interface TopicCandidate {
  sourceTopicId: string;
  candidateTopicId: string;
  candidateLabel: string;
  candidateNormalizedLabel: string;
  /** Cosine similarity. INFORMATIONAL EVIDENCE for a human — never a decision. */
  similarityScore: number;
  retrievalRank: number;
  generatedAt: string;
}

export type EmbedOutcome =
  | { ok: true; action: 'embedded' | 'already_embedded'; topicId: string }
  | { ok: false; reason: string };

type NodeRow = {
  id: string;
  canonical_label: string;
  normalized_label: string;
  canonical_topic_id: string | null;
  embedding: unknown;
  embedding_model: string | null;
  embedding_version: number | null;
};

const SELECT_COLS =
  'id, canonical_label, normalized_label, canonical_topic_id, embedding, embedding_model, embedding_version';

/** pgvector returns a string like "[0.1,0.2,…]" through PostgREST; normalise both shapes. */
export function parseEmbedding(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.every((n) => typeof n === 'number') ? (v as number[]) : null;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number') ? parsed : null;
    } catch { return null; }
  }
  return null;
}

/** Validate before persisting: a wrong-dimension vector would corrupt every later comparison. */
function isValidEmbedding(v: number[] | null): v is number[] {
  return Array.isArray(v) && v.length === EMBEDDING_DIM && v.every((n) => Number.isFinite(n));
}

/* ── embedding generation ──────────────────────────────────────────────── */

/**
 * Generate and store the embedding for ONE topic identity.
 *
 * Idempotent: an already-embedded topic (same model + version) is skipped
 * without a provider call, so a re-run costs nothing. Never throws — embedding
 * is enrichment, and a failure must leave the topic usable with `embedding`
 * still NULL and retryable.
 *
 * Writes ONLY embedding/embedding_model/embedding_version. Never identity.
 */
export async function generateTopicEmbedding(
  topicId: string,
  deps: EmbedderDeps,
): Promise<EmbedOutcome> {
  if (!topicId) return { ok: false, reason: 'missing_topic_id' };
  const model = deps.model ?? 'text-embedding-3-small';
  const version = deps.version ?? 1;

  try {
    const { data, error } = await supabase
      .from(TABLE).select(SELECT_COLS).eq('id', topicId).maybeSingle();
    if (error || !data) return { ok: false, reason: 'topic_not_found' };
    const row = data as NodeRow;

    // Idempotency — skip when an embedding of this exact generation exists.
    if (parseEmbedding(row.embedding) && row.embedding_model === model && row.embedding_version === version) {
      return { ok: true, action: 'already_embedded', topicId };
    }

    // ONLY the platform-scoped identity label is sent to the provider.
    const text = String(row.canonical_label ?? '').trim() || row.normalized_label;
    if (!text) return { ok: false, reason: 'no_embeddable_label' };

    const vector = await deps.embed(text);
    if (!isValidEmbedding(vector)) {
      // Covers provider failure, malformed output and wrong dimensionality.
      return { ok: false, reason: 'invalid_or_missing_embedding' };
    }

    try { await deps.recordUsage?.({ model, inputs: 1 }); }
    catch { /* accounting must not fail the operation, but must be attempted */ }

    const { error: writeError } = await supabase
      .from(TABLE)
      .update({ embedding: vector, embedding_model: model, embedding_version: version })
      .eq('id', topicId);
    if (writeError) return { ok: false, reason: `write_failed:${writeError.message}` };

    return { ok: true, action: 'embedded', topicId };
  } catch (e) {
    return { ok: false, reason: `exception:${(e as Error)?.message ?? 'unknown'}` };
  }
}

/**
 * Bounded backfill for topics with `embedding IS NULL`.
 *
 * Resumable by construction: the NULL predicate IS the work queue, so a crashed
 * run simply leaves fewer rows for the next. Batch-bounded, never a loop to
 * exhaustion — an unbounded backfill over a paid provider is precisely the cost
 * path B7.3 refused to open.
 */
export async function backfillTopicEmbeddings(
  deps: EmbedderDeps,
  opts: { batchSize?: number } = {},
): Promise<{ attempted: number; embedded: number; failed: number }> {
  const batchSize = Math.min(50, Math.max(1, Math.floor(opts.batchSize ?? 10)));
  const result = { attempted: 0, embedded: 0, failed: 0 };
  try {
    const { data, error } = await supabase
      .from(TABLE).select('id').is('embedding', null)
      .order('normalized_label', { ascending: true })   // deterministic, UNIQUE column
      .limit(batchSize);
    if (error || !Array.isArray(data)) return result;

    for (const r of data as Array<{ id: string }>) {
      result.attempted += 1;
      const out = await generateTopicEmbedding(String(r.id), deps);
      if ('reason' in out) result.failed += 1;
      else result.embedded += 1;
    }
  } catch { /* fail-safe: partial progress is valid progress */ }
  return result;
}

/* ── candidate retrieval ───────────────────────────────────────────────── */

/**
 * Retrieve the nearest existing topic identities for one source topic.
 *
 * Comparison is done in application code over a bounded fetch — the same shape
 * the originality gate already uses, reusing its `cosineSimilarity`. The HNSW
 * index remains available for a future SQL-side optimisation; moving there
 * would need an RPC (a migration), which this phase does not require.
 *
 * Exclusions: itself; topics that are already aliases (they are not identities,
 * so proposing one as a merge target would violate B7.5's flat-alias rule);
 * and the source's own canonical if it already has one.
 *
 * Deterministic ordering: similarity DESC, then normalized_label ASC as a
 * stable tie-break, so equal scores never reorder between runs.
 *
 * Never throws; never writes.
 */
export async function findTopicCandidates(
  topicId: string,
  opts: { limit?: number; minSimilarity?: number } = {},
): Promise<TopicCandidate[]> {
  if (!topicId) return [];
  const limit = Math.min(MAX_CANDIDATE_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_CANDIDATE_LIMIT)));
  const floor = typeof opts.minSimilarity === 'number' ? opts.minSimilarity : MIN_RETRIEVAL_SIMILARITY;

  try {
    const { data: srcData, error: srcErr } = await supabase
      .from(TABLE).select(SELECT_COLS).eq('id', topicId).maybeSingle();
    if (srcErr || !srcData) return [];
    const source = srcData as NodeRow;

    const sourceVec = parseEmbedding(source.embedding);
    if (!isValidEmbedding(sourceVec)) return [];   // not embedded yet ⇒ no candidates, not an error

    // Only identities are eligible targets.
    const { data, error } = await supabase
      .from(TABLE).select(SELECT_COLS)
      .is('canonical_topic_id', null)
      .not('embedding', 'is', null)
      .order('normalized_label', { ascending: true });
    if (error || !Array.isArray(data)) return [];

    const generatedAt = new Date().toISOString();
    const scored: TopicCandidate[] = [];

    for (const raw of data as NodeRow[]) {
      if (raw.id === topicId) continue;                               // never itself
      if (source.canonical_topic_id && raw.id === source.canonical_topic_id) continue;

      // Comparing across embedding generations is meaningless — skip rather
      // than silently produce a nonsense score.
      if (raw.embedding_model !== source.embedding_model) continue;
      if (raw.embedding_version !== source.embedding_version) continue;

      const vec = parseEmbedding(raw.embedding);
      if (!isValidEmbedding(vec)) continue;

      const score = cosine(sourceVec, vec);
      if (!Number.isFinite(score) || score < floor) continue;

      scored.push({
        sourceTopicId: topicId,
        candidateTopicId: raw.id,
        candidateLabel: raw.canonical_label,
        candidateNormalizedLabel: raw.normalized_label,
        similarityScore: Number(score.toFixed(4)),
        retrievalRank: 0,
        generatedAt,
      });
    }

    scored.sort((a, b) =>
      b.similarityScore - a.similarityScore ||
      a.candidateNormalizedLabel.localeCompare(b.candidateNormalizedLabel));

    return scored.slice(0, limit).map((c, i) => ({ ...c, retrievalRank: i + 1 }));
  } catch {
    return [];
  }
}
