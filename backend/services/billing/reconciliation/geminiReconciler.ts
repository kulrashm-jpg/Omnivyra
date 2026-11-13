/**
 * Gemini reconciliation orchestrator — mirrors OpenAI/Anthropic.
 * Uses the generic `reconcileProviderInvoice` and the Phase-7 schema; pure
 * normalizer lives in `geminiAdapter`. Schema-correct against migrations
 * 20260693/694 (created, NOT applied); pure modules are unit-test-verified.
 *
 *
 * REPLAY SAFETY: see reconciliationPersist (shared by the five provider
 *  reconcilers): one invoice per (provider, period); a re-run of an imported
 *  invoice RESUMES from its stored line_items until its run is 'completed',
 *  and only then is it a 'duplicate'. Adjustments are append-only
 *  (immutability trigger) and inserted in one statement, at most once per run.
 */

import {
  normalizeGoogleCloudBillingExport,
  normalizeGeminiUsageMetadata,
  GEMINI_ADAPTER_VERSION_BILLING,
  GEMINI_ADAPTER_VERSION_USAGE,
  type GeminiNormalizeResult,
} from './geminiAdapter';
import type { RateTable } from './openaiAdapter';
import { persistProviderReconciliation, type PersistOutcome } from './reconciliationPersist';
import { readEstimatedUsageAggregates } from './usageAggregateReader';
import type { UsageAggregate } from './reconciliationMatcher';

export type GeminiPayloadKind = 'gcb_export' | 'usage_metadata';

export interface IngestGeminiArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  kind: GeminiPayloadKind;
  payload: unknown;
  /** Required only for kind='usage_metadata' (Gemini API returns no $). */
  rates?: RateTable;
  /** Optional GCB project_id → customer org_id mapping (no DB I/O here). */
  projectOrgMap?: Record<string, string>;
}

export type IngestOutcome = PersistOutcome;

function readUsageAggregates(periodStart: string, periodEnd: string): Promise<UsageAggregate[]> {
  return readEstimatedUsageAggregates('gemini', (q) => q.eq('provider_name', 'gemini'), periodStart, periodEnd);
}

export async function ingestGeminiInvoice(args: IngestGeminiArgs): Promise<IngestOutcome> {
  let norm: GeminiNormalizeResult;
  if (args.kind === 'gcb_export') {
    norm = normalizeGoogleCloudBillingExport({ payload: args.payload, projectOrgMap: args.projectOrgMap });
  } else {
    if (!args.rates) throw new Error('rates required for gemini usage_metadata ingestion');
    norm = normalizeGeminiUsageMetadata({ payload: args.payload, rates: args.rates });
  }

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.periodStart, args.periodEnd);

  // 1-5) Import, run, adjustments, completion - resumable (reconciliationPersist).
  return persistProviderReconciliation({
    provider: 'gemini',
    providerInvoiceId: args.providerInvoiceId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    lines: norm.lines,
    rawPayload: args.payload,
    adapterVersion: args.kind === 'gcb_export' ? GEMINI_ADAPTER_VERSION_BILLING : GEMINI_ADAPTER_VERSION_USAGE,
    warnings: norm.warnings,
    aggregates,
  });
}
