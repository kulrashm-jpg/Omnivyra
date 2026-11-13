/**
 * Stripe reconciliation orchestrator.
 *
 * Persists a Stripe export into provider_invoice_imports (idempotent via
 * UNIQUE(provider='stripe', provider_invoice_id)), reads our internal
 * credit_purchases + payment_transactions + billing_subscriptions for the
 * same period, runs the pure stripeMatcher, and writes the resulting
 * adjustments as append-only rows in cost_reconciliation_adjustments.
 *
 * NO speculative infra-cost allocation. NO platform_cost_allocations
 * writes — that table remains a placeholder for future infra accounting
 * (separate task). This orchestrator only records financial-flow
 * reconciliation against our own ledger.
 *
 * CONCURRENCY: single writer only - see RECONCILE_SINGLE_WRITER_ASSUMPTION (runnerDispatch.ts), which this path
 * shares with the provider persist step. A scheduled caller makes both unsafe at once.
 *
 * REPLAY SAFETY:
 *   - DB-level idempotency via UNIQUE(provider='stripe', provider_invoice_id).
 *   - cost_reconciliation_runs upsert on UNIQUE(provider, period_start, period_end).
 *   - cost_reconciliation_adjustments are append-only (immutability trigger).
 *   - In-batch duplicate stripe_id collapses to a single `duplicate_event` row.
 *
 * Runtime status: schema-correct against migrations 20260664 (payment_*),
 * 20260625 (payment_provider_events), 20260693/694 (reconciliation). Those
 * are CREATED but the Phase-7 ones are NOT APPLIED in this environment.
 * Pure adapter + matcher are fully unit-test verified; live operation
 * requires the controlled apply.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import {
  normalizeStripeBalanceExport,
  normalizeStripeWebhookLog,
  STRIPE_ADAPTER_VERSION_BALANCE,
  STRIPE_ADAPTER_VERSION_WEBHOOK,
  type StripeNormalizeResult,
} from './stripeAdapter';
import {
  reconcileStripe,
  type InternalCreditPurchase,
  type InternalPaymentTransaction,
  type InternalSubscription,
  type StripeMatchResult,
} from './stripeMatcher';

export type StripePayloadKind = 'balance' | 'webhook';

export interface IngestStripeArgs {
  providerInvoiceId: string;
  periodStart: string;
  periodEnd:   string;
  kind: StripePayloadKind;
  payload: unknown;
}

export type IngestOutcome =
  | { status: 'duplicate'; provider_invoice_id: string }
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: StripeMatchResult['totals']; summary: StripeMatchResult['summary']; warnings: string[]; resumed?: boolean };

/**
 * A Stripe reconcile refusal / failure, typed (e1 2026-11-13, the owed "23505 by constraint" fix). `retryable`: running
 * the same import again can succeed (a transient read/write failure) or cannot (the data conflicts - an operator must
 * look). Never a silent 'duplicate'.
 */
export class StripeReconcileError extends Error {
  constructor(
    public readonly code:
      | 'IMPORT_FAILED' | 'IMPORT_READ_FAILED' | 'IMPORT_CONFLICT_NOT_STORED' | 'INVOICE_PERIOD_MISMATCH'
      | 'INVOICE_PAYLOAD_MISMATCH' | 'RUN_CONFLICT' | 'RUN_READ_FAILED' | 'RUN_UPSERT_FAILED'
      | 'ADJUSTMENTS_READ_FAILED' | 'ADJUSTMENTS_INSERT_FAILED' | 'RUN_COMPLETE_FAILED',
    public readonly retryable: boolean,
    message: string,
  ) {
    super(`stripe reconcile: ${message}`);
    this.name = 'StripeReconcileError';
  }
}

const UNIQUE_VIOLATION = '23505';
/** The ONLY unique rule Stripe imports can hit: 20260711 UNIQUE (provider, provider_invoice_id) (Postgres' default
 *  name). 20270217000040's one-per-period index excludes provider = 'stripe'. */
