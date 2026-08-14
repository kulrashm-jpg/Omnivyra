/**
 * Signal Embedding Service
 * Generates embeddings for signal topics using OpenAI embeddings API.
 * Used by the clustering engine for semantic similarity.
 *
 * Cost tracking: every successful embedding call emits a usage_events row
 * with source_type='embedding'. Background/system callers (clustering engine,
 * cross-org backfills) pass the `system: true` flag to log under
 * source_type='system' so the cost is visible but not user-billed.
 */

import OpenAI from 'openai';
import { logUsageEvent, resolveEmbeddingCost } from './usageLedgerService';
import { assertModelPricingExists, recordCostAnomaly } from './pricingService';

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;
const PROCESS_TYPE = 'embedding_generation';

// Singleton — reuses HTTP connection pool across embedding calls
let _embeddingClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!_embeddingClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('Missing OPENAI_API_KEY for embeddings');
    _embeddingClient = new OpenAI({ apiKey });
  }
  return _embeddingClient;
}

export interface GenerateTopicEmbeddingOptions {
  /** Required — the org this embedding is being generated for. */
  companyId: string;
  /** Optional user attribution (user-initiated flows). */
  userId?: string | null;
  /** Mark as background/infra work; routes to source_type='system'. Default false. */
  system?: boolean;
  /** Extra context attached to the usage_events row. */
  metadata?: Record<string, unknown>;
}

/**
 * Generate embedding vector for a topic string.
 * Returns array of 1536 floats compatible with pgvector vector(1536).
 * Uses OpenAI text-embedding-3-small by default.
 */
export async function generateTopicEmbedding(
  topic: string,
  opts: GenerateTopicEmbeddingOptions,
): Promise<number[]> {
  const text = (topic ?? '').trim();
  if (!text) {
    throw new Error('Cannot embed empty topic');
  }
  if (!opts?.companyId) {
    throw new Error('generateTopicEmbedding requires opts.companyId for cost attribution');
  }

  // Phase 7 final: pre-flight pricing assertion. Block the call before we
  // pay OpenAI for an embedding whose cost we can't attribute.
  try {
    await assertModelPricingExists('openai', EMBEDDING_MODEL, 'embedding');
  } catch (err: any) {
    void recordCostAnomaly({
      organizationId: opts.companyId,
      type:           'pricing_missing',
      severity:       'critical',
      processType:    PROCESS_TYPE,
      modelName:      EMBEDDING_MODEL,
      metadata:       { preflight: true, reason: err?.message ?? 'unknown' },
    });
    throw err;
  }

  const client = getClient();
  const startedAt = Date.now();
  let response: Awaited<ReturnType<OpenAI['embeddings']['create']>>;
  try {
    response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8191), // model limit
      dimensions: EMBEDDING_DIM,
    });
  } catch (err: any) {
    // Log the failed attempt so errored embedding calls don't become invisible bleed.
    void logUsageEvent({
      organization_id: opts.companyId,
      user_id:         opts.userId ?? null,
      source_type:     opts.system ? 'system' : 'embedding',
      provider_name:   'openai',
      model_name:      EMBEDDING_MODEL,
      source_name:     'openai',
      process_type:    PROCESS_TYPE,
      latency_ms:      Date.now() - startedAt,
      error_flag:      true,
      error_type:      err?.message?.slice(0, 200) ?? 'unknown',
      metadata:        { ...opts.metadata, input_length: text.length },
    });
    throw err;
  }

  const embedding = response.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) {
    throw new Error(`Invalid embedding response: expected ${EMBEDDING_DIM} dimensions`);
  }

  const totalTokens = Number((response as any)?.usage?.total_tokens ?? 0);
  const cost = await resolveEmbeddingCost({
    providerName: 'openai',
    modelName: EMBEDDING_MODEL,
    totalTokens,
    processType: PROCESS_TYPE,
    organizationId: opts.companyId,
  });

  void logUsageEvent({
    organization_id: opts.companyId,
    user_id:         opts.userId ?? null,
    source_type:     opts.system ? 'system' : 'embedding',
    provider_name:   'openai',
    model_name:      EMBEDDING_MODEL,
    source_name:     'openai',
    process_type:    PROCESS_TYPE,
    input_tokens:    totalTokens,  // embeddings have no input/output split
    output_tokens:   0,
    total_tokens:    totalTokens,
    latency_ms:      Date.now() - startedAt,
    unit_cost:       totalTokens > 0 ? cost.total_cost_usd / totalTokens : null,
    total_cost:      cost.total_cost_usd,
    total_cost_usd:  cost.total_cost_usd,
    final_price_usd: cost.final_price_usd,
    pricing_snapshot: cost.pricing_snapshot,
    metadata:        { ...opts.metadata, input_length: text.length },
  });

  return embedding;
}

