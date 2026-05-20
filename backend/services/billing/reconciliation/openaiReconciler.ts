/**
 * OpenAI reconciliation orchestrator.
 *
 * Persists a normalized invoice + writes append-only adjustments using the
 * existing Phase-7 reconciliation schema (20260693). Pure logic lives in
 * `openaiAdapter` (normalization) and `reconciliationMatcher` (matching);
 * this module is the thin DB I/O layer.
 *
 * REPLAY SAFETY:
 *  - Invoice import is idempotent at the DB layer via UNIQUE(provider,
 *    provider_invoice_id) — duplicate import is a no-op insert error caught
 *    and ignored; the same `provider_invoice_id` cannot be ingested twice.
 *  - Reconciliation run row is idempotent via UNIQUE(provider, period_start,
 *    period_end) — re-running for the same period returns the existing row.
 *  - Adjustments are append-only (immutability trigger blocks UPDATE/DELETE).
 *    Re-running with the same inputs produces additional rows ONLY if the
 *    orchestrator is called again with the same invoice; callers are expected
 *    to gate by invoice-id (the invoice import idempotency surface) — if the
 *    invoice import is a duplicate, the orchestrator short-circuits before
 *    writing any adjustments.
 *
 * Runtime status: this module is schema-correct against migrations 20260693
 * (provider_invoice_imports / cost_reconciliation_runs / adjustments) which
 * are CREATED BUT NOT APPLIED in this environment. The structural contract
 * is verified by tsc + pure-module tests; live operation requires the
 * controlled migration apply documented in Phase-7 Output I.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import {
  normalizeOpenAiUsageExport,
  OPENAI_ADAPTER_VERSION,
  type NormalizeResult,
  type RateTable,
} from './openaiAdapter';
import { reconcileOpenAi, type UsageAggregate, type MatchResult } from './reconciliationMatcher';

export interface IngestOpenAiArgs {
  providerInvoiceId: string;
  periodStart: string; // ISO
  periodEnd: string;   // ISO
  /** Raw OpenAI Usage API JSON payload. Stored verbatim in raw_payload. */
  payload: unknown;
  rates: RateTable;
}

export type IngestOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: MatchResult['totals']; warnings: string[] };

/** Read customer-attributed estimated cost per (org, day, model) for the window. */
async function readUsageAggregates(periodStart: string, periodEnd: string): Promise<UsageAggregate[]> {
  // Conservative deterministic aggregation — we read the rows and group in JS
  // to avoid any DB feature drift; volumes per (provider, day, model) are
  // bounded by org × model × days so this is fine for a daily reconciliation.
  const { data, error } = await supabase
    .from('usage_events')
    .select('organization_id, model_name, total_cost_usd, created_at, ledger_hold_transaction_id')
    .eq('provider_name', 'openai')
    .gte('created_at', periodStart)
    .lt('created_at', periodEnd);
  if (error) {
    logger.warn('openai_reconcile_usage_read_failed', { message: error.message });
    return [];
  }
  const map: Map<string, UsageAggregate> = new Map();
  for (const r of (data || []) as Array<Record<string, unknown>>) {
    const org   = String(r.organization_id ?? '');
    const model = String(r.model_name ?? '').trim();
    const ts    = String(r.created_at ?? '');
    if (!org || !model || !ts) continue;
    const day = ts.slice(0, 10); // YYYY-MM-DD
    const key = `${org}|${day}|${model}`;
    const usd = Math.max(0, Number(r.total_cost_usd ?? 0) || 0);
    const ledgerAnchor = (r.ledger_hold_transaction_id as string | null) ?? null;
    const slot = map.get(key);
    if (!slot) {
      map.set(key, { organization_id: org, period_day: day, model, estimated_usd: usd, ledger_hold_transaction_id: ledgerAnchor });
    } else {
      slot.estimated_usd += usd;
      // Prefer the first-seen anchor for determinism (matcher will re-sort).
      slot.ledger_hold_transaction_id = slot.ledger_hold_transaction_id ?? ledgerAnchor;
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const c = a.organization_id.localeCompare(b.organization_id); if (c) return c;
    const d = a.period_day.localeCompare(b.period_day);            if (d) return d;
    return a.model.localeCompare(b.model);
  });
}

export async function ingestOpenAiInvoice(args: IngestOpenAiArgs): Promise<IngestOutcome> {
  const norm: NormalizeResult = normalizeOpenAiUsageExport({ payload: args.payload, rates: args.rates });
  const total_actual_usd = norm.lines.reduce((s, l) => s + (Number.isFinite(l.total_usd) ? l.total_usd : 0), 0);

  // 1) Idempotent invoice import (UNIQUE on (provider, provider_invoice_id)).
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: 'openai',
    provider_invoice_id: args.providerInvoiceId,
    period_start: args.periodStart,
    period_end:   args.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: norm.lines,
    raw_payload: args.payload ?? {},
    adapter_version: OPENAI_ADAPTER_VERSION,
  } as Record<string, unknown>);
  if (insertErr) {
    if (String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
      return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
    }
    logger.warn('openai_invoice_import_failed', { message: insertErr.message });
    throw new Error(`openai invoice import failed: ${insertErr.message}`);
  }

  // 2) Upsert reconciliation run for the period.
  const aggregates = await readUsageAggregates(args.periodStart, args.periodEnd);
  const match = reconcileOpenAi({ provider: 'openai', invoiceLines: norm.lines, usageAggregates: aggregates });

  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: 'openai',
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
    logger.warn('openai_reconcile_run_upsert_failed', { message: runErr?.message });
    throw new Error(`openai reconcile run upsert failed: ${runErr?.message ?? 'no row'}`);
  }
  const run_id = String((runRow as { id: string }).id);

  // 3) Append-only adjustments. The immutability trigger ensures no row can
  // be updated; we don't pre-clean — if the orchestrator is called twice for
  // the same invoice the import step short-circuits before we get here.
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
      logger.warn('openai_reconcile_adjustments_insert_failed', { message: adjErr.message });
      throw new Error(`openai reconcile adjustments insert failed: ${adjErr.message}`);
    }
    adjustments_written = rows.length;
  }

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: norm.warnings };
}
