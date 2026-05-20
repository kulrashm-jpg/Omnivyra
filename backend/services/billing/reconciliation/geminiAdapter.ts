/**
 * Gemini invoice/usage export normalizer — PURE, DETERMINISTIC.
 *
 * Two well-defined ingestion shapes (no format invention):
 *
 *   (A) Google Cloud Billing export — the documented BigQuery export schema
 *       (one JSON row per usage line: `service`, `sku`, `usage_start_time`,
 *       `project`, `labels`, `usage`, `cost`, `currency`, `invoice`, etc.).
 *       `cost` is AUTHORITATIVE USD when present. Caller passes the array
 *       of rows; we filter to Gemini (service.description matches
 *       'Generative Language API' OR sku.description contains 'Gemini').
 *
 *   (B) Gemini Messages `usageMetadata` aggregation — operator-produced
 *       rollup of per-request `usageMetadata`:
 *         { entries: [ { created_at, model, usageMetadata:
 *           { promptTokenCount, candidatesTokenCount, totalTokenCount? },
 *           organization_id|workspace_id|project_id? } ] }
 *       USD is computed deterministically from the caller-supplied rate
 *       table (the Gemini API does not return $).
 *
 * Both shapes are tolerant: missing required fields → row skipped + warning,
 * never throws. The orchestrator stores the raw payload verbatim in
 * `provider_invoice_imports.raw_payload`.
 *
 * INTEGRITY NOTE: Gemini visibility-probe usage_events currently lack
 * organization attribution (Phase 4.1 Task 2 spec'd but deferred). When no
 * customer-attributed Gemini usage exists, reconciliation correctly emits
 * `missing_attribution` platform-level adjustments — by design, not a bug.
 */

import type { NormalizedInvoiceLine, OpenAiKind, RateTable, TokenRate } from './openaiAdapter';

export const GEMINI_ADAPTER_VERSION_BILLING = 'gemini_billing_v1';
export const GEMINI_ADAPTER_VERSION_USAGE   = 'gemini_usage_v1';

export interface GeminiNormalizeResult {
  adapter_version: string;
  lines: NormalizedInvoiceLine[];
  warnings: string[];
}

function tokenCost(rate: TokenRate | undefined, inTok: number, outTok: number): number {
  const r = rate ?? { in_per_1k: 0, out_per_1k: 0 };
  return (Math.max(0, inTok) / 1000) * r.in_per_1k + (Math.max(0, outTok) / 1000) * r.out_per_1k;
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

/** Looks for a `model` value across the GCB row's various label arrays. */
function extractModelFromGcbRow(row: Record<string, unknown>): string | null {
  const skuDesc = String((row.sku as Record<string, unknown> | undefined)?.description ?? '').toLowerCase();
  // Heuristic: Gemini SKUs include the model name (e.g. "Gemini 1.5 Flash Input Token").
  // Extract a normalized model token if recognizable; else fall back to the full sku desc.
  const knownModels = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro', 'gemini-1.0-ultra'];
  for (const m of knownModels) {
    const friendly = m.replace(/-/g, ' ').replace('gemini', 'gemini'); // 'gemini 1.5 flash'
    if (skuDesc.includes(friendly)) return m;
  }
  // Try the labels array — many billing exports carry { key: 'model', value: ... }.
  const labels = Array.isArray(row.labels) ? row.labels : [];
  for (const l of labels) {
    const lab = l as Record<string, unknown>;
    const k = String(lab.key ?? '').toLowerCase();
    if (k === 'model' || k === 'gemini_model' || k === 'api_model') {
      const v = String(lab.value ?? '').trim().toLowerCase();
      if (v) return v;
    }
  }
  // Last-resort tag so the bucket isn't lost: use a service-level label.
  if (skuDesc) return `gemini:${skuDesc.slice(0, 48)}`;
  return null;
}

function isInputTokenSku(skuDesc: string): boolean {
  return /input/i.test(skuDesc);
}
function isOutputTokenSku(skuDesc: string): boolean {
  return /output|candidates/i.test(skuDesc);
}

/** (A) Google Cloud Billing export rows → normalized lines (Gemini filter). */
export function normalizeGoogleCloudBillingExport(args: {
  payload: unknown;
  /** Optional: a project_id → our-customer org_id mapping. Used ONLY when
   *  the caller supplies it; the adapter does no DB I/O and never invents
   *  attribution. */
  projectOrgMap?: Record<string, string>;
}): GeminiNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const rows = Array.isArray(env.rows)
    ? env.rows
    : (Array.isArray(args.payload) ? (args.payload as unknown[]) : []);

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const service = (row.service as Record<string, unknown> | undefined) ?? {};
    const sku     = (row.sku as Record<string, unknown> | undefined) ?? {};
    const serviceDesc = String(service.description ?? '');
    const skuDesc     = String(sku.description ?? '');

    // Gemini filter — match the public Google service description.
    const isGemini =
      /generative language/i.test(serviceDesc) ||
      /gemini/i.test(skuDesc) ||
      /generativelanguage\.googleapis\.com/i.test(String(service.id ?? ''));
    if (!isGemini) continue;

    const day = dayBucketFromValue(row.usage_start_time)
            ?? dayBucketFromValue(row.export_time);
    if (!day) { warnings.push('gcb row missing usage_start_time'); continue; }

    const model = extractModelFromGcbRow(row);
    if (!model) { warnings.push(`gcb row at ${day} missing recognizable model/sku`); continue; }

    const cost = Number(row.cost ?? 0);
    if (!Number.isFinite(cost) || cost < 0) {
      warnings.push(`gcb row at ${day} invalid cost`);
      continue;
    }

    const usage  = (row.usage as Record<string, unknown> | undefined) ?? {};
    const amount = asPositiveNumber(usage.amount);
    const inTok  = isInputTokenSku(skuDesc)  ? amount : 0;
    const outTok = isOutputTokenSku(skuDesc) ? amount : 0;

    const projectId = String(((row.project as Record<string, unknown> | undefined)?.id ?? '')) || null;
    const mappedOrg = projectId && args.projectOrgMap ? args.projectOrgMap[projectId] ?? null : null;

    lines.push({
      period_day:    day,
      kind:          'completion' as OpenAiKind,
      model,
      n_requests:    0, // Not present in GCB export rows.
      input_tokens:  inTok,
      output_tokens: outTok,
      image_count:   0,
      audio_seconds: 0,
      // provider_org_id captures the GCB project (NOT our customer org). The
      // optional mapping is treated as customer attribution only when the
      // caller explicitly supplies projectOrgMap.
      provider_org_id: mappedOrg ?? projectId,
      total_usd: cost,
    });
  }

  return { adapter_version: GEMINI_ADAPTER_VERSION_BILLING, lines, warnings };
}

