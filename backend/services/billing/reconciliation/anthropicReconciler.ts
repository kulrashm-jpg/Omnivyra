/**
 * Anthropic reconciliation orchestrator. Mirrors the OpenAI orchestrator
 * (same Phase-7 schema, same matcher core via reconcileProviderInvoice).
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
  normalizeAnthropicBillingExport,
  normalizeAnthropicMessagesUsage,
  ANTHROPIC_ADAPTER_VERSION_BILLING,
  ANTHROPIC_ADAPTER_VERSION_USAGE,
  type AnthropicNormalizeResult,
} from './anthropicAdapter';
import type { RateTable } from './openaiAdapter';
import { persistProviderReconciliation, type PersistOutcome } from './reconciliationPersist';
import { readEstimatedUsageAggregates } from './usageAggregateReader';
import type { UsageAggregate } from './reconciliationMatcher';

export type AnthropicPayloadKind = 'billing' | 'messages_usage';

export interface IngestAnthropicArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  /** Which shape the payload follows. Determines normalizer + adapter_version. */
  kind: AnthropicPayloadKind;
  payload: unknown;
  rates: RateTable;
}

export type IngestOutcome = PersistOutcome;

function readUsageAggregates(periodStart: string, periodEnd: string): Promise<UsageAggregate[]> {
  return readEstimatedUsageAggregates('anthropic', (q) => q.eq('provider_name', 'anthropic'), periodStart, periodEnd);
}

export async function ingestAnthropicInvoice(args: IngestAnthropicArgs): Promise<IngestOutcome> {
  const norm: AnthropicNormalizeResult = args.kind === 'billing'
    ? normalizeAnthropicBillingExport({ payload: args.payload, rates: args.rates })
    : normalizeAnthropicMessagesUsage({ payload: args.payload, rates: args.rates });

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.periodStart, args.periodEnd);

  // 1-5) Import, run, adjustments, completion - resumable (reconciliationPersist).
  return persistProviderReconciliation({
    provider: 'anthropic',
    providerInvoiceId: args.providerInvoiceId,
    periodStart: args.periodStart,
    periodEnd: args.periodEnd,
    lines: norm.lines,
    rawPayload: args.payload,
    adapterVersion: args.kind === 'billing' ? ANTHROPIC_ADAPTER_VERSION_BILLING : ANTHROPIC_ADAPTER_VERSION_USAGE,
    warnings: norm.warnings,
    aggregates,
  });
}
