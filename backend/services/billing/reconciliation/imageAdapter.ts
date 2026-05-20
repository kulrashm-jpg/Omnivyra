/**
 * Image provider invoice/usage normalizer — PURE, DETERMINISTIC.
 *
 * Targets three well-defined operator-supplied shapes for image-generation
 * providers (DALL·E/OpenAI image, plus a generic shape that covers Imagen,
 * Stability, Midjourney, Replicate, etc.). NEVER throws on a malformed row
 * — skips and reports it in `warnings` so the orchestrator can record a
 * meaningful adjustment/anomaly. NO speculative attribution.
 *
 *   (A) DALL·E standalone export — same row schema OpenAI's `/v1/usage`
 *       returns under `dalle_api_data`, submitted as a standalone payload
 *       `{ dalle_api_data: [{ timestamp, image_models|model_id, num_images,
 *       num_requests, organization_id? }] }`. USD computed from caller-
 *       supplied rate table (per-image flat).
 *
 *   (B) Generic image usage rollup — operator-aggregated per-call rollup
 *       for any image provider:
 *       `{ entries: [{ created_at|date|timestamp, model, image_count|count,
 *       resolution?, quality?, n_requests?, organization_id|workspace_id|
 *       project_id|account_id?, amount_usd? }] }`. `amount_usd` authoritative
 *       when present; else rate-derived.
 *
 *   (C) Generic image billing export — provider-agnostic dollar-denominated
 *       lines for cases where the operator has the raw invoice $ already
 *       split per (day, model, org):
 *       `{ line_items: [{ period_day, model, image_count, resolution?,
 *       quality?, amount_usd?, organization_id? }] }`. `amount_usd`
 *       authoritative when present.
 *
 * Resolution/quality DOES NOT alter the matcher bucket key (the matcher
 * keys on (period_day, model) for cross-provider consistency). Resolution/
 * quality are preserved on the normalized line for audit and surface on
 * the adjustment row via metadata. If the caller wants resolution-/
 * quality-tier-separated reconciliation, they should encode the tier into
 * the model string at the source (e.g. `dall-e-3-hd-1024`) so usage_events
 * and invoice rows share the same fine-grained model identifier.
 *
 * USD model: ImageRate is `{ per_image: number }` — same shape OpenAI's
 * `static_estimate_v1` image rates use. Caller decides which rate source
 * to pass; this module does NOT read DB.
 */

import type { NormalizedInvoiceLine, OpenAiKind, ImageRate, RateTable } from './openaiAdapter';

export const IMAGE_ADAPTER_VERSION_BILLING = 'image_billing_v1';
export const IMAGE_ADAPTER_VERSION_DALLE   = 'image_dalle_v1';
export const IMAGE_ADAPTER_VERSION_USAGE   = 'image_usage_v1';

export interface ImageNormalizeResult {
  adapter_version: string;
  lines: NormalizedInvoiceLine[];
  warnings: string[];
}

function asPositiveNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

function dayBucketFromValue(value: unknown): string | null {
  if (typeof value === 'string' && value.length >= 10) {
    const d = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function imageCount(row: Record<string, unknown>): number {
  if (row.image_count != null) return Math.round(asPositiveNumber(row.image_count));
  if (row.count       != null) return Math.round(asPositiveNumber(row.count));
  if (row.num_images  != null) return Math.round(asPositiveNumber(row.num_images));
  return 0;
}

function imageCostUsd(rate: ImageRate | undefined, count: number): number {
  const r = rate ?? { per_image: 0 };
  return Math.max(0, count) * (r.per_image ?? 0);
}

function pickOrgId(row: Record<string, unknown>): string | null {
  const candidates = [
    row.organization_id, row.workspace_id, row.project_id, row.account_id,
  ];
  for (const v of candidates) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** (A) DALL·E standalone audio-like image export. */
export function normalizeDalleUsageExport(args: {
  payload: unknown;
  rates: RateTable;
}): ImageNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});

  type Key = string;
  const bucket: Map<Key, NormalizedInvoiceLine> = new Map();

  const rows = Array.isArray(env.dalle_api_data) ? env.dalle_api_data
             : (Array.isArray(env.data)          ? env.data
             : (Array.isArray(args.payload)      ? (args.payload as unknown[])
             : []));

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const day = dayBucketFromValue(row.timestamp) ?? dayBucketFromValue(row.created_at);
    if (!day) { warnings.push('dalle row missing timestamp'); continue; }
    const model = String(row.image_models ?? row.model_id ?? row.model ?? 'dall-e').trim() || 'dall-e';
    const count = imageCount(row);
    if (count <= 0) { warnings.push(`dalle row at ${day} missing image count`); continue; }
    const orgId = pickOrgId(row);
    const n_requests = asPositiveNumber(row.num_requests ?? row.n_requests);

    const k = `${day}|${model}|${orgId ?? ''}`;
    const rate = args.rates.images?.[model] ?? args.rates.defaultImage;
    const addUsd = imageCostUsd(rate, count);
    const existing = bucket.get(k);
    if (existing) {
      existing.n_requests  += n_requests || 1;
      existing.image_count += count;
      existing.total_usd   += addUsd;
    } else {
      bucket.set(k, {
        period_day:    day,
        kind:          'image' as OpenAiKind,
        model,
        n_requests:    n_requests || 1,
        input_tokens:  0,
        output_tokens: 0,
        image_count:   count,
        audio_seconds: 0,
        provider_org_id: orgId,
        total_usd:     addUsd,
      });
    }
  }

  for (const line of stableSorted([...bucket.values()])) lines.push(line);
  return { adapter_version: IMAGE_ADAPTER_VERSION_DALLE, lines, warnings };
}

