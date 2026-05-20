/**
 * OpenAI invoice/usage export normalizer — PURE, DETERMINISTIC.
 *
 * Targets the documented public OpenAI Usage API JSON shape (`/v1/usage`,
 * daily aggregations). Tolerant: unknown fields are ignored, missing
 * sub-arrays are treated as empty, raw payload is preserved verbatim by the
 * caller into `provider_invoice_imports.raw_payload`. NEVER throws on a
 * malformed row — skips and reports it in `warnings` so the ingestion
 * orchestrator can record a meaningful adjustment/anomaly.
 *
 * Out of scope here (no speculative attribution): dashboard CSV export,
 * invoice PDF parsing, and the legacy `/dashboard/billing/usage` aggregate.
 * The adapter contract leaves room for a future "billing line items"
 * dollar-denominated payload (handled by `normalizeBillingLineItems`) so
 * dollar exports can be added additively when real samples land.
 *
 * USD model: OpenAI's Usage API returns counts only (no $). USD is computed
 * deterministically from caller-provided rate tables (the same source the
 * existing pricing layer uses — llm_model_pricing rows or, as last resort,
 * the static fallback consistent with blackHoleCostCapture's `static_estimate_v1`).
 * The caller decides which rate source to pass; this module does NOT read DB.
 */

export const OPENAI_ADAPTER_VERSION = 'openai_usage_v1';

export type OpenAiKind = 'completion' | 'embedding' | 'image' | 'transcription';

/** Per-row token/count rate for `kind === 'completion'|'embedding'`. */
export interface TokenRate {
  /** USD per 1k input/context tokens. */
  in_per_1k: number;
  /** USD per 1k output/generated tokens. */
  out_per_1k: number;
}
/** Per-image flat rate for `kind === 'image'`. */
export interface ImageRate { per_image: number }
/** Per-second / per-minute rate for `kind === 'transcription'`. */
export interface AudioRate { per_minute: number }

export interface RateTable {
  /** Keyed by snapshot_id / model name (e.g. 'gpt-4o-mini'). */
  tokens?: Record<string, TokenRate>;
  defaultToken?: TokenRate;
  images?: Record<string, ImageRate>;
  defaultImage?: ImageRate;
  audio?: Record<string, AudioRate>;
  defaultAudio?: AudioRate;
}

export interface NormalizedInvoiceLine {
  /** UTC day bucket (YYYY-MM-DD), derived from aggregation_timestamp. */
  period_day: string;
  kind: OpenAiKind;
  model: string;
  n_requests: number;
  /** completion/embedding only — else 0. */
  input_tokens: number;
  /** completion only — else 0. */
  output_tokens: number;
  /** image only — else 0. */
  image_count: number;
  /** transcription only — else 0 (seconds). */
  audio_seconds: number;
  /** Caller's organization_id at OpenAI (provider-side), NOT our customer org. */
  provider_org_id: string | null;
  /** Deterministically computed USD from the rate table. */
  total_usd: number;
}

export interface NormalizeResult {
  adapter_version: string;
  lines: NormalizedInvoiceLine[];
  /** Non-fatal: rows that couldn't be normalized are reported here. */
  warnings: string[];
}