/**
 * W3-6 (audit B-36) — batched embedding generation. The provider accepts an
 * ARRAY input: N texts in ONE round-trip, same model, same dimensions —
 * output for each text is identical to the single-input call. Billing
 * parity: the provider bills the same total tokens; ONE usage event carries
 * the batch's total tokens/cost (attribution granularity per-batch instead
 * of per-item, same organization — recorded in metadata.batch_size).
 * Order-preserving via the response's index field. Callers chunk to
 * EMBEDDING_BATCH_MAX (bounded request size).
 */
export const EMBEDDING_BATCH_MAX = 64;

export async function generateTopicEmbeddingsBatch(
  texts: string[],
  opts: Parameters<typeof generateTopicEmbedding>[1],
): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await generateTopicEmbedding(texts[0]!, opts)];
  if (texts.length > EMBEDDING_BATCH_MAX) {
    throw new Error(`generateTopicEmbeddingsBatch: max ${EMBEDDING_BATCH_MAX} texts per batch`);
  }
  if (!opts?.companyId) {
    throw new Error('generateTopicEmbeddingsBatch requires opts.companyId for cost attribution');
  }

  await assertModelPricingExists('openai', EMBEDDING_MODEL, 'embedding');

  const client = getClient();
  const startedAt = Date.now();
  const inputs = texts.map((t) => t.slice(0, 8191));
  let response: Awaited<ReturnType<OpenAI['embeddings']['create']>>;
  try {
    response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
      dimensions: EMBEDDING_DIM,
    });
  } catch (err: any) {
    void logUsageEvent({
      organization_id: opts.companyId,
      user_id:         opts.userId ?? null,
      source_type:     opts.system ? 'system' : 'embedding',
      provider_name:   'openai',
      model_name:      EMBEDDING_MODEL,
      source_name:     'openai',
      process_type:    PROCESS_TYPE,
      latency_ms:      Date.now() - startedAt,
      error_flag:      true,
      error_type:      err?.message?.slice(0, 200) ?? 'unknown',
      metadata:        { ...opts.metadata, batch_size: texts.length },
    });
    throw err;
  }

  const byIndex = new Map<number, number[]>();
  for (const row of response.data ?? []) {
    if (Array.isArray(row?.embedding)) byIndex.set(row.index, row.embedding);
  }
  const embeddings = texts.map((_t, i) => byIndex.get(i));
  if (embeddings.some((e) => !Array.isArray(e) || e.length !== EMBEDDING_DIM)) {
    throw new Error(`Invalid batch embedding response: expected ${texts.length}×${EMBEDDING_DIM}`);
  }

  const totalTokens = Number((response as any)?.usage?.total_tokens ?? 0);
  const cost = await resolveEmbeddingCost({
    providerName: 'openai',
    modelName: EMBEDDING_MODEL,
    totalTokens,
    processType: PROCESS_TYPE,
    organizationId: opts.companyId,
  });
  void logUsageEvent({
    organization_id: opts.companyId,
    user_id:         opts.userId ?? null,
    source_type:     opts.system ? 'system' : 'embedding',
    provider_name:   'openai',
    model_name:      EMBEDDING_MODEL,
    source_name:     'openai',
    process_type:    PROCESS_TYPE,
    input_tokens:    totalTokens,
    output_tokens:   0,
    total_tokens:    totalTokens,
    latency_ms:      Date.now() - startedAt,
    unit_cost:       totalTokens > 0 ? cost.total_cost_usd / totalTokens : null,
    total_cost:      cost.total_cost_usd,
    total_cost_usd:  cost.total_cost_usd,
    final_price_usd: cost.final_price_usd,
    pricing_snapshot: cost.pricing_snapshot,
    metadata:        { ...opts.metadata, batch_size: texts.length },
  });

  return embeddings as number[][];
}

/**
 * Format embedding as pgvector string: '[0.1,0.2,...]'
 */
