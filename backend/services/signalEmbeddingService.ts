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