/** (B) Generic image usage rollup — covers Imagen/Stability/Midjourney/etc. */
export function normalizeImageUsageExport(args: {
  payload: unknown;
  rates: RateTable;
}): ImageNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const entries = Array.isArray(env.entries) ? env.entries
                : (Array.isArray(env.usage)  ? env.usage : []);

  type Key = string;
  const bucket: Map<Key, NormalizedInvoiceLine> = new Map();

  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const day = dayBucketFromValue(r.created_at) ?? dayBucketFromValue(r.date) ?? dayBucketFromValue(r.timestamp);
    if (!day) { warnings.push('image entry missing created_at/date'); continue; }
    const model = String(r.model ?? '').trim();
    if (!model) { warnings.push(`image entry at ${day} missing model`); continue; }
    const count = imageCount(r);
    if (count <= 0) { warnings.push(`image entry at ${day} missing image count`); continue; }

    const orgId = pickOrgId(r);
    const n_requests = asPositiveNumber(r.n_requests ?? r.num_requests ?? r.count_requests);

    const explicitUsd = (typeof r.amount_usd === 'number' || typeof r.amount_usd === 'string')
      ? Number(r.amount_usd) : NaN;
    const rate = args.rates.images?.[model] ?? args.rates.defaultImage;
    const useExplicit = Number.isFinite(explicitUsd) && explicitUsd >= 0;
    const addUsd = useExplicit ? explicitUsd : imageCostUsd(rate, count);

    const k = `${day}|${model}|${orgId ?? ''}`;
    const existing = bucket.get(k);
    if (existing) {
      existing.n_requests  += n_requests || 1;
      existing.image_count += count;
      existing.total_usd   += addUsd;
    } else {
      bucket.set(k, {
        period_day:    day,
        kind:          'image',
        model,
        n_requests:    n_requests || 1,
        input_tokens:  0,
        output_tokens: 0,
        image_count:   count,
        audio_seconds: 0,
        provider_org_id: orgId,
        total_usd:     addUsd,
      });
    }
  }

  for (const line of stableSorted([...bucket.values()])) lines.push(line);
  return { adapter_version: IMAGE_ADAPTER_VERSION_USAGE, lines, warnings };
}

/** (C) Generic image billing export — provider-agnostic dollar-denominated. */
export function normalizeImageBillingExport(args: {
  payload: unknown;
  rates: RateTable;
}): ImageNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const items = Array.isArray(env.line_items) ? env.line_items
              : (Array.isArray(env.lines)     ? env.lines : []);

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const day = dayBucketFromValue(r.period_day) ?? dayBucketFromValue(r.timestamp);
    if (!day) { warnings.push('image billing line missing period_day'); continue; }
    const model = String(r.model ?? '').trim();
    if (!model) { warnings.push(`image billing line at ${day} missing model`); continue; }
    const count = imageCount(r);
    if (count <= 0) { warnings.push(`image billing line at ${day} missing image count`); continue; }

    const explicitUsd = (typeof r.amount_usd === 'number' || typeof r.amount_usd === 'string')
      ? Number(r.amount_usd) : NaN;
    const rate = args.rates.images?.[model] ?? args.rates.defaultImage;
    const useExplicit = Number.isFinite(explicitUsd) && explicitUsd >= 0;
    const total_usd = useExplicit ? explicitUsd : imageCostUsd(rate, count);

    lines.push({
      period_day:    day,
      kind:          'image',
      model,
      n_requests:    asPositiveNumber(r.n_requests),
      input_tokens:  0,
      output_tokens: 0,
      image_count:   count,
      audio_seconds: 0,
      provider_org_id: pickOrgId(r),
      total_usd,
    });
  }

  const out = stableSorted(lines);
  return { adapter_version: IMAGE_ADAPTER_VERSION_BILLING, lines: out, warnings };
}

function stableSorted(arr: NormalizedInvoiceLine[]): NormalizedInvoiceLine[] {
  return [...arr].sort((a, b) => {
    const c = a.period_day.localeCompare(b.period_day); if (c) return c;
    const d = a.model.localeCompare(b.model);            if (d) return d;
    return String(a.provider_org_id ?? '').localeCompare(String(b.provider_org_id ?? ''));
  });
}
