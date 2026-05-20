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
  | { status: 'ingested'; run_id: string; adjustments_written: number; totals: StripeMatchResult['totals']; summary: StripeMatchResult['summary']; warnings: string[] };

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

  // 1) Idempotent invoice import.
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
    if (String(insertErr.message ?? '').toLowerCase().includes('duplicate')) {
      return { status: 'duplicate', provider_invoice_id: args.providerInvoiceId };
    }
    logger.warn('stripe_invoice_import_failed', { message: insertErr.message });
    throw new Error(`stripe invoice import failed: ${insertErr.message}`);
  }

  // 2) Read internal records for the period and reconcile.
  const internal = await readInternalRecords(args.periodStart, args.periodEnd);
  const match = reconcileStripe({
    events: norm.events,
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
        status: 'completed',
        started_at:  new Date().toISOString(),
        finished_at: new Date().toISOString(),
        metadata: {
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
  if (runErr || !runRow) {
    logger.warn('stripe_reconcile_run_upsert_failed', { message: runErr?.message });
    throw new Error(`stripe reconcile run upsert failed: ${runErr?.message ?? 'no row'}`);
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
      logger.warn('stripe_reconcile_adjustments_insert_failed', { message: adjErr.message });
      throw new Error(`stripe reconcile adjustments insert failed: ${adjErr.message}`);
    }
    adjustments_written = rows.length;
  }

  return { status: 'ingested', run_id, adjustments_written, totals: match.totals, summary: match.summary, warnings: norm.warnings };
}
