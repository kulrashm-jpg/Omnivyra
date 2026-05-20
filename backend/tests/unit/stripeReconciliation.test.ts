/**
 * Stripe reconciliation — pure-module tests (no DB).
 * Covers both normalizers (Balance export + Webhook log) and the dedicated
 * Stripe matcher (charge/refund/dispute/fee/invoice/subscription), tolerant
 * parsing, determinism, duplicate-event suppression, and unmatched-side
 * handling on both Stripe and internal records.
 */

import {
  normalizeStripeBalanceExport,
  normalizeStripeWebhookLog,
  STRIPE_ADAPTER_VERSION_BALANCE,
  STRIPE_ADAPTER_VERSION_WEBHOOK,
} from '../../services/billing/reconciliation/stripeAdapter';
import {
  reconcileStripe,
  type InternalCreditPurchase,
  type InternalPaymentTransaction,
  type InternalSubscription,
} from '../../services/billing/reconciliation/stripeMatcher';

// Stripe timestamps are epoch-seconds. Derive deterministically.
const T_2026_05_19 = Math.floor(Date.UTC(2026, 4, 19, 12, 0, 0) / 1000);
const T_2026_05_20 = Math.floor(Date.UTC(2026, 4, 20, 12, 0, 0) / 1000);

describe('stripeAdapter.normalizeStripeBalanceExport — pure / tolerant', () => {
  test('cents → USD; charge + refund + fee + dispute classified correctly', () => {
    const r = normalizeStripeBalanceExport({
      payload: {
        balance_transactions: [
          { id: 'txn_ch1', type: 'charge',    amount: 10000, fee: 320, net: 9680,
            currency: 'usd', created: T_2026_05_19,
            source: { id: 'ch_1', payment_intent: 'pi_1' },
            metadata: { organization_id: 'org-A' } },
          { id: 'txn_re1', type: 'refund',    amount: -2500, fee: 0,   net: -2500,
            currency: 'usd', created: T_2026_05_19, source: { id: 'ch_1' } },
          { id: 'txn_fee', type: 'stripe_fee', amount: 50,   fee: 0,   net: 50,
            currency: 'usd', created: T_2026_05_19 },
          { id: 'txn_dsp', type: 'dispute',   amount: -10000, fee: 1500, net: -11500,
            currency: 'usd', created: T_2026_05_19, source: { id: 'ch_2' } },
        ],
      },
    });
    expect(r.adapter_version).toBe(STRIPE_ADAPTER_VERSION_BALANCE);
    expect(r.warnings).toEqual([]);
    expect(r.events).toHaveLength(4);
    const charge = r.events.find(e => e.stripe_id === 'txn_ch1')!;
    expect(charge.stripe_type).toBe('charge');
    expect(charge.gross_amount_usd).toBe(100);
    expect(charge.fee_amount_usd).toBe(3.2);
    expect(charge.net_amount_usd).toBe(96.8);
    expect(charge.organization_id).toBe('org-A');
    expect(charge.charge_id).toBe('ch_1');
    expect(charge.payment_intent_id).toBe('pi_1');
    const refund = r.events.find(e => e.stripe_id === 'txn_re1')!;
    expect(refund.stripe_type).toBe('refund');
    expect(refund.refunded_amount_usd).toBe(25);
    expect(refund.status).toBe('refunded');
    const fee = r.events.find(e => e.stripe_id === 'txn_fee')!;
    expect(fee.stripe_type).toBe('fee');
    expect(fee.status).toBe('recorded');
    const dispute = r.events.find(e => e.stripe_id === 'txn_dsp')!;
    expect(dispute.stripe_type).toBe('dispute');
    expect(dispute.status).toBe('disputed');
    expect(dispute.refunded_amount_usd).toBe(100);
  });

  test('tolerant: rows missing id / unknown type / no created are skipped with warnings', () => {
    const r = normalizeStripeBalanceExport({
      payload: {
        balance_transactions: [
          { type: 'charge', amount: 100, created: T_2026_05_19 },              // no id
          { id: 'txn_x', type: 'mystery', amount: 100, created: T_2026_05_19 }, // unknown type
          { id: 'txn_y', type: 'charge', amount: 100 },                        // no created
          { id: 'txn_z', type: 'charge', amount: 100, created: T_2026_05_19 }, // valid
        ],
      },
    });
    expect(r.warnings.length).toBe(3);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].stripe_id).toBe('txn_z');
  });

  test('determinism: identical payload → identical normalized result (stable order)', () => {
    const payload = {
      balance_transactions: [
        { id: 'txn_b', type: 'charge', amount: 100, fee: 5, net: 95, created: T_2026_05_19 },
        { id: 'txn_a', type: 'charge', amount: 100, fee: 5, net: 95, created: T_2026_05_19 },
      ],
    };
    const a = normalizeStripeBalanceExport({ payload });
    const b = normalizeStripeBalanceExport({ payload });
    expect(b).toEqual(a);
    expect(a.events.map(e => e.stripe_id)).toEqual(['txn_a', 'txn_b']);
  });
});