const INVOICE_UNIQUE_CONSTRAINT = 'provider_invoice_imports_provider_provider_invoice_id_key';
const sameInstant = (x: unknown, y: unknown): boolean => {
  const a = Date.parse(String(x)), b = Date.parse(String(y));
  return Number.isFinite(a) && a === b;
};
const roundCents = (n: number): number => Math.round(n * 100) / 100;

function refuse(code: StripeReconcileError['code'], retryable: boolean, message: string, extra: Record<string, unknown> = {}): never {
  logger.error('stripe_reconcile_refused', { code, retryable, message, ...extra });
  throw new StripeReconcileError(code, retryable, message);
}

async function readInternalRecords(periodStart: string, periodEnd: string): Promise<{
  creditPurchases: InternalCreditPurchase[];
  paymentTransactions: InternalPaymentTransaction[];
  subscriptions: InternalSubscription[];
}> {
  const out = {
    creditPurchases: [] as InternalCreditPurchase[],
    paymentTransactions: [] as InternalPaymentTransaction[],
    subscriptions: [] as InternalSubscription[],
  };

  const cp = await supabase
    .from('credit_purchases')
    .select('id, organization_id, provider_event_id, amount_usd, status, occurred_at, created_at')
    .gte('occurred_at', periodStart)
    .lt('occurred_at',  periodEnd);
  if (cp.error) {
    logger.warn('stripe_reconcile_credit_purchases_read_failed', { message: cp.error.message });
  } else {
    for (const r of (cp.data ?? []) as Array<Record<string, unknown>>) {
      const id = String(r.id ?? '');
      const org = String(r.organization_id ?? '');
      if (!id || !org) continue;
      out.creditPurchases.push({
        id,
        organization_id: org,
        provider_event_id: typeof r.provider_event_id === 'string' ? r.provider_event_id : null,
        amount_usd: Math.max(0, Number(r.amount_usd ?? 0) || 0),
        status: (String(r.status ?? 'pending') as InternalCreditPurchase['status']),
        occurred_at: String(r.occurred_at ?? r.created_at ?? ''),
      });
    }
  }

  const pt = await supabase
    .from('payment_transactions')
    .select('organization_id, provider, provider_transaction_id, amount, fee_amount, net_amount, status, occurred_at')
    .eq('provider', 'stripe')
    .gte('occurred_at', periodStart)
    .lt('occurred_at',  periodEnd);
  if (pt.error) {
    logger.warn('stripe_reconcile_payment_tx_read_failed', { message: pt.error.message });
  } else {
    for (const r of (pt.data ?? []) as Array<Record<string, unknown>>) {
      const tx = String(r.provider_transaction_id ?? '');
      const org = String(r.organization_id ?? '');
      if (!tx || !org) continue;
      const amount = Number(r.amount ?? 0) || 0;
      const fee    = Number(r.fee_amount ?? 0) || 0;
      const net    = Number(r.net_amount ?? amount - fee) || (amount - fee);
      out.paymentTransactions.push({
        organization_id: org,
        provider_transaction_id: tx,
        amount_usd: amount,
        fee_amount_usd: fee,
        net_amount_usd: net,
        status: (String(r.status ?? 'pending') as InternalPaymentTransaction['status']),
        occurred_at: String(r.occurred_at ?? ''),
      });
    }
  }

  const sb = await supabase
    .from('billing_subscriptions')
    .select('organization_id, provider, provider_subscription_id, status, current_period_start, current_period_end')
    .eq('provider', 'stripe');
  if (sb.error) {
    logger.warn('stripe_reconcile_subscriptions_read_failed', { message: sb.error.message });
  } else {
    for (const r of (sb.data ?? []) as Array<Record<string, unknown>>) {
      const sub = String(r.provider_subscription_id ?? '');
      const org = String(r.organization_id ?? '');
      if (!sub || !org) continue;
      out.subscriptions.push({
        organization_id: org,
        provider_subscription_id: sub,
        status: (String(r.status ?? 'active') as InternalSubscription['status']),
        current_period_start: String(r.current_period_start ?? ''),
        current_period_end:   String(r.current_period_end ?? ''),
      });
    }
  }
  return out;
}