function dayBucket(epochSeconds: unknown): string | null {
  const s = typeof epochSeconds === 'number' ? epochSeconds : Number(epochSeconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  return new Date(s * 1000).toISOString().slice(0, 10);
}

function tokenCost(rate: TokenRate | undefined, inTok: number, outTok: number): number {
  const r = rate ?? { in_per_1k: 0, out_per_1k: 0 };
  return (Math.max(0, inTok) / 1000) * r.in_per_1k + (Math.max(0, outTok) / 1000) * r.out_per_1k;
}

/**
 * Pure normalization of a `/v1/usage` JSON envelope. Caller passes a rate
 * table so USD is deterministic and replay-safe per fixed rates.
 */
export function normalizeOpenAiUsageExport(args: {
  payload: unknown;
  rates: RateTable;
}): NormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];

  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});

  const pushLine = (l: NormalizedInvoiceLine) => lines.push(l);

  // ── Completions / chat / embeddings (data + embeddings_data) ────────────
  const completionRows = Array.isArray(env.data) ? env.data : [];
  for (const raw of completionRows) {
    const row = raw as Record<string, unknown>;
    const day = dayBucket(row.aggregation_timestamp);
    if (!day) { warnings.push('row missing aggregation_timestamp'); continue; }
    const model = String(row.snapshot_id ?? '').trim();
    if (!model) { warnings.push(`row at ${day} missing snapshot_id`); continue; }
    const n_requests = Number(row.n_requests ?? 0) || 0;
    const inTok  = Number(row.n_context_tokens_total   ?? 0) || 0;
    const outTok = Number(row.n_generated_tokens_total ?? 0) || 0;
    const op = String(row.operation ?? 'completion').toLowerCase();
    const kind: OpenAiKind = op.includes('embed') ? 'embedding' : 'completion';
    const rate = args.rates.tokens?.[model] ?? args.rates.defaultToken;
    pushLine({
      period_day: day, kind, model,
      n_requests, input_tokens: inTok, output_tokens: outTok,
      image_count: 0, audio_seconds: 0,
      provider_org_id: typeof row.organization_id === 'string' ? row.organization_id : null,
      total_usd: tokenCost(rate, inTok, outTok),
    });
  }

  const embeddingsRows = Array.isArray(env.embeddings_data) ? env.embeddings_data : [];
  for (const raw of embeddingsRows) {
    const row = raw as Record<string, unknown>;
    const day = dayBucket(row.aggregation_timestamp);
    if (!day) { warnings.push('embeddings row missing aggregation_timestamp'); continue; }
    const model = String(row.snapshot_id ?? '').trim();
    if (!model) continue;
    const n_requests = Number(row.n_requests ?? 0) || 0;
    const inTok  = Number(row.n_context_tokens_total ?? 0) || 0;
    const rate = args.rates.tokens?.[model] ?? args.rates.defaultToken;
    pushLine({
      period_day: day, kind: 'embedding', model,
      n_requests, input_tokens: inTok, output_tokens: 0,
      image_count: 0, audio_seconds: 0,
      provider_org_id: typeof row.organization_id === 'string' ? row.organization_id : null,
      total_usd: tokenCost(rate, inTok, 0),
    });
  }

  // ── Image generation (dalle_api_data) ────────────────────────────────────
  const dalleRows = Array.isArray(env.dalle_api_data) ? env.dalle_api_data : [];
  for (const raw of dalleRows) {
    const row = raw as Record<string, unknown>;
    const day = dayBucket(row.timestamp);
    if (!day) { warnings.push('dalle row missing timestamp'); continue; }
    const model = String(row.image_models ?? row.model_id ?? 'dall-e').trim();
    const images = Number(row.num_images ?? 0) || 0;
    const rate = args.rates.images?.[model] ?? args.rates.defaultImage;
    pushLine({
      period_day: day, kind: 'image', model,
      n_requests: Number(row.num_requests ?? 0) || 0,
      input_tokens: 0, output_tokens: 0,
      image_count: images, audio_seconds: 0,
      provider_org_id: typeof row.organization_id === 'string' ? row.organization_id : null,
      total_usd: Math.max(0, images) * (rate?.per_image ?? 0),
    });
  }

  // ── Whisper / transcription (whisper_api_data) ───────────────────────────
  const whisperRows = Array.isArray(env.whisper_api_data) ? env.whisper_api_data : [];
  for (const raw of whisperRows) {
    const row = raw as Record<string, unknown>;
    const day = dayBucket(row.timestamp);
    if (!day) { warnings.push('whisper row missing timestamp'); continue; }
    const model = String(row.model_id ?? 'whisper-1').trim();
    const seconds = Number(row.num_seconds ?? 0) || 0;
    const rate = args.rates.audio?.[model] ?? args.rates.defaultAudio;
    pushLine({
      period_day: day, kind: 'transcription', model,
      n_requests: Number(row.num_requests ?? 0) || 0,
      input_tokens: 0, output_tokens: 0,
      image_count: 0, audio_seconds: seconds,
      provider_org_id: typeof row.organization_id === 'string' ? row.organization_id : null,
      total_usd: (Math.max(0, seconds) / 60) * (rate?.per_minute ?? 0),
    });
  }

  return { adapter_version: OPENAI_ADAPTER_VERSION, lines, warnings };
}

/**
 * Future entry point for dollar-denominated billing line items (when the
 * caller has a real OpenAI invoice export with explicit USD). Pure pass-
 * through with light validation — adds no speculative fields, USD taken
 * verbatim from the input. Returns an empty result when shape doesn't match
 * (so the orchestrator can still record the raw payload).
 */
export function normalizeBillingLineItems(payload: unknown): NormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (payload && typeof payload === 'object' ? payload as Record<string, unknown> : {});
  const items = Array.isArray(env.line_items) ? env.line_items : [];
  for (const raw of items) {
    const r = raw as Record<string, unknown>;
    const day = typeof r.period_day === 'string' ? r.period_day
      : (typeof r.timestamp === 'number' ? dayBucket(r.timestamp) : null);
    if (!day) { warnings.push('billing line missing period_day/timestamp'); continue; }
    const usd = Number(r.amount_usd ?? r.total_usd ?? 0);
    if (!Number.isFinite(usd)) { warnings.push('billing line invalid usd'); continue; }
    lines.push({
      period_day: day,
      kind: (String(r.kind ?? 'completion') as OpenAiKind),
      model: String(r.model ?? r.snapshot_id ?? 'unknown').trim() || 'unknown',
      n_requests: Number(r.n_requests ?? 0) || 0,
      input_tokens: Number(r.input_tokens ?? 0) || 0,
      output_tokens: Number(r.output_tokens ?? 0) || 0,
      image_count: Number(r.image_count ?? 0) || 0,
      audio_seconds: Number(r.audio_seconds ?? 0) || 0,
      provider_org_id: typeof r.organization_id === 'string' ? r.organization_id : null,
      total_usd: Math.max(0, usd),
    });
  }
  return { adapter_version: 'openai_billing_v1', lines, warnings };
}
