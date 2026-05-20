/**
 * Stripe ↔ internal credit-ledger matcher — PURE, DETERMINISTIC.
 *
 * Reconciles normalized Stripe events against caller-supplied internal
 * records (credit_purchases and payment_transactions). Unlike the provider
 * matcher (`reconcileProviderInvoice`), Stripe events match by stable IDs
 * (charge / payment_intent / invoice / subscription) rather than by
 * (period_day, model), so this is a separate kernel.
 *
 * MATCH PRECEDENCE for a Stripe event → internal purchase/payment record:
 *   1. credit_purchases.provider_event_id  ==  stripe_id           (exact)
 *   2. payment_transactions.provider_transaction_id == stripe_id   (exact)
 *   3. payment_transactions.provider_transaction_id == payment_intent_id
 *   4. credit_purchases.provider_event_id            == payment_intent_id
 *   5. (subscription event) billing_subscriptions.provider_subscription_id == subscription_id
 *
 * If no match is found, the event is reported as `missing_attribution`
 * (Stripe billed us but we have no internal record).
 *
 * If we have an internal record with no matching Stripe event, the
 * counterpart is reported as `missing_provider_event` (internal grant
 * with no corresponding Stripe payment).
 *
 * VARIANCE: when matched, we emit one row per event with:
 *   - estimated_usd = internal gross
 *   - actual_usd    = stripe gross
 *   - reason ∈ {'rounding','variance','fee_variance','net_variance','refund_recorded',
 *               'dispute_recorded','subscription_event'}
 *
 * Replay-safe: identical inputs → identical outputs (deterministic
 * iteration order). The orchestrator persists each adjustment row via
 * `cost_reconciliation_adjustments` (append-only).
 */

import { computeReconciliationVariance, type ReconciliationSeverity } from '../reconciliationVariance';
import type { StripeNormalizedEvent } from './stripeAdapter';

export interface InternalCreditPurchase {
  id: string;
  organization_id: string;
  provider_event_id: string | null; // e.g. 'ch_xxx' or 'pi_xxx'
  amount_usd: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  occurred_at: string; // ISO
}

export interface InternalPaymentTransaction {
  organization_id: string;
  provider_transaction_id: string;   // e.g. 'ch_xxx' or 'pi_xxx'
  amount_usd: number;                // gross
  fee_amount_usd: number;
  net_amount_usd: number;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed';
  occurred_at: string; // ISO
}

export interface InternalSubscription {
  organization_id: string;
  provider_subscription_id: string;  // 'sub_xxx'
  status: 'trialing'|'active'|'past_due'|'paused'|'canceled'|'expired';
  current_period_start: string;
  current_period_end:   string;
}

export type StripeAdjustmentReason =
  | 'rounding'
  | 'variance'
  | 'fee_variance'
  | 'net_variance'
  | 'refund_recorded'
  | 'dispute_recorded'
  | 'subscription_event'
  | 'missing_attribution'
  | 'missing_provider_event'
  | 'duplicate_event';

export interface StripeAdjustmentRow {
  organization_id: string | null;
  provider: 'stripe';
  action_key: string | null;
  ledger_hold_transaction_id: string | null;
  estimated_usd: number;
  actual_usd: number;
  adjustment_usd: number;
  reason: StripeAdjustmentReason;
  severity: ReconciliationSeverity;
  metadata: Record<string, unknown>;
}

export interface StripeMatchResult {
  adjustments: StripeAdjustmentRow[];
  totals: {
    stripe_gross_sum: number;
    stripe_fee_sum: number;
    stripe_net_sum: number;
    stripe_refund_sum: number;
    stripe_dispute_sum: number;
    /** Internal credit-purchase gross sum, matched OR unmatched. */
    internal_gross_sum: number;
  };
  summary: {
    matched_count: number;
    unmatched_stripe_count: number;
    unmatched_internal_count: number;
    duplicate_event_count: number;
    refund_count: number;
    dispute_count: number;
    subscription_event_count: number;
  };
}

function roundCents(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}

