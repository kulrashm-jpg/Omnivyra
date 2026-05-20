/**
 * Anthropic invoice/usage export normalizer — PURE, DETERMINISTIC.
 *
 * INTEGRITY NOTE: Anthropic has no public daily-usage JSON API equivalent
 * to OpenAI's `/v1/usage`. The adapter therefore operates against two
 * well-defined OPERATOR-SUPPLIED shapes, both deterministic and format-
 * agnostic:
 *
 *   (a) Structured billing export — `{ invoice_id, period_start, period_end,
 *       line_items: [ { period_day, model, input_tokens, output_tokens,
 *       n_requests?, amount_usd?, organization_id? } ] }`. `amount_usd` is
 *       authoritative when present (true invoice $); otherwise USD is
 *       computed deterministically from the caller-supplied rate table.
 *
 *   (b) Aggregated Messages API usage — `{ entries: [ { created_at, model,
 *       usage: { input_tokens, output_tokens }, organization_id?, workspace_id? } ] }`,
 *       which operators can produce by aggregating per-request `usage`
 *       fields returned by Anthropic's Messages API. USD computed from
 *       the caller-supplied rate table.
 *
 * Both shapes are tolerant: unknown fields ignored, missing required
 * fields → row skipped + `warnings`; never throws. The orchestrator stores
 * the raw payload verbatim in `provider_invoice_imports.raw_payload`.
 *
 * NO SPECULATIVE ATTRIBUTION: no provider-specific format invention. CSV
 * downloads, invoice PDFs, and Stripe-line-item parsing are out of scope
 * until real samples are provided.
 */

import type { NormalizedInvoiceLine, OpenAiKind, RateTable, TokenRate } from './openaiAdapter';

export const ANTHROPIC_ADAPTER_VERSION_BILLING = 'anthropic_billing_v1';
export const ANTHROPIC_ADAPTER_VERSION_USAGE   = 'anthropic_usage_v1';

export interface AnthropicNormalizeResult {
  adapter_version: string;
  lines: NormalizedInvoiceLine[];
  warnings: string[];
}

function tokenCost(rate: TokenRate | undefined, inTok: number, outTok: number): number {
  const r = rate ?? { in_per_1k: 0, out_per_1k: 0 };
  return (Math.max(0, inTok) / 1000) * r.in_per_1k + (Math.max(0, outTok) / 1000) * r.out_per_1k;
}

function dayBucketFromIso(value: unknown): string | null {
  if (typeof value === 'string' && value.length >= 10) {
    // Accepts 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SSZ', etc.
    const d = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
  return null;
}

function asPositiveNumber(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * (a) Structured billing export. `amount_usd` is authoritative when present;
 *     otherwise USD is derived from token counts × rate table.
 */
export function normalizeAnthropicBillingExport(args: {
  payload: unknown;
  rates: RateTable;
}): AnthropicNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const items = Array.isArray(env.line_items) ? env.line_items : [];

  for (const raw of items) {
    const r = raw as Record<string, unknown>;
    const day = dayBucketFromIso(r.period_day) ?? dayBucketFromIso(r.timestamp);
    if (!day) { warnings.push('billing line missing period_day/timestamp'); continue; }
    const model = String(r.model ?? '').trim();
    if (!model) { warnings.push(`billing line at ${day} missing model`); continue; }

    const inTok  = asPositiveNumber(r.input_tokens);
    const outTok = asPositiveNumber(r.output_tokens);
    const explicitUsd = typeof r.amount_usd === 'number' || typeof r.amount_usd === 'string'
      ? Number(r.amount_usd) : NaN;
    const rate = args.rates.tokens?.[model] ?? args.rates.defaultToken;
    const total_usd = Number.isFinite(explicitUsd) && explicitUsd >= 0
      ? explicitUsd
      : tokenCost(rate, inTok, outTok);

    lines.push({
      period_day:    day,
      kind:          'completion' as OpenAiKind, // Anthropic Messages API ≡ completion-style
      model,
      n_requests:    asPositiveNumber(r.n_requests),
      input_tokens:  inTok,
      output_tokens: outTok,
      image_count:   0,
      audio_seconds: 0,
      provider_org_id: typeof r.organization_id === 'string' ? r.organization_id : null,
      total_usd,
    });
  }

  return { adapter_version: ANTHROPIC_ADAPTER_VERSION_BILLING, lines, warnings };
}

/**
 * (b) Aggregated Messages API usage shape — operator-produced rollup.
 *     USD derived from rates (Messages API does not return $).
 */
export function normalizeAnthropicMessagesUsage(args: {
  payload: unknown;
  rates: RateTable;
}): AnthropicNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});
  const entries = Array.isArray(env.entries) ? env.entries : [];

  // Bucket by (day, model, org) so the downstream matcher sees aggregates.
  type Key = string;
  const bucket: Map<Key, NormalizedInvoiceLine> = new Map();

  for (const raw of entries) {
    const r = raw as Record<string, unknown>;
    const day = dayBucketFromIso(r.created_at) ?? dayBucketFromIso(r.timestamp);
    if (!day) { warnings.push('messages entry missing created_at'); continue; }
    const model = String(r.model ?? '').trim();
    if (!model) { warnings.push(`messages entry at ${day} missing model`); continue; }

    const usage = (r.usage && typeof r.usage === 'object') ? r.usage as Record<string, unknown> : {};
    const inTok  = asPositiveNumber(usage.input_tokens);
    const outTok = asPositiveNumber(usage.output_tokens);
    const orgId = typeof r.organization_id === 'string'
      ? r.organization_id
      : (typeof r.workspace_id === 'string' ? r.workspace_id : null);

    const k = `${day}|${model}|${orgId ?? ''}`;
    const existing = bucket.get(k);
    const rate = args.rates.tokens?.[model] ?? args.rates.defaultToken;
    const addUsd = tokenCost(rate, inTok, outTok);

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

  // Stable output order: (day, model, org).
  for (const line of [...bucket.values()].sort((a, b) => {
    const c = a.period_day.localeCompare(b.period_day); if (c) return c;
    const d = a.model.localeCompare(b.model);            if (d) return d;
    return String(a.provider_org_id ?? '').localeCompare(String(b.provider_org_id ?? ''));
  })) lines.push(line);

  return { adapter_version: ANTHROPIC_ADAPTER_VERSION_USAGE, lines, warnings };
}
