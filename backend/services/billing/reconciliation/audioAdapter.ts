/**
 * Audio provider invoice/usage normalizer — PURE, DETERMINISTIC.
 *
 * Targets the three well-defined operator-supplied shapes for audio /
 * transcription providers (Whisper-class and AssemblyAI). NEVER throws on a
 * malformed row — skips and reports it in `warnings` so the orchestrator can
 * record a meaningful adjustment/anomaly. NO speculative attribution.
 *
 *   (A) Whisper-style usage export (audio-only) — same row schema OpenAI's
 *       `/v1/usage` returns under `whisper_api_data`, but submitted as a
 *       standalone payload `{ whisper_api_data: [{ timestamp, model_id,
 *       num_seconds, num_requests, organization_id? }] }`. Authoritative USD
 *       computed from caller-supplied rate table (Whisper is per-minute).
 *
 *   (B) AssemblyAI usage export — documented per-call shape rolled up by the
 *       operator: `{ entries: [{ date|created_at, model?, seconds|minutes?,
 *       hours?, n_requests?, organization_id?|workspace_id?|account_id?,
 *       amount_usd? }] }`. AssemblyAI surfaces invoiced $; when `amount_usd`
 *       is present we treat it as authoritative, otherwise USD is computed
 *       deterministically from rates × duration.
 *
 *   (C) Generic audio billing export — provider-agnostic dollar-denominated
 *       lines for cases where the operator has the raw invoice $ already
 *       split per (day, model, org): `{ line_items: [{ period_day, model,
 *       audio_seconds|audio_minutes|duration_ms, n_requests?, amount_usd?,
 *       organization_id?|workspace_id? }] }`. `amount_usd` authoritative when
 *       present; otherwise derived from rates × duration.
 *
 * USD model: AudioRate is `{ per_minute: number }` — same shape OpenAI's
 * existing `static_estimate_v1` Whisper rate uses. Per-second / per-minute /
 * per-hour caller inputs are all converted to seconds internally; the rate
 * is applied as `(seconds/60) * per_minute`. Caller decides which rate
 * source to pass; this module does NOT read DB.
 *
 * The orchestrator stores the raw payload verbatim in
 * `provider_invoice_imports.raw_payload`.
 */

import type { NormalizedInvoiceLine, OpenAiKind, AudioRate, RateTable } from './openaiAdapter';

export const AUDIO_ADAPTER_VERSION_BILLING    = 'audio_billing_v1';
export const AUDIO_ADAPTER_VERSION_WHISPER    = 'audio_whisper_v1';
export const AUDIO_ADAPTER_VERSION_ASSEMBLYAI = 'audio_assemblyai_v1';

