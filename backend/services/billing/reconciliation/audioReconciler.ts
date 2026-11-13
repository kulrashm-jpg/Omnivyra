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
 * REPLAY SAFETY: see reconciliationPersist (shared by the five provider
 *  reconcilers): one invoice per (provider, period); a re-run of an imported
 *  invoice RESUMES from its stored line_items until its run is 'completed',
 *  and only then is it a 'duplicate'. Adjustments are append-only
 *  (immutability trigger) and inserted in one statement, at most once per run.
 *
 * Runtime status: schema-correct against migrations 20260693/694 which are
 * CREATED BUT NOT APPLIED in this environment. Pure normalizer + matcher
 * fully unit-tested; live operation requires the controlled apply.
 */

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
import { persistProviderReconciliation, type PersistOutcome } from './reconciliationPersist';
import { readEstimatedUsageAggregates, type UsageFilter } from './usageAggregateReader';
import type { UsageAggregate } from './reconciliationMatcher';

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

export type IngestOutcome = PersistOutcome;

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

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.providerTag, args.periodStart, args.periodEnd);

  // 1-5) Import, run, adjustments, completion - resumable (reconciliationPersist).
  return persistProviderReconciliation({
    provider: args.providerTag,
    providerInvoiceId: args.providerInvoiceId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    lines: norm.lines,
    rawPayload: args.payload,
    adapterVersion: adapterVersionFor(args.kind),
    warnings: norm.warnings,
    aggregates,
  });
}
