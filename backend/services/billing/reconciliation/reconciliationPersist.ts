/**
 * The persist step shared by the five provider reconcilers (openai, anthropic,
 * gemini, audio, image): invoice import -> run -> adjustments -> completion.
 * stripeReconciler is deliberately NOT routed here (e1: customer-payment
 * reconciliation is reviewed separately).
 *
 * WHY. Each reconciler used to commit the invoice import FIRST and then upsert
 * the run and insert the adjustments. If either later step failed, the retry
 * hit the import's UNIQUE(provider, provider_invoice_id) and returned
 * 'duplicate', so that invoice NEVER got its run or adjustments: a permanent,
 * silent gap. The duplicate test also matched the message text 'duplicate'
 * rather than SQLSTATE 23505.
 *
 * NOW.
 *   1. One invoice per (provider, period). A different provider_invoice_id for
 *      an already-imported period is REFUSED: the matcher compares an invoice
 *      against the WHOLE period's estimate, so two invoices for one period
 *      would each be matched against it and double-count the variance (and the
 *      run, unique per period, would have its totals overwritten). A split
 *      invoice or credit note is merged into one manifest by the operator.
 *      (A DB unique index on (provider, period_start, period_end) follows in its
 *      own migration; this code does not depend on it.)
 *   2. Import. 23505 (by code) means this invoice was imported before -> RESUME.
 *   3. Run upserted as 'running', carrying provider_invoice_id and a snapshot of
 *      the estimates it was matched against (sum, count, sha256).
 *   4. Adjustments: ONE insert statement (atomic). On resume, a run that already
 *      has adjustments is not inserted into again.
 *   5. Run marked 'completed'. Only a completed run makes a retry a 'duplicate'.
 *
 * RESUME uses the STORED line_items (never the new payload), refuses when the
 * new payload's total differs from the stored one (rounded like the matcher),
 * and logs the first attempt's estimate snapshot next to the new one: late
 * usage is legitimate, so a different estimate is reported, not refused.
 */

import { createHash } from 'crypto';
import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import type { NormalizedInvoiceLine } from './openaiAdapter';
import { reconcileProviderInvoice, roundCents, type MatchResult, type UsageAggregate } from './reconciliationMatcher';

export interface PersistArgs {
  /** Provider tag stored on the import, the run and every adjustment. */
  provider: string;
  providerInvoiceId: string;
  periodStart: string;
  periodEnd: string;
  lines: NormalizedInvoiceLine[];
  rawPayload: unknown;
  adapterVersion: string;
  warnings: string[];
  /** Estimates read BEFORE this call (usageAggregateReader). */
  aggregates: UsageAggregate[];
}

export type PersistOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: MatchResult['totals']; warnings: string[]; resumed: boolean };

const UNIQUE_VIOLATION = '23505';

function fail(provider: string, event: string, message: string, extra: Record<string, unknown> = {}): never {
  logger.error(event, { provider, message, ...extra });
  throw new Error(`${provider} reconcile: ${message}`);
}

function totalOf(lines: NormalizedInvoiceLine[]): number {
  return lines.reduce((s, l) => s + (Number.isFinite(l.total_usd) ? l.total_usd : 0), 0);
}

/** Snapshot of the estimates a run was matched against (e1: make a resumed run's drift visible). */
export function estimateSnapshot(aggregates: UsageAggregate[]): { estimated_usd_sum: number; aggregate_count: number; sha256: string } {
  const canon = aggregates
    .map((a) => [a.organization_id ?? '', a.period_day, a.model, roundCents(a.estimated_usd)].join('|'))
    .sort()
    .join('\n');
  return {
    estimated_usd_sum: roundCents(aggregates.reduce((s, a) => s + a.estimated_usd, 0)),
    aggregate_count: aggregates.length,
    sha256: createHash('sha256').update(canon).digest('hex'),
  };
}

async function refuseOtherInvoiceForPeriod(a: PersistArgs): Promise<void> {
  const { data, error } = await supabase
    .from('provider_invoice_imports')
    .select('provider_invoice_id')
    .eq('provider', a.provider)
    .eq('period_start', a.periodStart)
    .eq('period_end', a.periodEnd);
  if (error) fail(a.provider, 'reconcile_period_check_failed', `period check failed: ${error.message}`);
  if (!Array.isArray(data)) fail(a.provider, 'reconcile_period_check_failed', 'period check returned no answer');
  const others = (data as Array<{ provider_invoice_id: string }>).map((r) => r.provider_invoice_id).filter((id) => id !== a.providerInvoiceId);
  if (others.length > 0) {
    fail(a.provider, 'reconcile_period_has_other_invoice',
      `period ${a.periodStart}..${a.periodEnd} is already reconciled by invoice ${others.join(', ')}; merge into one manifest`,
      { provider_invoice_id: a.providerInvoiceId, existing: others });
  }
}

