/**
 * Anthropic reconciliation orchestrator. Mirrors the OpenAI orchestrator
 * (same Phase-7 schema, same matcher core via reconcileProviderInvoice).
 *
 * REPLAY SAFETY:
 *  - DB-level idempotency via UNIQUE(provider='anthropic', provider_invoice_id).
 *  - cost_reconciliation_runs upsert on UNIQUE(provider, period_start, period_end).
 *  - cost_reconciliation_adjustments are append-only (immutability trigger).
 *  - Duplicate invoice → short-circuits before any adjustment is written.
 *
 * Runtime status: schema-correct against migrations 20260693/694 which are
 * CREATED BUT NOT APPLIED in this environment. Pure normalizer + matcher
 * fully unit-tested; live operation requires the controlled apply.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import {
  normalizeAnthropicBillingExport,
  normalizeAnthropicMessagesUsage,
  ANTHROPIC_ADAPTER_VERSION_BILLING,
  ANTHROPIC_ADAPTER_VERSION_USAGE,
  type AnthropicNormalizeResult,
} from './anthropicAdapter';
import type { RateTable } from './openaiAdapter';
import { readEstimatedUsageAggregates } from './usageAggregateReader';
import { reconcileProviderInvoice, type UsageAggregate, type MatchResult } from './reconciliationMatcher';

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

export type IngestOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: MatchResult['totals']; warnings: string[] };

function readUsageAggregates(periodStart: string, periodEnd: string): Promise<UsageAggregate[]> {
  return readEstimatedUsageAggregates('anthropic', (q) => q.eq('provider_name', 'anthropic'), periodStart, periodEnd);
}

export async function ingestAnthropicInvoice(args: IngestAnthropicArgs): Promise<IngestOutcome> {
  const norm: AnthropicNormalizeResult = args.kind === 'billing'
    ? normalizeAnthropicBillingExport({ payload: args.payload, rates: args.rates })
    : normalizeAnthropicMessagesUsage({ payload: args.payload, rates: args.rates });
  const total_actual_usd = norm.lines.reduce((s, l) => s + (Number.isFinite(l.total_usd) ? l.total_usd : 0), 0);

  // 0) Read the estimates FIRST: the read fails closed (throws), and nothing has
  //    been written yet, so a failed read leaves the invoice importable on retry.
  const aggregates = await readUsageAggregates(args.periodStart, args.periodEnd);

  // 1) Idempotent invoice import.
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: 'anthropic',
    provider_invoice_id: args.providerInvoiceId,
    period_start: args.periodStart,
    period_end:   args.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: norm.lines,
    raw_payload: args.payload ?? {},
    adapter_version: args.kind === 'billing' ? ANTHROPIC_ADAPTER_VERSION_BILLING : ANTHROPIC_ADAPTER_VERSION_USAGE,
  } as Record<string, unknown>);
  if (insertErr) {
    if (String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
      return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
    }
    logger.warn('anthropic_invoice_import_failed', { message: insertErr.message });
    throw new Error(`anthropic invoice import failed: ${insertErr.message}`);
  }

  // 2) Reconcile against our customer + platform estimates (usageAggregateReader).
  const match = reconcileProviderInvoice({ provider: 'anthropic', invoiceLines: norm.lines, usageAggregates: aggregates });

  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: 'anthropic',
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
    logger.warn('anthropic_reconcile_run_upsert_failed', { message: runErr?.message });
    throw new Error(`anthropic reconcile run upsert failed: ${runErr?.message ?? 'no row'}`);
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
      logger.warn('anthropic_reconcile_adjustments_insert_failed', { message: adjErr.message });
      throw new Error(`anthropic reconcile adjustments insert failed: ${adjErr.message}`);
    }
    adjustments_written = rows.length;
  }

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: norm.warnings };
}
