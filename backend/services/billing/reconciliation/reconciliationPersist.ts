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
 *      an already-imported OVERLAPPING period ([start, end) half-open) is REFUSED: the matcher compares an invoice
 *      against the WHOLE period's estimate, so two invoices for one period
 *      would each be matched against it and double-count the variance (and the
 *      run, unique per period, would have its totals overwritten). A split
 *      invoice or credit note is merged into one manifest by the operator.
 *      The DB holds the same rule ATOMICALLY: 20270217000040's exclusion constraint
 *      provider_invoice_imports_no_overlap (btree_gist; e9 ruling) - this check
 *      only refuses early with a clear message, before anything is stored.
 *      A run for the period that belongs to another invoice (or a legacy run
 *      with no provider_invoice_id) is refused here too - BEFORE the import, so
 *      a refused invoice is never stored.
 *   2. Import. 23505 means THIS invoice (provider, provider_invoice_id) was imported before -> RESUME;
 *      23P01 naming provider_invoice_imports_no_overlap means ANOTHER invoice holds an overlapping period -> refuse;
 *      23514 (provider_invoice_imports_period_nonempty) means an empty / inverted period -> refuse.
 *   3. Run upserted as 'running', carrying provider_invoice_id and a snapshot of
 *      the estimates it was matched against (sum, count, sha256).
 *   ATOMIC in the DB (e9 ruling, 040 rework): two concurrent runs with overlapping periods can both pass the app
 *      check (1), but only one insert survives the exclusion constraint; the other gets 23P01 and is refused in (2).
 *      (05's question: the earlier absence of this constraint was not deliberate - btree_gist was not installed.)
 *   4. Adjustments: ONE insert statement (atomic). On resume, a run that already
 *      has adjustments is ONLY completed: its totals, buckets and estimates
 *      still describe those adjustments, so they are not rewritten.
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
const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';
/**
 * provider_invoice_imports' rules (20270217000040, rework): UNIQUE (provider, provider_invoice_id) -> 23505 = the SAME
 * invoice imported before -> resume; the EXCLUSION constraint provider_invoice_imports_no_overlap -> 23P01 = ANOTHER
 * invoice holds an overlapping period -> refuse; the CHECK provider_invoice_imports_period_nonempty -> 23514.
 * SQLSTATE classifies the class; the constraint NAME (PostgREST puts it in message / details) identifies the rule -
 * a 23P01 / 23514 from any OTHER constraint is not ours and fails as an import error. As a second line of defence the
 * resume path still requires the stored row to be THIS invoice in THIS period.
 */
const PERIOD_EXCLUSION = 'provider_invoice_imports_no_overlap';
const PERIOD_CHECK = 'provider_invoice_imports_period_nonempty';
const sameInstant = (x: unknown, y: unknown): boolean => {
  const a = Date.parse(String(x)), b = Date.parse(String(y));
  return Number.isFinite(a) && a === b;
};

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

/**
 * Refuses when ANY other invoice of this provider covers a period that OVERLAPS this one (e1): identical bounds,
 * a split window inside it, or bounds shifted by a timezone offset all double-count the overlap. Half-open
 * [start, end), as the estimate reader uses (gte / lt): periods that merely TOUCH (one ends where the next starts)
 * do not overlap and are allowed. The DB enforces the same rule atomically (20270217000040's exclusion constraint,
 * half-open too); this read only refuses EARLY, with the other invoice's id, before anything is stored.
 */
async function refuseOtherInvoiceForPeriod(a: PersistArgs): Promise<void> {
  const { data, error } = await supabase
    .from('provider_invoice_imports')
    .select('provider_invoice_id, period_start, period_end')
    .eq('provider', a.provider)
    .lt('period_start', a.periodEnd)
    .gt('period_end', a.periodStart);
  if (error) fail(a.provider, 'reconcile_period_check_failed', `period check failed: ${error.message}`);
  if (!Array.isArray(data)) fail(a.provider, 'reconcile_period_check_failed', 'period check returned no answer');
  const others = (data as Array<{ provider_invoice_id: string }>).map((r) => r.provider_invoice_id).filter((id) => id !== a.providerInvoiceId);
  if (others.length > 0) {
    fail(a.provider, 'reconcile_period_has_other_invoice',
      `period ${a.periodStart}..${a.periodEnd} overlaps the period of invoice ${others.join(', ')}, already reconciled; merge into one manifest`,
      { provider_invoice_id: a.providerInvoiceId, existing: others });
  }
}

type RunRow = {
  id: string; status: string; metadata: Record<string, unknown> | null;
  estimated_usd_sum: number | string | null; actual_usd_sum: number | string | null;
};

async function readRunForPeriod(a: PersistArgs): Promise<RunRow | null> {
  const { data, error } = await supabase
    .from('cost_reconciliation_runs')
    .select('id, status, metadata, estimated_usd_sum, actual_usd_sum')
    .eq('provider', a.provider)
    .eq('period_start', a.periodStart)
    .eq('period_end', a.periodEnd)
    .maybeSingle();
  if (error) fail(a.provider, 'reconcile_run_read_failed', `run read failed: ${error.message}`);
  return (data as RunRow | null) ?? null;
}

async function countAdjustments(a: PersistArgs, runId: string): Promise<number> {
  const { count, error } = await supabase
    .from('cost_reconciliation_adjustments')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId);
  if (error) fail(a.provider, 'reconcile_adjustment_count_failed', `adjustment count failed: ${error.message}`);
  // A null count with a null error is NOT "zero rows" - refuse rather than double-insert.
  if (typeof count !== 'number') fail(a.provider, 'reconcile_adjustment_count_failed', 'adjustment count returned no answer');
  return count;
}