export async function persistProviderReconciliation(a: PersistArgs): Promise<PersistOutcome> {
  await refuseOtherInvoiceForPeriod(a);

  // 2) Import (immutable). 23505 -> this invoice was imported before: resume.
  let lines = a.lines;
  let resumed = false;
  const total_actual_usd = totalOf(a.lines);
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: a.provider,
    provider_invoice_id: a.providerInvoiceId,
    period_start: a.periodStart,
    period_end: a.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: a.lines,
    raw_payload: a.rawPayload ?? {},
    adapter_version: a.adapterVersion,
  } as Record<string, unknown>);
  if (insertErr) {
    if ((insertErr as { code?: string }).code !== UNIQUE_VIOLATION) {
      fail(a.provider, 'reconcile_invoice_import_failed', `invoice import failed: ${insertErr.message}`);
    }
    const { data: stored, error: readErr } = await supabase
      .from('provider_invoice_imports')
      .select('line_items, total_actual_usd, period_start, period_end')
      .eq('provider', a.provider)
      .eq('provider_invoice_id', a.providerInvoiceId)
      .maybeSingle();
    if (readErr) fail(a.provider, 'reconcile_import_read_failed', `stored import read failed: ${readErr.message}`);
    // 23505 without our own row: another invoice holds this period (the unique index won a race).
    if (!stored) fail(a.provider, 'reconcile_period_has_other_invoice', `import refused (23505) and invoice ${a.providerInvoiceId} is not stored: the period belongs to another invoice`);
    const s = stored as { line_items: NormalizedInvoiceLine[]; total_actual_usd: number | string };
    if (roundCents(Number(s.total_actual_usd)) !== roundCents(total_actual_usd)) {
      fail(a.provider, 'reconcile_invoice_payload_mismatch',
        `invoice ${a.providerInvoiceId} was imported with total ${s.total_actual_usd}; this payload totals ${total_actual_usd}`);
    }
    lines = Array.isArray(s.line_items) ? s.line_items : [];
    resumed = true;
  }

  // Existing run for the period (unique per provider+period).
  const { data: existing, error: runReadErr } = await supabase
    .from('cost_reconciliation_runs')
    .select('id, status, metadata')
    .eq('provider', a.provider)
    .eq('period_start', a.periodStart)
    .eq('period_end', a.periodEnd)
    .maybeSingle();
  if (runReadErr) fail(a.provider, 'reconcile_run_read_failed', `run read failed: ${runReadErr.message}`);
  const prev = existing as { id: string; status: string; metadata: Record<string, unknown> | null } | null;
  // A run with no import of THIS invoice belongs to another one: never adopt it.
  if (prev && (!resumed || prev.metadata?.provider_invoice_id !== a.providerInvoiceId)) {
    fail(a.provider, 'reconcile_run_conflict', `period already has a run for invoice ${String(prev.metadata?.provider_invoice_id ?? 'unknown')}`);
  }
  if (prev && prev.status === 'completed') {
    return { status: 'duplicate', provider_invoice_id: a.providerInvoiceId };
  }

  const match = reconcileProviderInvoice({ provider: a.provider, invoiceLines: lines, usageAggregates: a.aggregates });
  const estimates = estimateSnapshot(a.aggregates);
  const firstEstimates = (prev?.metadata?.estimates_first ?? prev?.metadata?.estimates ?? null) as ReturnType<typeof estimateSnapshot> | null;
  if (resumed) {
    logger.warn('reconcile_resumed', {
      provider: a.provider, provider_invoice_id: a.providerInvoiceId, run_status: prev?.status ?? 'none',
      estimates_first: firstEstimates, estimates_now: estimates,
      estimate_changed: firstEstimates !== null && firstEstimates.sha256 !== estimates.sha256,
    });
  }

  // 3) Run as 'running'.
  const now = new Date().toISOString();
  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: a.provider,
        period_start: a.periodStart,
        period_end: a.periodEnd,
        estimated_usd_sum: match.totals.estimated_usd_sum,
        actual_usd_sum: match.totals.actual_usd_sum,
        status: 'running',
        started_at: now,
        finished_at: null,
        metadata: {
          adapter_version: a.adapterVersion, warnings: a.warnings, buckets: match.buckets,
          provider_invoice_id: a.providerInvoiceId, estimates, estimates_first: firstEstimates ?? estimates,
        },
      } as Record<string, unknown>,
      { onConflict: 'provider,period_start,period_end' },
    )
    .select('id')
    .single();
  if (runErr || !runRow) fail(a.provider, 'reconcile_run_upsert_failed', `run upsert failed: ${runErr?.message ?? 'no row'}`);
  const run_id = String((runRow as { id: string }).id);

  // 4) Adjustments: one INSERT statement (all or nothing). A resumed run that
  //    already has them (a crash after the insert) is only completed.
  let already = 0;
  if (prev) {
    const { count, error: cntErr } = await supabase
      .from('cost_reconciliation_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', run_id);
    if (cntErr) fail(a.provider, 'reconcile_adjustment_count_failed', `adjustment count failed: ${cntErr.message}`);
    // A null count with a null error is NOT "zero rows" - refuse rather than double-insert.
    if (typeof count !== 'number') fail(a.provider, 'reconcile_adjustment_count_failed', 'adjustment count returned no answer');
    already = count;
  }
  const rows = match.adjustments.map((adj) => ({
    run_id,
    organization_id: adj.organization_id,
    provider: adj.provider,
    action_key: adj.action_key,
    ledger_hold_transaction_id: adj.ledger_hold_transaction_id,
    estimated_usd: adj.estimated_usd,
    actual_usd: adj.actual_usd,
    reason: adj.reason,
    metadata: { ...adj.metadata, severity: adj.severity },
  }));
  let adjustments_written = 0;
  if (already === 0 && rows.length > 0) {
    const { error: adjErr } = await supabase.from('cost_reconciliation_adjustments').insert(rows);
    if (adjErr) fail(a.provider, 'reconcile_adjustments_insert_failed', `adjustments insert failed: ${adjErr.message}`);
    adjustments_written = rows.length;
  }

  // 5) Completed: only now does a retry become a 'duplicate'.
  const { data: done, error: doneErr } = await supabase
    .from('cost_reconciliation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', run_id)
    .select('id');
  if (doneErr) fail(a.provider, 'reconcile_run_complete_failed', `run completion failed: ${doneErr.message}`);
  if (!Array.isArray(done) || done.length !== 1) fail(a.provider, 'reconcile_run_complete_failed', `run completion matched ${Array.isArray(done) ? done.length : 'no answer'} rows`);

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: a.warnings, resumed };
}
