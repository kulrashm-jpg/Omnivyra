/**
 * Audio reconciliation orchestrator (Whisper / AssemblyAI / audio billing).
 * Mirrors OpenAI/Anthropic/Gemini orchestrators and reuses the generic
 * `reconcileProviderInvoice` matcher core.
 *
 * Per-provider usage_events filtering:
 *   - providerTag='openai_audio'  → usage_events.provider_name='openai'
 *                                   AND model_name LIKE 'whisper%'
 *   - providerTag='assemblyai'    → usage_events.provider_name='assemblyai'
 *
 * The matcher key is (period_day, model), so the audio path will not collide
 * with the existing OpenAI completion reconciler — each Whisper model
 * (`whisper-1`, etc.) lives in its own bucket.
 *
 * REPLAY SAFETY:
 *   - DB-level idempotency via UNIQUE(provider=<providerTag>, provider_invoice_id).
 *   - cost_reconciliation_runs upsert on UNIQUE(provider, period_start, period_end).
 *   - cost_reconciliation_adjustments are append-only (immutability trigger).
 *   - Duplicate invoice short-circuits before any adjustment is written.
 *
 * Runtime status: schema-correct against migrations 20260693/694 which are
 * CREATED BUT NOT APPLIED in this environment. Pure normalizer + matcher
 * fully unit-tested; live operation requires the controlled apply.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import {
  normalizeAudioBillingExport,
  normalizeWhisperUsageExport,
  normalizeAssemblyAiUsageExport,
  AUDIO_ADAPTER_VERSION_BILLING,
  AUDIO_ADAPTER_VERSION_WHISPER,
  AUDIO_ADAPTER_VERSION_ASSEMBLYAI,
  type AudioNormalizeResult,
} from './audioAdapter';
import type { RateTable } from './openaiAdapter';
import { readEstimatedUsageAggregates, type UsageFilter } from './usageAggregateReader';
import { reconcileProviderInvoice, type UsageAggregate, type MatchResult } from './reconciliationMatcher';

export type AudioProviderTag = 'openai_audio' | 'assemblyai';
export type AudioPayloadKind = 'billing' | 'whisper_usage' | 'assemblyai_usage';

export interface IngestAudioArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  /** Provider tag persisted into provider_invoice_imports / adjustments. */
  providerTag: AudioProviderTag;
  kind: AudioPayloadKind;
  payload: unknown;
  rates: RateTable;
}

export type IngestOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: MatchResult['totals']; warnings: string[] };

function readUsageAggregates(
  providerTag: AudioProviderTag,
  periodStart: string,
  periodEnd: string,
): Promise<UsageAggregate[]> {
  const filter: UsageFilter = providerTag === 'openai_audio'
    ? (q) => q.eq('provider_name', 'openai').like('model_name', 'whisper%')
    : (q) => q.eq('provider_name', 'assemblyai');
  return readEstimatedUsageAggregates(providerTag, filter, periodStart, periodEnd);
}

function adapterVersionFor(kind: AudioPayloadKind): string {
  if (kind === 'whisper_usage')    return AUDIO_ADAPTER_VERSION_WHISPER;
  if (kind === 'assemblyai_usage') return AUDIO_ADAPTER_VERSION_ASSEMBLYAI;
  return AUDIO_ADAPTER_VERSION_BILLING;
}

export async function ingestAudioInvoice(args: IngestAudioArgs): Promise<IngestOutcome> {
  let norm: AudioNormalizeResult;
  if (args.kind === 'whisper_usage') {
    norm = normalizeWhisperUsageExport({ payload: args.payload, rates: args.rates });
  } else if (args.kind === 'assemblyai_usage') {
    norm = normalizeAssemblyAiUsageExport({ payload: args.payload, rates: args.rates });
  } else {
    norm = normalizeAudioBillingExport({ payload: args.payload, rates: args.rates });
  }
  const total_actual_usd = norm.lines.reduce((s, l) => s + (Number.isFinite(l.total_usd) ? l.total_usd : 0), 0);

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.providerTag, args.periodStart, args.periodEnd);

  // 1) Idempotent invoice import.
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: args.providerTag,
    provider_invoice_id: args.providerInvoiceId,
    period_start: args.periodStart,
    period_end:   args.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: norm.lines,
    raw_payload: args.payload ?? {},
    adapter_version: adapterVersionFor(args.kind),
  } as Record<string, unknown>);
  if (insertErr) {
    if (String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
      return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
    }
    logger.warn('audio_invoice_import_failed', { message: insertErr.message, providerTag: args.providerTag });
    throw new Error(`audio invoice import failed: ${insertErr.message}`);
  }

  // 2) Reconcile against our customer + platform estimates (usageAggregateReader).
  const match = reconcileProviderInvoice({ provider: args.providerTag, invoiceLines: norm.lines, usageAggregates: aggregates });

  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: args.providerTag,
        period_start: args.periodStart,
        period_end:   args.periodEnd,
        estimated_usd_sum: match.totals.estimated_usd_sum,
        actual_usd_sum:    match.totals.actual_usd_sum,
        status: 'completed',
        started_at:  new Date().toISOString(),
        finished_at: new Date().toISOString(),
        metadata: { adapter_version: norm.adapter_version, warnings: norm.warnings, buckets: match.buckets },
      } as Record<string, unknown>,
      { onConflict: 'provider,period_start,period_end' },
    )
    .select('id')
    .single();
  if (runErr || !runRow) {
    logger.warn('audio_reconcile_run_upsert_failed', { message: runErr?.message, providerTag: args.providerTag });
    throw new Error(`audio reconcile run upsert failed: ${runErr?.message ?? 'no row'}`);
  }
  const run_id = String((runRow as { id: string }).id);

  // 3) Append-only adjustments.
  const rows = match.adjustments.map((a) => ({
    run_id,
    organization_id: a.organization_id,
    provider: a.provider,
    action_key: a.action_key,
    ledger_hold_transaction_id: a.ledger_hold_transaction_id,
    estimated_usd: a.estimated_usd,
    actual_usd:    a.actual_usd,
    reason: a.reason,
    metadata: { ...a.metadata, severity: a.severity },
  }));
  let adjustments_written = 0;
  if (rows.length > 0) {
    const { error: adjErr } = await supabase.from('cost_reconciliation_adjustments').insert(rows);
    if (adjErr) {
      logger.warn('audio_reconcile_adjustments_insert_failed', { message: adjErr.message, providerTag: args.providerTag });
      throw new Error(`audio reconcile adjustments insert failed: ${adjErr.message}`);
    }
    adjustments_written = rows.length;
  }

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: norm.warnings };
}
