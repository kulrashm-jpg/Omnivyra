/**
 * OpenAI reconciliation orchestrator.
 *
 * Persists a normalized invoice + writes append-only adjustments using the
 * existing Phase-7 reconciliation schema (20260693). Pure logic lives in
 * `openaiAdapter` (normalization) and `reconciliationMatcher` (matching);
 * this module is the thin DB I/O layer.
 *
 * REPLAY SAFETY: see reconciliationPersist (shared by the five provider
 *  reconcilers): one invoice per (provider, period); a re-run of an imported
 *  invoice RESUMES from its stored line_items until its run is 'completed',
 *  and only then is it a 'duplicate'. Adjustments are append-only
 *  (immutability trigger) and inserted in one statement, at most once per run.
 *
 * Runtime status: this module is schema-correct against migrations 20260693
 * (provider_invoice_imports / cost_reconciliation_runs / adjustments) which
 * are CREATED BUT NOT APPLIED in this environment. The structural contract
 * is verified by tsc + pure-module tests; live operation requires the
 * controlled migration apply documented in Phase-7 Output I.
 */

import {
  normalizeOpenAiUsageExport,
  OPENAI_ADAPTER_VERSION,
  type NormalizeResult,
  type RateTable,
} from './openaiAdapter';
import { persistProviderReconciliation, type PersistOutcome } from './reconciliationPersist';
import { readEstimatedUsageAggregates } from './usageAggregateReader';
import type { UsageAggregate } from './reconciliationMatcher';

export interface IngestOpenAiArgs {
  providerInvoiceId: string;
  periodStart: string; // ISO
  periodEnd: string;   // ISO
  /** Raw OpenAI Usage API JSON payload. Stored verbatim in raw_payload. */
  payload: unknown;
  rates: RateTable;
}

export type IngestOutcome = PersistOutcome;

/** Estimated customer + platform spend per (org, day, model) for the window (see usageAggregateReader). */
function readUsageAggregates(periodStart: string, periodEnd: string): Promise<UsageAggregate[]> {
  return readEstimatedUsageAggregates('openai', (q) => q.eq('provider_name', 'openai'), periodStart, periodEnd);
}

export async function ingestOpenAiInvoice(args: IngestOpenAiArgs): Promise<IngestOutcome> {
  const norm: NormalizeResult = normalizeOpenAiUsageExport({ payload: args.payload, rates: args.rates });

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.periodStart, args.periodEnd);

  // 1-5) Import, run, adjustments, completion - resumable (reconciliationPersist).
  return persistProviderReconciliation({
    provider: 'openai',
    providerInvoiceId: args.providerInvoiceId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    lines: norm.lines,
    rawPayload: args.payload,
    adapterVersion: OPENAI_ADAPTER_VERSION,
    warnings: norm.warnings,
    aggregates,
  });
}