describe('stripeAdapter.normalizeStripeWebhookLog — pure / tolerant', () => {
  test('charge.succeeded + charge.refunded + dispute + invoice + subscription parsed', () => {
    const r = normalizeStripeWebhookLog({
      payload: {
        events: [
          { id: 'evt_1', type: 'charge.succeeded', created: T_2026_05_19,
            data: { object: { id: 'ch_a', amount: 10000, application_fee_amount: 320, payment_intent: 'pi_a',
                              metadata: { organization_id: 'org-A' } } } },
          { id: 'evt_2', type: 'charge.refunded', created: T_2026_05_19,
            data: { object: { id: 'ch_a', amount: 10000, amount_refunded: 4000 } } },
          { id: 'evt_3', type: 'charge.dispute.created', created: T_2026_05_19,
            data: { object: { id: 'ch_b', amount: 10000, metadata: { organization_id: 'org-B' } } } },
          { id: 'evt_4', type: 'invoice.paid', created: T_2026_05_19,
            data: { object: { id: 'in_1', amount_paid: 5000, subscription: 'sub_1',
                              metadata: { organization_id: 'org-A' } } } },
          { id: 'evt_5', type: 'customer.subscription.created', created: T_2026_05_19,
            data: { object: { id: 'sub_1', metadata: { organization_id: 'org-A' } } } },
        ],
      },
    });
    expect(r.adapter_version).toBe(STRIPE_ADAPTER_VERSION_WEBHOOK);
    expect(r.events).toHaveLength(5);
    const charge = r.events.find(e => e.stripe_type === 'charge')!;
    expect(charge.gross_amount_usd).toBe(100);
    expect(charge.fee_amount_usd).toBe(3.2);
    const refund = r.events.find(e => e.stripe_type === 'refund')!;
    expect(refund.refunded_amount_usd).toBe(40);
    expect(refund.status).toBe('partially_refunded');
    const dispute = r.events.find(e => e.stripe_type === 'dispute')!;
    expect(dispute.gross_amount_usd).toBe(100);
    const invoice = r.events.find(e => e.stripe_type === 'invoice')!;
    expect(invoice.gross_amount_usd).toBe(50);
    expect(invoice.subscription_id).toBe('sub_1');
    const sub = r.events.find(e => e.stripe_type === 'subscription')!;
    expect(sub.subscription_id).toBe('sub_1');
    expect(sub.organization_id).toBe('org-A');
  });

  test('tolerant: missing id/type/object/created → skipped with warning', () => {
    const r = normalizeStripeWebhookLog({
      payload: {
        events: [
          { type: 'charge.succeeded', created: T_2026_05_19, data: { object: { id: 'ch_a', amount: 100 } } }, // no id
          { id: 'evt_x', created: T_2026_05_19, data: { object: { id: 'ch_a', amount: 100 } } },              // no type
          { id: 'evt_y', type: 'charge.succeeded', data: { object: { id: 'ch_a', amount: 100 } } },           // no created
          { id: 'evt_z', type: 'charge.succeeded', created: T_2026_05_19, data: { object: {} } },             // no object.id
          { id: 'evt_w', type: 'charge.succeeded', created: T_2026_05_19, data: { object: { id: 'ch_w', amount: 100 } } },
        ],
      },
    });
    expect(r.warnings.length).toBeGreaterThanOrEqual(4);
    expect(r.events).toHaveLength(1);
    expect(r.events[0].stripe_id).toBe('ch_w');
  });
});