export interface AudioNormalizeResult {
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

/** Convert any of seconds/minutes/hours/duration_ms to seconds. Caller-input
 *  precedence is explicit so mixed-shape exports are deterministic. */
function durationSeconds(row: Record<string, unknown>): number {
  if (row.audio_seconds != null) return asPositiveNumber(row.audio_seconds);
  if (row.seconds      != null) return asPositiveNumber(row.seconds);
  if (row.num_seconds  != null) return asPositiveNumber(row.num_seconds);
  if (row.audio_minutes!= null) return asPositiveNumber(row.audio_minutes) * 60;
  if (row.minutes      != null) return asPositiveNumber(row.minutes)       * 60;
  if (row.hours        != null) return asPositiveNumber(row.hours)         * 3600;
  if (row.duration_ms  != null) return asPositiveNumber(row.duration_ms)   / 1000;
  return 0;
}

function audioCostUsd(rate: AudioRate | undefined, seconds: number): number {
  const r = rate ?? { per_minute: 0 };
  return (Math.max(0, seconds) / 60) * (r.per_minute ?? 0);
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

/** (A) Whisper-style standalone audio export. */
export function normalizeWhisperUsageExport(args: {
  payload: unknown;
  rates: RateTable;
}): AudioNormalizeResult {
  const warnings: string[] = [];
  const lines: NormalizedInvoiceLine[] = [];
  const env = (args.payload && typeof args.payload === 'object'
    ? args.payload as Record<string, unknown>
    : {});

  type Key = string;
  const bucket: Map<Key, NormalizedInvoiceLine> = new Map();

  const rows = Array.isArray(env.whisper_api_data) ? env.whisper_api_data
             : (Array.isArray(env.data)             ? env.data
             : (Array.isArray(args.payload)         ? (args.payload as unknown[])
             : []));

  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const day = dayBucketFromValue(row.timestamp) ?? dayBucketFromValue(row.created_at);
    if (!day) { warnings.push('whisper row missing timestamp'); continue; }
    const model = String(row.model_id ?? row.model ?? 'whisper-1').trim() || 'whisper-1';
    const seconds = durationSeconds(row);
    if (seconds <= 0) { warnings.push(`whisper row at ${day} missing duration`); continue; }
    const orgId = pickOrgId(row);
    const n_requests = asPositiveNumber(row.num_requests ?? row.n_requests);

    const k = `${day}|${model}|${orgId ?? ''}`;
    const rate = args.rates.audio?.[model] ?? args.rates.defaultAudio;
    const addUsd = audioCostUsd(rate, seconds);
    const existing = bucket.get(k);
    if (existing) {
      existing.n_requests    += n_requests || 1;
      existing.audio_seconds += seconds;
      existing.total_usd     += addUsd;
    } else {
      bucket.set(k, {
        period_day:    day,
        kind:          'transcription' as OpenAiKind,
        model,
        n_requests:    n_requests || 1,
        input_tokens:  0,
        output_tokens: 0,
        image_count:   0,
        audio_seconds: seconds,
        provider_org_id: orgId,
        total_usd:     addUsd,
      });
    }
  }

  for (const line of stableSorted([...bucket.values()])) lines.push(line);
  return { adapter_version: AUDIO_ADAPTER_VERSION_WHISPER, lines, warnings };
}

/** (B) AssemblyAI operator-aggregated usage rollup. */
export function normalizeAssemblyAiUsageExport(args: {
  payload: unknown;
  rates: RateTable;
}): AudioNormalizeResult {
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
    const day = dayBucketFromValue(r.date) ?? dayBucketFromValue(r.created_at) ?? dayBucketFromValue(r.timestamp);
    if (!day) { warnings.push('assemblyai entry missing date'); continue; }
    const model = String(r.model ?? r.tier ?? 'assemblyai-transcript').trim() || 'assemblyai-transcript';
    const seconds = durationSeconds(r);
    if (seconds <= 0) { warnings.push(`assemblyai entry at ${day} missing duration`); continue; }

    const orgId = pickOrgId(r);
    const n_requests = asPositiveNumber(r.n_requests ?? r.num_requests ?? r.count);

    const explicitUsd = (typeof r.amount_usd === 'number' || typeof r.amount_usd === 'string')
      ? Number(r.amount_usd) : NaN;
    const rate = args.rates.audio?.[model] ?? args.rates.defaultAudio;
    const computedUsd = audioCostUsd(rate, seconds);
    const useExplicit = Number.isFinite(explicitUsd) && explicitUsd >= 0;
    const addUsd = useExplicit ? explicitUsd : computedUsd;

    const k = `${day}|${model}|${orgId ?? ''}`;
    const existing = bucket.get(k);
    if (existing) {
      existing.n_requests    += n_requests || 1;
      existing.audio_seconds += seconds;
      existing.total_usd     += addUsd;
    } else {
      bucket.set(k, {
        period_day:    day,
        kind:          'transcription',
        model,
        n_requests:    n_requests || 1,
        input_tokens:  0,
        output_tokens: 0,
        image_count:   0,
        audio_seconds: seconds,
        provider_org_id: orgId,
        total_usd:     addUsd,
      });
    }
  }

  for (const line of stableSorted([...bucket.values()])) lines.push(line);
  return { adapter_version: AUDIO_ADAPTER_VERSION_ASSEMBLYAI, lines, warnings };
}

/** (C) Generic audio billing export — provider-agnostic dollar-denominated. */
export function normalizeAudioBillingExport(args: {
  payload: unknown;
  rates: RateTable;
}): AudioNormalizeResult {
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
    if (!day) { warnings.push('audio billing line missing period_day'); continue; }
    const model = String(r.model ?? '').trim();
    if (!model) { warnings.push(`audio billing line at ${day} missing model`); continue; }

    const seconds = durationSeconds(r);
    if (seconds <= 0) { warnings.push(`audio billing line at ${day} missing duration`); continue; }

    const explicitUsd = (typeof r.amount_usd === 'number' || typeof r.amount_usd === 'string')
      ? Number(r.amount_usd) : NaN;
    const rate = args.rates.audio?.[model] ?? args.rates.defaultAudio;
    const useExplicit = Number.isFinite(explicitUsd) && explicitUsd >= 0;
    const total_usd = useExplicit ? explicitUsd : audioCostUsd(rate, seconds);

    lines.push({
      period_day:    day,
      kind:          'transcription',
      model,
      n_requests:    asPositiveNumber(r.n_requests),
      input_tokens:  0,
      output_tokens: 0,
      image_count:   0,
      audio_seconds: seconds,
      provider_org_id: pickOrgId(r),
      total_usd,
    });
  }

  // Deterministic shape regardless of caller input order.
  const out = stableSorted(lines);
  return { adapter_version: AUDIO_ADAPTER_VERSION_BILLING, lines: out, warnings };
}

function stableSorted(arr: NormalizedInvoiceLine[]): NormalizedInvoiceLine[] {
  return [...arr].sort((a, b) => {
    const c = a.period_day.localeCompare(b.period_day); if (c) return c;
    const d = a.model.localeCompare(b.model);            if (d) return d;
    return String(a.provider_org_id ?? '').localeCompare(String(b.provider_org_id ?? ''));
  });
}