export function reconcileStripe(args: {
  events: StripeNormalizedEvent[];
  creditPurchases?: InternalCreditPurchase[];
  paymentTransactions?: InternalPaymentTransaction[];
  subscriptions?: InternalSubscription[];
}): StripeMatchResult {
  const events = [...args.events];
  const creditPurchases = args.creditPurchases ?? [];
  const paymentTransactions = args.paymentTransactions ?? [];
  const subscriptions = args.subscriptions ?? [];

  // Pre-index internal records for O(1) lookup.
  const purchasesByEventId: Map<string, InternalCreditPurchase> = new Map();
  for (const p of creditPurchases) {
    if (p.provider_event_id) purchasesByEventId.set(p.provider_event_id, p);
  }
  const paymentsByTxId: Map<string, InternalPaymentTransaction> = new Map();
  for (const pt of paymentTransactions) {
    if (pt.provider_transaction_id) paymentsByTxId.set(pt.provider_transaction_id, pt);
  }
  const subsBySubId: Map<string, InternalSubscription> = new Map();
  for (const s of subscriptions) {
    if (s.provider_subscription_id) subsBySubId.set(s.provider_subscription_id, s);
  }

  // Track which internal records we matched so the leftover set surfaces
  // as `missing_provider_event` deterministically.
  const matchedPurchaseIds: Set<string> = new Set();
  const matchedPaymentTxIds: Set<string> = new Set();

  const adjustments: StripeAdjustmentRow[] = [];
  const totals = {
    stripe_gross_sum: 0,
    stripe_fee_sum: 0,
    stripe_net_sum: 0,
    stripe_refund_sum: 0,
    stripe_dispute_sum: 0,
    internal_gross_sum: 0,
  };
  const summary = {
    matched_count: 0,
    unmatched_stripe_count: 0,
    unmatched_internal_count: 0,
    duplicate_event_count: 0,
    refund_count: 0,
    dispute_count: 0,
    subscription_event_count: 0,
  };

  // Detect duplicate stripe_id within the input batch — same id appearing
  // more than once is suppressed at the matcher level (DB also dedupes via
  // UNIQUE on provider_invoice_imports).
  const seenStripeIds: Set<string> = new Set();

  for (const e of stableEventOrder(events)) {
    if (seenStripeIds.has(e.stripe_id)) {
      summary.duplicate_event_count += 1;
      adjustments.push({
        organization_id: e.organization_id,
        provider: 'stripe',
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: 0,
        actual_usd: 0,
        adjustment_usd: 0,
        reason: 'duplicate_event',
        severity: 'none',
        metadata: { stripe_id: e.stripe_id, stripe_type: e.stripe_type, occurred_at: e.occurred_at },
      });
      continue;
    }
    seenStripeIds.add(e.stripe_id);

    totals.stripe_gross_sum += e.gross_amount_usd;
    totals.stripe_fee_sum   += e.fee_amount_usd;
    totals.stripe_net_sum   += e.net_amount_usd;

    // Subscription events are recorded but do not carry money themselves —
    // the linked invoice/charge events carry the money, so we record an
    // attribution-only row with zero financial delta.
    if (e.stripe_type === 'subscription') {
      const sub = e.subscription_id ? subsBySubId.get(e.subscription_id) : undefined;
      summary.subscription_event_count += 1;
      adjustments.push({
        organization_id: sub?.organization_id ?? e.organization_id,
        provider: 'stripe',
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: 0,
        actual_usd: 0,
        adjustment_usd: 0,
        reason: 'subscription_event',
        severity: 'none',
        metadata: {
          stripe_id: e.stripe_id, occurred_at: e.occurred_at,
          subscription_id: e.subscription_id, status_after: sub?.status ?? null,
        },
      });
      continue;
    }

    // Refunds and disputes: emit a negative adjustment with the refunded
    // amount as a forward-only compensating entry. The internal payment
    // record may exist (mark as matched to suppress missing_provider_event).
    if (e.stripe_type === 'refund' || e.stripe_type === 'dispute') {
      const counter = (e.charge_id && paymentsByTxId.get(e.charge_id))
                  || (e.payment_intent_id && paymentsByTxId.get(e.payment_intent_id))
                  || undefined;
      if (counter) matchedPaymentTxIds.add(counter.provider_transaction_id);
      const amt = e.refunded_amount_usd || e.gross_amount_usd;
      if (e.stripe_type === 'refund') {
        summary.refund_count   += 1;
        totals.stripe_refund_sum += amt;
      } else {
        summary.dispute_count  += 1;
        totals.stripe_dispute_sum += amt;
      }
      adjustments.push({
        organization_id: counter?.organization_id ?? e.organization_id,
        provider: 'stripe',
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: 0,
        actual_usd: roundCents(-amt),
        adjustment_usd: roundCents(-amt),
        reason: e.stripe_type === 'refund' ? 'refund_recorded' : 'dispute_recorded',
        severity: 'low',
        metadata: {
          stripe_id: e.stripe_id, occurred_at: e.occurred_at,
          charge_id: e.charge_id, payment_intent_id: e.payment_intent_id,
        },
      });
      continue;
    }

    // Fee-only rows (stripe_fee / application_fee) record platform-side fee
    // without an internal counterpart by design.
    if (e.stripe_type === 'fee') {
      adjustments.push({
        organization_id: null,
        provider: 'stripe',
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: 0,
        actual_usd: roundCents(e.gross_amount_usd),
        adjustment_usd: roundCents(e.gross_amount_usd),
        reason: 'fee_variance',
        severity: 'none',
        metadata: {
          stripe_id: e.stripe_id, occurred_at: e.occurred_at,
          gross: e.gross_amount_usd, fee: e.fee_amount_usd, net: e.net_amount_usd,
        },
      });
      continue;
    }

    // Charge / invoice / payout: try to match against an internal record.
    const purchase = (e.stripe_id && purchasesByEventId.get(e.stripe_id))
                 || (e.payment_intent_id && purchasesByEventId.get(e.payment_intent_id))
                 || (e.charge_id && purchasesByEventId.get(e.charge_id))
                 || undefined;
    const payment = (e.stripe_id && paymentsByTxId.get(e.stripe_id))
                 || (e.payment_intent_id && paymentsByTxId.get(e.payment_intent_id))
                 || (e.charge_id && paymentsByTxId.get(e.charge_id))
                 || undefined;

    if (!purchase && !payment) {
      summary.unmatched_stripe_count += 1;
      adjustments.push({
        organization_id: e.organization_id,
        provider: 'stripe',
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: 0,
        actual_usd: roundCents(e.gross_amount_usd),
        adjustment_usd: roundCents(e.gross_amount_usd),
        reason: 'missing_attribution',
        severity: 'medium',
        metadata: {
          stripe_id: e.stripe_id, stripe_type: e.stripe_type, occurred_at: e.occurred_at,
          gross: e.gross_amount_usd, fee: e.fee_amount_usd, net: e.net_amount_usd,
        },
      });
      continue;
    }

    summary.matched_count += 1;
    if (purchase) matchedPurchaseIds.add(purchase.id);
    if (payment)  matchedPaymentTxIds.add(payment.provider_transaction_id);

    const internalGross = payment?.amount_usd ?? purchase?.amount_usd ?? 0;
    totals.internal_gross_sum += internalGross;

    // Gross variance.
    const grossVar = computeReconciliationVariance({
      estimated_usd: internalGross,
      actual_usd:    e.gross_amount_usd,
    });
    adjustments.push({
      organization_id: payment?.organization_id ?? purchase?.organization_id ?? e.organization_id,
      provider: 'stripe',
      action_key: null,
      ledger_hold_transaction_id: null,
      estimated_usd: roundCents(internalGross),
      actual_usd:    roundCents(e.gross_amount_usd),
      adjustment_usd: roundCents(e.gross_amount_usd - internalGross),
      reason: grossVar.severity === 'none' ? 'rounding' : 'variance',
      severity: grossVar.severity,
      metadata: {
        stripe_id: e.stripe_id, stripe_type: e.stripe_type, occurred_at: e.occurred_at,
        kind: 'gross',
      },
    });

    // Fee variance (only when an internal payment record exists with a fee).
    if (payment && payment.fee_amount_usd > 0) {
      const feeVar = computeReconciliationVariance({
        estimated_usd: payment.fee_amount_usd,
        actual_usd:    e.fee_amount_usd,
      });
      adjustments.push({
        organization_id: payment.organization_id,
        provider: 'stripe',
        action_key: null,
        ledger_hold_transaction_id: null,
        estimated_usd: roundCents(payment.fee_amount_usd),
        actual_usd:    roundCents(e.fee_amount_usd),
        adjustment_usd: roundCents(e.fee_amount_usd - payment.fee_amount_usd),
        reason: 'fee_variance',
        severity: feeVar.severity,
        metadata: { stripe_id: e.stripe_id, kind: 'fee' },
      });
    }

    // Net variance (independent — captures when fee was misrecorded).
    if (payment) {
      const netVar = computeReconciliationVariance({
        estimated_usd: payment.net_amount_usd,
        actual_usd:    e.net_amount_usd,
      });
      if (netVar.severity !== 'none') {
        adjustments.push({
          organization_id: payment.organization_id,
          provider: 'stripe',
          action_key: null,
          ledger_hold_transaction_id: null,
          estimated_usd: roundCents(payment.net_amount_usd),
          actual_usd:    roundCents(e.net_amount_usd),
          adjustment_usd: roundCents(e.net_amount_usd - payment.net_amount_usd),
          reason: 'net_variance',
          severity: netVar.severity,
          metadata: { stripe_id: e.stripe_id, kind: 'net' },
        });
      }
    }
  }

  // Internal records with no Stripe match.
  for (const p of stableSortedPurchases(creditPurchases)) {
    if (matchedPurchaseIds.has(p.id)) continue;
    if (p.status !== 'succeeded') continue; // only succeeded grants are expected to have a Stripe payment
    summary.unmatched_internal_count += 1;
    adjustments.push({
      organization_id: p.organization_id,
      provider: 'stripe',
      action_key: null,
      ledger_hold_transaction_id: null,
      estimated_usd: roundCents(p.amount_usd),
      actual_usd:    0,
      adjustment_usd: roundCents(-p.amount_usd),
      reason: 'missing_provider_event',
      severity: 'high',
      metadata: {
        credit_purchase_id: p.id, provider_event_id: p.provider_event_id, occurred_at: p.occurred_at,
      },
    });
  }
  for (const pt of stableSortedPayments(paymentTransactions)) {
    if (matchedPaymentTxIds.has(pt.provider_transaction_id)) continue;
    if (pt.status !== 'succeeded' && pt.status !== 'partially_refunded') continue;
    summary.unmatched_internal_count += 1;
    adjustments.push({
      organization_id: pt.organization_id,
      provider: 'stripe',
      action_key: null,
      ledger_hold_transaction_id: null,
      estimated_usd: roundCents(pt.amount_usd),
      actual_usd:    0,
      adjustment_usd: roundCents(-pt.amount_usd),
      reason: 'missing_provider_event',
      severity: 'high',
      metadata: {
        provider_transaction_id: pt.provider_transaction_id, occurred_at: pt.occurred_at,
      },
    });
  }

  return {
    adjustments,
    totals: {
      stripe_gross_sum:   roundCents(totals.stripe_gross_sum),
      stripe_fee_sum:     roundCents(totals.stripe_fee_sum),
      stripe_net_sum:     roundCents(totals.stripe_net_sum),
      stripe_refund_sum:  roundCents(totals.stripe_refund_sum),
      stripe_dispute_sum: roundCents(totals.stripe_dispute_sum),
      internal_gross_sum: roundCents(totals.internal_gross_sum),
    },
    summary,
  };
}

function stableEventOrder(events: StripeNormalizedEvent[]): StripeNormalizedEvent[] {
  return [...events].sort((a, b) => {
    const c = a.occurred_at.localeCompare(b.occurred_at); if (c) return c;
    const d = a.stripe_type.localeCompare(b.stripe_type); if (d) return d;
    return a.stripe_id.localeCompare(b.stripe_id);
  });
}
function stableSortedPurchases(arr: InternalCreditPurchase[]): InternalCreditPurchase[] {
  return [...arr].sort((a, b) => a.id.localeCompare(b.id));
}
function stableSortedPayments(arr: InternalPaymentTransaction[]): InternalPaymentTransaction[] {
  return [...arr].sort((a, b) => a.provider_transaction_id.localeCompare(b.provider_transaction_id));
}