async function completeRun(a: PersistArgs, runId: string): Promise<void> {
  const { data, error } = await supabase
    .from('cost_reconciliation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', runId)
    .select('id');
  if (error) fail(a.provider, 'reconcile_run_complete_failed', `run completion failed: ${error.message}`);
  if (!Array.isArray(data) || data.length !== 1) fail(a.provider, 'reconcile_run_complete_failed', `run completion matched ${Array.isArray(data) ? data.length : 'no answer'} rows`);
}

export async function persistProviderReconciliation(a: PersistArgs): Promise<PersistOutcome> {
  // 1) Refusals that must happen BEFORE the import is committed - otherwise the
  //    invoice would be stored, every retry would resume into the same refusal,
  //    and it would never be reconciled (e1). (a) another invoice is imported for
  //    the period; (b) the period's run belongs to another invoice - a legacy run
  //    without provider_invoice_id counts as another invoice.
  await refuseOtherInvoiceForPeriod(a);
  const prev = await readRunForPeriod(a);
  if (prev && prev.metadata?.provider_invoice_id !== a.providerInvoiceId) {
    fail(a.provider, 'reconcile_run_conflict', `period already has a run for invoice ${String(prev.metadata?.provider_invoice_id ?? 'unknown (legacy run)')}`);
  }

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
    const code = (insertErr as { code?: string }).code;
    const errText = `${insertErr.message ?? ''} ${(insertErr as { details?: string }).details ?? ''}`;
    if (code === EXCLUSION_VIOLATION && errText.includes(PERIOD_EXCLUSION)) {
      fail(a.provider, 'reconcile_period_has_other_invoice',
        `import refused by ${PERIOD_EXCLUSION}: the period ${a.periodStart}..${a.periodEnd} overlaps a period that already belongs to another invoice`);
    }
    if (code === CHECK_VIOLATION && errText.includes(PERIOD_CHECK)) {
      fail(a.provider, 'reconcile_invoice_period_invalid',
        `import refused by ${PERIOD_CHECK}: the period ${a.periodStart}..${a.periodEnd} is empty or inverted`);
    }
    if (code !== UNIQUE_VIOLATION) {
      fail(a.provider, 'reconcile_invoice_import_failed', `invoice import failed (${code ?? 'no code'}): ${insertErr.message}`);
    }
    const { data: stored, error: readErr } = await supabase
      .from('provider_invoice_imports')
      .select('line_items, total_actual_usd, period_start, period_end')
      .eq('provider', a.provider)
      .eq('provider_invoice_id', a.providerInvoiceId)
      .maybeSingle();
    if (readErr) fail(a.provider, 'reconcile_import_read_failed', `stored import read failed: ${readErr.message}`);
    // 23505 without our own row cannot come from UNIQUE (provider, provider_invoice_id) - refuse rather than guess.
    if (!stored) fail(a.provider, 'reconcile_import_conflict_unexplained', `import refused (23505) and invoice ${a.providerInvoiceId} is not stored`);
    const s = stored as { line_items: NormalizedInvoiceLine[]; total_actual_usd: number | string; period_start: string; period_end: string };
    // The same invoice id stored for ANOTHER period must never be resumed into this one.
    if (!sameInstant(s.period_start, a.periodStart) || !sameInstant(s.period_end, a.periodEnd)) {
      fail(a.provider, 'reconcile_invoice_period_mismatch',
        `invoice ${a.providerInvoiceId} was imported for ${s.period_start}..${s.period_end}, not ${a.periodStart}..${a.periodEnd}`);
    }
    if (roundCents(Number(s.total_actual_usd)) !== roundCents(total_actual_usd)) {
      fail(a.provider, 'reconcile_invoice_payload_mismatch',
        `invoice ${a.providerInvoiceId} was imported with total ${s.total_actual_usd}; this payload totals ${total_actual_usd}`);
    }
    lines = Array.isArray(s.line_items) ? s.line_items : [];
    resumed = true;
  }

  // From here on, `prev` (if any) is THIS invoice's run.
  if (prev && prev.status === 'completed') {
    return { status: 'duplicate', provider_invoice_id: a.providerInvoiceId };
  }

  const estimates = estimateSnapshot(a.aggregates);
  const firstEstimates = (prev?.metadata?.estimates_first ?? prev?.metadata?.estimates ?? null) as ReturnType<typeof estimateSnapshot> | null;
  const already = prev ? await countAdjustments(a, prev.id) : 0;
  if (resumed || prev) {
    logger.warn('reconcile_resumed', {
      provider: a.provider, provider_invoice_id: a.providerInvoiceId, run_status: prev?.status ?? 'none',
      adjustments_already: already, estimates_first: firstEstimates, estimates_now: estimates,
      estimate_changed: firstEstimates !== null && firstEstimates.sha256 !== estimates.sha256,
    });
  }

  if (prev && already > 0) {
    // A crash AFTER the adjustments insert. The stored adjustments came from the
    // first match, and the run row still describes exactly that match: do NOT
    // rewrite its totals, buckets or estimates from a re-read - only complete it (e1).
    await completeRun(a, prev.id);
    return {
      status: 'ingested', run_id: prev.id, adjustments_written: 0, warnings: a.warnings, resumed: true,
      totals: { estimated_usd_sum: Number(prev.estimated_usd_sum ?? 0), actual_usd_sum: Number(prev.actual_usd_sum ?? 0) },
    };
  }

  const match = reconcileProviderInvoice({ provider: a.provider, invoiceLines: lines, usageAggregates: a.aggregates });

  // 3) Run as 'running' (no adjustments exist for it yet, so its totals are this match's).
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
        started_at: new Date().toISOString(),
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

  // 4) Adjustments: one INSERT statement (all or nothing); the run has none yet (counted above).
  //    Single writer for a RESUME of the same invoice: see RECONCILE_SINGLE_WRITER_ASSUMPTION
  //    (backend/services/billing/reconciliation/runnerDispatch.ts, e1) - recorded ONCE for this path and the Stripe
  //    path. (040's exclusion constraint makes the period rule atomic; concurrent resumes of ONE invoice are still
  //    governed by that assumption.)
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
  if (rows.length > 0) {
    const { error: adjErr } = await supabase.from('cost_reconciliation_adjustments').insert(rows);
    if (adjErr) fail(a.provider, 'reconcile_adjustments_insert_failed', `adjustments insert failed: ${adjErr.message}`);
    adjustments_written = rows.length;
  }

  // 5) Completed: only now does a retry become a 'duplicate'.
  await completeRun(a, run_id);

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, warnings: a.warnings, resumed };
}