/** (B) Operator-aggregated Gemini `usageMetadata` rollup. */
export function normalizeGeminiUsageMetadata(args: {
  payload: unknown;
  rates: RateTable;
}): GeminiNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const entries = Array.isArray(env.entries) ? env.entries : [];

  type Key = string;
  const bucket: Map<Key, NormalizedInvoiceLine> = new Map();

  for (const raw of entries) {
    const r = raw as Record<string, unknown>;
    const day = dayBucketFromValue(r.created_at) ?? dayBucketFromValue(r.timestamp);
    if (!day) { warnings.push('gemini entry missing created_at'); continue; }
    const model = String(r.model ?? '').trim();
    if (!model) { warnings.push(`gemini entry at ${day} missing model`); continue; }

    const meta = (r.usageMetadata && typeof r.usageMetadata === 'object')
      ? r.usageMetadata as Record<string, unknown>
      : {};
    const inTok  = asPositiveNumber(meta.promptTokenCount);
    const outTok = asPositiveNumber(meta.candidatesTokenCount);
    const orgId = typeof r.organization_id === 'string' ? r.organization_id
      : typeof r.workspace_id === 'string' ? r.workspace_id
      : typeof r.project_id   === 'string' ? r.project_id
      : null;

    const k = `${day}|${model}|${orgId ?? ''}`;
    const rate = args.rates.tokens?.[model] ?? args.rates.defaultToken;
    const addUsd = tokenCost(rate, inTok, outTok);
    const existing = bucket.get(k);
    if (existing) {
      existing.n_requests    += 1;
      existing.input_tokens  += inTok;
      existing.output_tokens += outTok;
      existing.total_usd     += addUsd;
    } else {
      bucket.set(k, {
        period_day:    day,
        kind:          'completion',
        model,
        n_requests:    1,
        input_tokens:  inTok,
        output_tokens: outTok,
        image_count:   0,
        audio_seconds: 0,
        provider_org_id: orgId,
        total_usd:     addUsd,
      });
    }
  }

  for (const line of [...bucket.values()].sort((a, b) => {
    const c = a.period_day.localeCompare(b.period_day); if (c) return c;
    const d = a.model.localeCompare(b.model);            if (d) return d;
    return String(a.provider_org_id ?? '').localeCompare(String(b.provider_org_id ?? ''));
  })) lines.push(line);

  return { adapter_version: GEMINI_ADAPTER_VERSION_USAGE, lines, warnings };
}