describe('stripeMatcher.reconcileStripe — match precedence + variance', () => {
  test('matched charge with exact gross/fee/net → rounding row only', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_1', type: 'charge', amount: 10000, fee: 320, net: 9680,
          created: T_2026_05_19, source: { id: 'ch_1', payment_intent: 'pi_1' },
          metadata: { organization_id: 'org-A' } },
      ]},
    }).events;
    const payments: InternalPaymentTransaction[] = [{
      organization_id: 'org-A', provider_transaction_id: 'ch_1',
      amount_usd: 100, fee_amount_usd: 3.2, net_amount_usd: 96.8,
      status: 'succeeded', occurred_at: '2026-05-19T12:00:00Z',
    }];
    const r = reconcileStripe({ events, paymentTransactions: payments });
    expect(r.summary.matched_count).toBe(1);
    expect(r.summary.unmatched_stripe_count).toBe(0);
    expect(r.summary.unmatched_internal_count).toBe(0);
    // Gross row only (fee variance was 0; net variance was 0 so no extra row).
    const grossRow = r.adjustments.find(a => a.metadata.kind === 'gross')!;
    expect(grossRow.reason).toBe('rounding');
    expect(grossRow.adjustment_usd).toBe(0);
    expect(r.adjustments.some(a => a.reason === 'fee_variance' && a.adjustment_usd !== 0)).toBe(false);
  });

  test('matched charge via payment_intent fallback when stripe_id differs', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_77', type: 'charge', amount: 5000, fee: 160, net: 4840,
          created: T_2026_05_19, source: { id: 'ch_77', payment_intent: 'pi_match' },
          metadata: { organization_id: 'org-A' } },
      ]},
    }).events;
    const purchases: InternalCreditPurchase[] = [{
      id: 'cp-1', organization_id: 'org-A', provider_event_id: 'pi_match',
      amount_usd: 50, status: 'succeeded', occurred_at: '2026-05-19T12:00:00Z',
    }];
    const r = reconcileStripe({ events, creditPurchases: purchases });
    expect(r.summary.matched_count).toBe(1);
    expect(r.summary.unmatched_stripe_count).toBe(0);
  });

  test('gross variance produces variance reason; net variance produces separate row', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_var', type: 'charge', amount: 10000, fee: 500, net: 9500,
          created: T_2026_05_19, source: { id: 'ch_var', payment_intent: 'pi_var' },
          metadata: { organization_id: 'org-A' } },
      ]},
    }).events;
    const payments: InternalPaymentTransaction[] = [{
      organization_id: 'org-A', provider_transaction_id: 'ch_var',
      amount_usd: 50, fee_amount_usd: 1.0, net_amount_usd: 49.0, // very different
      status: 'succeeded', occurred_at: '2026-05-19T12:00:00Z',
    }];
    const r = reconcileStripe({ events, paymentTransactions: payments });
    const grossRow = r.adjustments.find(a => a.metadata.kind === 'gross')!;
    expect(grossRow.reason).toBe('variance');
    expect(grossRow.adjustment_usd).toBeCloseTo(50, 8); // 100 - 50
    const feeRow = r.adjustments.find(a => a.metadata.kind === 'fee')!;
    expect(feeRow.reason).toBe('fee_variance');
    expect(feeRow.adjustment_usd).toBeCloseTo(4, 8); // 5 - 1
    const netRow = r.adjustments.find(a => a.metadata.kind === 'net')!;
    expect(netRow.reason).toBe('net_variance');
  });

  test('unmatched Stripe event → missing_attribution row', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_orphan', type: 'charge', amount: 2500, fee: 80, net: 2420,
          created: T_2026_05_19, source: { id: 'ch_orphan' } },
      ]},
    }).events;
    const r = reconcileStripe({ events });
    expect(r.summary.unmatched_stripe_count).toBe(1);
    const row = r.adjustments[0];
    expect(row.reason).toBe('missing_attribution');
    expect(row.organization_id).toBeNull();
    expect(row.actual_usd).toBeCloseTo(25, 8);
  });

  test('unmatched internal credit_purchase → missing_provider_event row', () => {
    const purchases: InternalCreditPurchase[] = [{
      id: 'cp-orphan', organization_id: 'org-B', provider_event_id: 'pi_nowhere',
      amount_usd: 75, status: 'succeeded', occurred_at: '2026-05-19T12:00:00Z',
    }];
    const r = reconcileStripe({ events: [], creditPurchases: purchases });
    expect(r.summary.unmatched_internal_count).toBe(1);
    const row = r.adjustments[0];
    expect(row.reason).toBe('missing_provider_event');
    expect(row.organization_id).toBe('org-B');
    expect(row.adjustment_usd).toBeCloseTo(-75, 8);
    expect(row.severity).toBe('high');
  });

  test('refund + dispute produce signed compensating adjustments and skip missing_provider_event for the matched payment', () => {
    const events = normalizeStripeWebhookLog({
      payload: { events: [
        { id: 'evt_r', type: 'charge.refunded', created: T_2026_05_19,
          data: { object: { id: 'ch_x', amount: 10000, amount_refunded: 4000,
                            metadata: { organization_id: 'org-A' } } } },
        { id: 'evt_d', type: 'charge.dispute.created', created: T_2026_05_19,
          data: { object: { id: 'ch_y', amount: 5000,
                            metadata: { organization_id: 'org-A' } } } },
      ]},
    }).events;
    const payments: InternalPaymentTransaction[] = [
      { organization_id: 'org-A', provider_transaction_id: 'ch_x',
        amount_usd: 100, fee_amount_usd: 3.2, net_amount_usd: 96.8,
        status: 'partially_refunded', occurred_at: '2026-05-19T12:00:00Z' },
      { organization_id: 'org-A', provider_transaction_id: 'ch_y',
        amount_usd: 50, fee_amount_usd: 1.6, net_amount_usd: 48.4,
        status: 'disputed', occurred_at: '2026-05-19T12:00:00Z' },
    ];
    const r = reconcileStripe({ events, paymentTransactions: payments });
    expect(r.summary.refund_count).toBe(1);
    expect(r.summary.dispute_count).toBe(1);
    const refundRow = r.adjustments.find(a => a.reason === 'refund_recorded')!;
    expect(refundRow.adjustment_usd).toBeCloseTo(-40, 8);
    const disputeRow = r.adjustments.find(a => a.reason === 'dispute_recorded')!;
    expect(disputeRow.adjustment_usd).toBeCloseTo(-50, 8);
    // No missing_provider_event rows — both payments matched via refund/dispute path.
    expect(r.adjustments.some(a => a.reason === 'missing_provider_event')).toBe(false);
  });

  test('duplicate stripe_id within batch → single duplicate_event row, no double-count', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_dup', type: 'charge', amount: 10000, fee: 320, net: 9680,
          created: T_2026_05_19, source: { id: 'ch_dup' } },
        { id: 'txn_dup', type: 'charge', amount: 10000, fee: 320, net: 9680,
          created: T_2026_05_19, source: { id: 'ch_dup' } },
      ]},
    }).events;
    const r = reconcileStripe({ events });
    expect(r.summary.duplicate_event_count).toBe(1);
    expect(r.adjustments.filter(a => a.reason === 'duplicate_event')).toHaveLength(1);
  });

  test('subscription event records attribution but zero financial delta', () => {
    const events = normalizeStripeWebhookLog({
      payload: { events: [
        { id: 'evt_sub', type: 'customer.subscription.created', created: T_2026_05_19,
          data: { object: { id: 'sub_42', metadata: { organization_id: 'org-A' } } } },
      ]},
    }).events;
    const subs: InternalSubscription[] = [{
      organization_id: 'org-A', provider_subscription_id: 'sub_42',
      status: 'active', current_period_start: '2026-05-19', current_period_end: '2026-06-19',
    }];
    const r = reconcileStripe({ events, subscriptions: subs });
    expect(r.summary.subscription_event_count).toBe(1);
    const row = r.adjustments.find(a => a.reason === 'subscription_event')!;
    expect(row.organization_id).toBe('org-A');
    expect(row.adjustment_usd).toBe(0);
    expect((row.metadata as Record<string, unknown>).status_after).toBe('active');
  });

  test('replay determinism: identical inputs → deep-equal results', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_a', type: 'charge', amount: 10000, fee: 320, net: 9680,
          created: T_2026_05_19, source: { id: 'ch_a', payment_intent: 'pi_a' },
          metadata: { organization_id: 'org-1' } },
        { id: 'txn_b', type: 'charge', amount: 5000, fee: 160, net: 4840,
          created: T_2026_05_20, source: { id: 'ch_b', payment_intent: 'pi_b' },
          metadata: { organization_id: 'org-2' } },
      ]},
    }).events;
    const payments: InternalPaymentTransaction[] = [
      { organization_id: 'org-1', provider_transaction_id: 'ch_a',
        amount_usd: 100, fee_amount_usd: 3.2, net_amount_usd: 96.8,
        status: 'succeeded', occurred_at: '2026-05-19T12:00:00Z' },
      { organization_id: 'org-2', provider_transaction_id: 'ch_b',
        amount_usd: 50, fee_amount_usd: 1.6, net_amount_usd: 48.4,
        status: 'succeeded', occurred_at: '2026-05-20T12:00:00Z' },
    ];
    const r1 = reconcileStripe({ events, paymentTransactions: payments });
    const r2 = reconcileStripe({ events, paymentTransactions: payments });
    expect(r2).toEqual(r1);
  });

  test('totals roll up gross/fee/net/refund/dispute deterministically', () => {
    const events = normalizeStripeBalanceExport({
      payload: { balance_transactions: [
        { id: 'txn_c', type: 'charge', amount: 10000, fee: 320, net: 9680, created: T_2026_05_19, source: { id: 'ch_c' } },
        { id: 'txn_r', type: 'refund', amount: -2500, fee: 0,   net: -2500, created: T_2026_05_19, source: { id: 'ch_c' } },
        { id: 'txn_d', type: 'dispute', amount: -5000, fee: 1500, net: -6500, created: T_2026_05_19, source: { id: 'ch_d' } },
      ]},
    }).events;
    const r = reconcileStripe({ events });
    expect(r.totals.stripe_gross_sum).toBeCloseTo(100 + (-25) + (-50), 8);
    expect(r.totals.stripe_refund_sum).toBeCloseTo(25, 8);
    expect(r.totals.stripe_dispute_sum).toBeCloseTo(50, 8);
  });
});