export async function ingestStripeInvoice(args: IngestStripeArgs): Promise<IngestOutcome> {
  let norm: StripeNormalizeResult;
  if (args.kind === 'webhook') {
    norm = normalizeStripeWebhookLog({ payload: args.payload });
  } else {
    norm = normalizeStripeBalanceExport({ payload: args.payload });
  }
  const total_actual_usd = norm.events.reduce((s, e) => s + (Number.isFinite(e.net_amount_usd) ? e.net_amount_usd : 0), 0);

  // 0) The period's run, if any, must be THIS invoice's (a run without provider_invoice_id is a legacy / other run).
  const { data: prevRow, error: prevErr } = await supabase
    .from('cost_reconciliation_runs')
    .select('id, status, metadata')
    .eq('provider', 'stripe')
    .eq('period_start', args.periodStart)
    .eq('period_end', args.periodEnd)
    .maybeSingle();
  if (prevErr) refuse('RUN_READ_FAILED', true, `run read failed: ${prevErr.message}`);
  const prev = prevRow as { id: string; status: string; metadata: Record<string, unknown> | null } | null;
  if (prev && prev.metadata?.provider_invoice_id !== args.providerInvoiceId) {
    refuse('RUN_CONFLICT', false, `period ${args.periodStart}..${args.periodEnd} already has a run for invoice ${String(prev.metadata?.provider_invoice_id ?? 'unknown (legacy run)')}`);
  }

  // 1) Idempotent invoice import. A 23505 is classified by SQLSTATE (never by message text) and RESUMES only when the
  //    stored row is THIS invoice, in THIS period, with THIS total - a half-written run (import landed, run/adjustments
  //    did not) is completed, never silently reported as 'duplicate'.
  let events = norm.events;
  let resumed = false;
  const { error: insertErr } = await supabase.from('provider_invoice_imports').insert({
    provider: 'stripe',
    provider_invoice_id: args.providerInvoiceId,
    period_start: args.periodStart,
    period_end:   args.periodEnd,
    currency: 'USD',
    total_actual_usd,
    line_items: norm.events,
    raw_payload: args.payload ?? {},
    adapter_version: args.kind === 'webhook' ? STRIPE_ADAPTER_VERSION_WEBHOOK : STRIPE_ADAPTER_VERSION_BALANCE,
  } as Record<string, unknown>);
  if (insertErr) {
    if ((insertErr as { code?: string }).code !== UNIQUE_VIOLATION) {
      refuse('IMPORT_FAILED', true, `invoice import failed: ${insertErr.message}`);
    }
    const errText = `${insertErr.message ?? ''} ${(insertErr as { details?: string }).details ?? ''}`;
    const { data: stored, error: readErr } = await supabase
      .from('provider_invoice_imports')
      .select('line_items, total_actual_usd, period_start, period_end')
      .eq('provider', 'stripe')
      .eq('provider_invoice_id', args.providerInvoiceId)
      .maybeSingle();
    if (readErr) refuse('IMPORT_READ_FAILED', true, `stored import read failed: ${readErr.message}`);
    // A 23505 with no row of ours is NOT this invoice's unique rule - some other constraint refused the import.
    if (!stored) {
      refuse('IMPORT_CONFLICT_NOT_STORED', false, `import refused (23505) and invoice ${args.providerInvoiceId} is not stored`, {
        constraint_named: errText.includes(INVOICE_UNIQUE_CONSTRAINT),
      });
    }
    const st = stored as { line_items: unknown; total_actual_usd: number | string; period_start: string; period_end: string };
    if (!sameInstant(st.period_start, args.periodStart) || !sameInstant(st.period_end, args.periodEnd)) {
      refuse('INVOICE_PERIOD_MISMATCH', false, `invoice ${args.providerInvoiceId} was imported for ${st.period_start}..${st.period_end}, not ${args.periodStart}..${args.periodEnd}`);
    }
    if (roundCents(Number(st.total_actual_usd)) !== roundCents(total_actual_usd)) {
      refuse('INVOICE_PAYLOAD_MISMATCH', false, `invoice ${args.providerInvoiceId} was imported with total ${st.total_actual_usd}; this payload totals ${total_actual_usd}`);
    }
    events = (Array.isArray(st.line_items) ? st.line_items : []) as typeof norm.events; // the stored import is the truth
    resumed = true;
  }

  // From here on, `prev` (if any) is THIS invoice's run.
  if (prev && prev.status === 'completed') {
    return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
  }
  if (prev) {
    const { count, error: cntErr } = await supabase
      .from('cost_reconciliation_adjustments')
      .select('id', { count: 'exact', head: true })
      .eq('run_id', prev.id);
    if (cntErr) refuse('ADJUSTMENTS_READ_FAILED', true, `adjustments count failed: ${cntErr.message}`);
    if ((count ?? 0) > 0) {
      // A crash AFTER the adjustments insert: they and the run row describe the first match - only complete it.
      logger.warn('stripe_reconcile_resumed', { provider_invoice_id: args.providerInvoiceId, run_id: prev.id, adjustments_already: count });
      await completeStripeRun(prev.id);
      const m = (prev.metadata ?? {}) as { totals?: StripeMatchResult['totals']; summary?: StripeMatchResult['summary'] };
      return { status: 'ingested', run_id: prev.id, adjustments_written: 0, totals: m.totals as StripeMatchResult['totals'], summary: m.summary as StripeMatchResult['summary'], warnings: norm.warnings, resumed: true };
    }
  }
  if (resumed || prev) {
    logger.warn('stripe_reconcile_resumed', { provider_invoice_id: args.providerInvoiceId, run_id: prev?.id ?? null, adjustments_already: 0 });
  }

  // 2) Read internal records for the period and reconcile.
  const internal = await readInternalRecords(args.periodStart, args.periodEnd);
  const match = reconcileStripe({
    events,
    creditPurchases:     internal.creditPurchases,
    paymentTransactions: internal.paymentTransactions,
    subscriptions:       internal.subscriptions,
  });

  const { data: runRow, error: runErr } = await supabase
    .from('cost_reconciliation_runs')
    .upsert(
      {
        provider: 'stripe',
        period_start: args.periodStart,
        period_end:   args.periodEnd,
        estimated_usd_sum: match.totals.internal_gross_sum,
        actual_usd_sum:    match.totals.stripe_gross_sum,
        // 'running' until the adjustments are in (a crash in between is resumed, never reported as done)
        status: 'running',
        started_at:  new Date().toISOString(),
        finished_at: null,
        metadata: {
          provider_invoice_id: args.providerInvoiceId,
          adapter_version: norm.adapter_version,
          warnings: norm.warnings,
          totals:  match.totals,
          summary: match.summary,
        },
      } as Record<string, unknown>,
      { onConflict: 'provider,period_start,period_end' },
    )
    .select('id')
    .single();
  if (runErr || !runRow) refuse('RUN_UPSERT_FAILED', true, `run upsert failed: ${runErr?.message ?? 'no row'}`);
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
    if (adjErr) refuse('ADJUSTMENTS_INSERT_FAILED', true, `adjustments insert failed: ${adjErr.message}`);
    adjustments_written = rows.length;
  }
  await completeStripeRun(run_id);

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, summary: match.summary, warnings: norm.warnings, resumed };
}

async function completeStripeRun(runId: string): Promise<void> {
  const { data, error } = await supabase
    .from('cost_reconciliation_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString() })
    .eq('id', runId)
    .select('id');
  if (error || !Array.isArray(data) || data.length !== 1) {
    refuse('RUN_COMPLETE_FAILED', true, `run ${runId} not marked completed: ${error?.message ?? `matched ${Array.isArray(data) ? data.length : 'no'} rows`}`);
  }
}