export function embeddingToPgVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns value in [-1, 1] (1 = identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/* ══════════════════════════════════════════════════════════════════════════
 * B7.8-C.2 — PLATFORM EMBEDDING PATH (no customer attribution)
 * ═══════════════════════════════════════════════════════════════════════ */

import { recordPlatformUsage } from './billing/platformUsageLedgerService';

export interface PlatformEmbeddingOptions {
  /** What the spend is for — reconciliation (platform_usage_events.resource_*). */
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

export type PlatformEmbeddingResult =
  | { ok: true; embedding: number[]; totalCost: number | null }
  | { ok: false; reason: string };

/**
 * Generate an embedding for a PLATFORM resource that has no owning company.
 *
 * Sibling of generateTopicEmbedding above, which is UNCHANGED. That function
 * requires opts.companyId for cost attribution and is correct to: customer
 * spend must be attributable. Platform resources (platform_topic_node) are
 * tenant-less by construction, so there is no organization to supply — hence
 * this separate path writing to platform_usage_events instead of usage_events.
 *
 * REUSES the same infrastructure: the same getClient() connection-pool
 * singleton, the same EMBEDDING_MODEL, the same EMBEDDING_DIM, and the same
 * pre-flight pricing assertion. Only the ACCOUNTING destination differs.
 *
 * ── ORDERING (mirrors the customer path above) ─────────────────────────────
 *   1. pre-flight pricing assert — never pay for a cost we cannot price
 *   2. provider call
 *   3. dimension validation
 *   4. LEDGER
 *   5. return the vector for the caller to persist
 *
 * The ledger is written BEFORE the caller persists, and a ledger failure
 * returns ok:false. So an embedding can never be persisted while its spend
 * record is silently lost — the caller simply gets no vector, the topic keeps
 * `embedding IS NULL`, and the operation is retriggerable. Spend without a
 * stored vector is the acceptable direction; a stored vector without a spend
 * record is not.
 *
 * NEVER THROWS. Never writes canonical_topic_id, parent_topic_id, angle_label
 * or any coverage row — it does not write platform_topic_node at all.
 */
export async function generatePlatformEmbedding(
  text: string,
  opts: PlatformEmbeddingOptions,
): Promise<PlatformEmbeddingResult> {
  const input = (text ?? '').trim();
  if (!input) return { ok: false, reason: 'empty_text' };
  if (!opts?.resourceType || !opts?.resourceId) return { ok: false, reason: 'missing_resource' };

  // 1. Pre-flight: same assertion the customer path makes, for the same reason.
  try {
    await assertModelPricingExists('openai', EMBEDDING_MODEL, 'embedding');
  } catch (err: any) {
    // No recordCostAnomaly here — that helper requires an organizationId, and
    // inventing one is the exact failure this whole design avoids.
    return { ok: false, reason: `pricing_missing:${err?.message ?? 'unknown'}` };
  }

  // 2. Provider call — ONLY the caller-supplied label is sent.
  let response: Awaited<ReturnType<OpenAI['embeddings']['create']>>;
  try {
    response = await getClient().embeddings.create({
      model: EMBEDDING_MODEL,
      input: input.slice(0, 8191),
      dimensions: EMBEDDING_DIM,
    });
  } catch (err: any) {
    return { ok: false, reason: `provider_failed:${err?.message?.slice(0, 120) ?? 'unknown'}` };
  }

  // 3. Dimension validation before anything is recorded or returned.
  const vector = response?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIM || !vector.every((n) => Number.isFinite(n))) {
    return { ok: false, reason: 'invalid_embedding_shape' };
  }

  // 4. Ledger BEFORE the caller persists (see ordering note above).
  const usage = await recordPlatformUsage({
    providerName: 'openai',
    modelName: EMBEDDING_MODEL,
    sourceType: 'system',
    sourceName: 'openai',
    processType: PROCESS_TYPE,
    resourceType: opts.resourceType,
    resourceId: opts.resourceId,
    totalTokens: Number(response?.usage?.total_tokens ?? 0),
    metadata: { ...opts.metadata, input_length: input.length },
  });

  if (!('action' in usage)) {
    // Accounting failed. Refuse the vector so it cannot be persisted without a
    // spend record. The provider was already paid — that cost is now visible
    // only in the returned reason and the provider invoice, which is why this
    // path returns a specific, greppable failure.
    return { ok: false, reason: `ledger_failed:${(usage as { reason: string }).reason}` };
  }

  return { ok: true, embedding: vector as number[], totalCost: usage.totalCost };
}
