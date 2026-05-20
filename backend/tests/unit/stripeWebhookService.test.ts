/**
 * Stripe webhook service — pure-module tests (no DB / no network).
 *
 * Covers:
 *  - signature verification (positive, negative, replay-tolerance window)
 *  - routing classification matrix
 *  - duplicate-event idempotency (replay-safe)
 *  - charge.succeeded → completePurchase + payment_transactions insert
 *  - charge.refunded / charge.dispute.* → record-only, no credit grant
 *  - subscription events → record-only, attribution preserved
 *  - failed payment → failPurchase
 *  - unsupported event types → ignored with reason
 *  - organization attribution precedence (purchase row > metadata > null)
 */

import crypto from 'crypto';
import {
  verifyStripeWebhookSignature,
  classifyStripeEvent,
  organizationIdFromMetadata,
  processStripeWebhookEvent,
  type StripeWebhookDeps,
  type StripeEventPayload,
} from '../../services/payments/stripeWebhookService';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeEvent(partial: Partial<StripeEventPayload> & { type: string; id?: string }): StripeEventPayload {
  return {
    id: partial.id ?? 'evt_test_1',
    type: partial.type,
    created: partial.created ?? Math.floor(Date.UTC(2026, 4, 19, 12, 0, 0) / 1000),
    data: partial.data ?? { object: { id: 'ch_test', amount: 10000, currency: 'usd' } },
    livemode: false,
  };
}

function signPayload(rawBody: string, secret: string, timestamp: number): string {
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${expected}`;
}

interface MockState {
  recordedEvents: Array<{ providerEventId: string; eventType: string; purchaseId: string | null; organizationId: string | null; payload: Record<string, unknown> }>;
  payments: Array<{ providerTransactionId: string; organizationId: string; amount: number; status: string }>;
  completedPurchases: Array<{ purchaseId: string; referenceId: string }>;
  failedPurchases: Array<{ purchaseId: string; referenceId: string }>;
  marked: Array<{ id: string; status: string; reason?: string }>;
}

function makeDeps(opts: {
  purchaseLookup?: (id: string) => { id: string; organization_id: string; status: string; fulfillment_status: string | null } | null;
  duplicateOn?: Set<string>;
  recordTransactionFails?: boolean;
}): { deps: StripeWebhookDeps; state: MockState } {
  const state: MockState = {
    recordedEvents: [], payments: [], completedPurchases: [], failedPurchases: [], marked: [],
  };
  const duplicates = opts.duplicateOn ?? new Set<string>();

  const deps: StripeWebhookDeps = {
    recordEvent: async (input) => {
      if (duplicates.has(input.providerEventId)) {
        return { id: `existing_${input.providerEventId}`, duplicate: true, processingStatus: 'processed' };
      }
      const id = `evt_row_${state.recordedEvents.length + 1}`;
      state.recordedEvents.push({
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        purchaseId: input.purchaseId ?? null,
        organizationId: input.organizationId ?? null,
        payload: input.payload,
      });
      return { id, duplicate: false };
    },
    findPurchaseByProviderEventId: async (id) => (opts.purchaseLookup ? opts.purchaseLookup(id) : null),
    completePurchase: async (purchaseId, referenceId) => {
      state.completedPurchases.push({ purchaseId, referenceId });
      return { success: true, purchaseId, creditsGranted: 500 };
    },
    failPurchase: async (purchaseId, referenceId) => {
      state.failedPurchases.push({ purchaseId, referenceId });
    },
    recordPaymentTransaction: async (input) => {
      if (opts.recordTransactionFails) throw new Error('pt_insert_failed');
      state.payments.push({
        providerTransactionId: input.providerTransactionId,
        organizationId: input.organizationId,
        amount: input.amount,
        status: input.status,
      });
      return { inserted: true, duplicate: false };
    },
    markEvent: async (id, status, reason) => { state.marked.push({ id, status, reason }); },
  };
  return { deps, state };
}

// ── signature verification ──────────────────────────────────────────────────

describe('verifyStripeWebhookSignature', () => {
  const secret = 'whsec_test_abc';
  const now = 1779000000; // arbitrary fixed epoch

  test('valid signature within tolerance → ok', () => {
    const body = '{"id":"evt_1","type":"charge.succeeded"}';
    const r = verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: signPayload(body, secret, now), secret, nowEpochSeconds: now,
    });
    expect(r.ok).toBe(true);
  });

  test('signature mismatch → reason=signature_mismatch', () => {
    const body = '{"hello":"world"}';
    const bad = `t=${now},v1=${'00'.repeat(32)}`;
    const r = verifyStripeWebhookSignature({ rawBody: body, signatureHeader: bad, secret, nowEpochSeconds: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('signature_mismatch');
  });

  test('timestamp older than tolerance → rejected', () => {
    const body = '{}';
    const stale = now - 1000;
    const r = verifyStripeWebhookSignature({
      rawBody: body, signatureHeader: signPayload(body, secret, stale), secret,
      nowEpochSeconds: now, toleranceSeconds: 300,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timestamp_out_of_tolerance');
  });

  test('missing signature fields → rejected', () => {
    const r = verifyStripeWebhookSignature({ rawBody: '{}', signatureHeader: 't=1234567890', secret, nowEpochSeconds: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_signature_fields');
  });

  test('empty header → rejected', () => {
    const r = verifyStripeWebhookSignature({ rawBody: '{}', signatureHeader: '', secret, nowEpochSeconds: now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing_signature_header');
  });

  test('multiple v1 candidates: any valid passes (Stripe key rotation case)', () => {
    const body = '{}';
    const goodSig = crypto.createHmac('sha256', secret).update(`${now}.${body}`).digest('hex');
    const header = `t=${now},v1=${'00'.repeat(32)},v1=${goodSig}`;
    const r = verifyStripeWebhookSignature({ rawBody: body, signatureHeader: header, secret, nowEpochSeconds: now });
    expect(r.ok).toBe(true);
  });
});

// ── routing classification ──────────────────────────────────────────────────

describe('classifyStripeEvent', () => {
  test('income events route to complete_purchase', () => {
    expect(classifyStripeEvent('charge.succeeded')).toBe('complete_purchase');
    expect(classifyStripeEvent('payment_intent.succeeded')).toBe('complete_purchase');
    expect(classifyStripeEvent('invoice.paid')).toBe('complete_purchase');
  });
  test('failure events → fail_purchase', () => {
    expect(classifyStripeEvent('invoice.payment_failed')).toBe('fail_purchase');
    expect(classifyStripeEvent('payment_intent.payment_failed')).toBe('fail_purchase');
  });
  test('refund / dispute / subscription → record-only', () => {
    expect(classifyStripeEvent('charge.refunded')).toBe('record_refund');
    expect(classifyStripeEvent('charge.dispute.created')).toBe('record_dispute');
    expect(classifyStripeEvent('charge.dispute.closed')).toBe('record_dispute');
    expect(classifyStripeEvent('customer.subscription.created')).toBe('record_subscription');
    expect(classifyStripeEvent('customer.subscription.updated')).toBe('record_subscription');
    expect(classifyStripeEvent('customer.subscription.deleted')).toBe('record_subscription');
  });
  test('unknown types → unsupported', () => {
    expect(classifyStripeEvent('mystery.event')).toBe('unsupported');
    expect(classifyStripeEvent('')).toBe('unsupported');
  });
});

// ── attribution helper ──────────────────────────────────────────────────────

describe('organizationIdFromMetadata', () => {
  test('reads organization_id with aliases', () => {
    expect(organizationIdFromMetadata({ organization_id: 'org-A' })).toBe('org-A');
    expect(organizationIdFromMetadata({ org_id: 'org-B' })).toBe('org-B');
    expect(organizationIdFromMetadata({ company_id: 'org-C' })).toBe('org-C');
    expect(organizationIdFromMetadata({ organizationId: 'org-D' })).toBe('org-D');
  });
  test('returns null on missing / non-object / empty string', () => {
    expect(organizationIdFromMetadata(null)).toBeNull();
    expect(organizationIdFromMetadata('not-an-object')).toBeNull();
    expect(organizationIdFromMetadata({ organization_id: '' })).toBeNull();
    expect(organizationIdFromMetadata({})).toBeNull();
  });
});

// ── orchestration: side-effects ─────────────────────────────────────────────

describe('processStripeWebhookEvent', () => {
  test('charge.succeeded with matching purchase → records event, completes purchase, inserts payment_transactions', async () => {
    const { deps, state } = makeDeps({
      purchaseLookup: (id) => id === 'pi_1' ? { id: 'cp-1', organization_id: 'org-A', status: 'pending', fulfillment_status: 'pending' } : null,
    });
    const evt = makeEvent({
      type: 'charge.succeeded',
      id: 'evt_ch_1',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount: 10000, application_fee_amount: 320, currency: 'usd', metadata: { organization_id: 'org-A' } } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    if (r.status === 'processed') {
      expect(r.purchaseId).toBe('cp-1');
      expect(r.creditsGranted).toBe(500);
      expect(r.paymentRecorded).toBe(true);
      expect(r.organizationId).toBe('org-A');
    }
    expect(state.recordedEvents).toHaveLength(1);
    expect(state.completedPurchases).toEqual([{ purchaseId: 'cp-1', referenceId: 'evt_ch_1' }]);
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0].providerTransactionId).toBe('ch_1');
    expect(state.payments[0].amount).toBe(100);
  });

  test('duplicate event id (replay) → short-circuit, no purchase / payment side-effects', async () => {
    const { deps, state } = makeDeps({
      purchaseLookup: () => ({ id: 'cp-1', organization_id: 'org-A', status: 'pending', fulfillment_status: 'pending' }),
      duplicateOn: new Set(['evt_dup_1']),
    });
    const evt = makeEvent({
      type: 'charge.succeeded', id: 'evt_dup_1',
      data: { object: { id: 'ch_x', amount: 10000, currency: 'usd' } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('duplicate');
    expect(state.completedPurchases).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
  });

  test('refund event → record-only, no credit grant, no payment_transactions write', async () => {
    const { deps, state } = makeDeps({
      purchaseLookup: () => ({ id: 'cp-1', organization_id: 'org-A', status: 'completed', fulfillment_status: 'completed' }),
    });
    const evt = makeEvent({
      type: 'charge.refunded', id: 'evt_ref_1',
      data: { object: { id: 'ch_1', amount: 10000, amount_refunded: 4000, currency: 'usd' } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    if (r.status === 'processed') expect(r.paymentRecorded).toBe(false);
    expect(state.completedPurchases).toHaveLength(0);
    expect(state.payments).toHaveLength(0);
    expect(state.recordedEvents).toHaveLength(1);
  });

  test('dispute event → record-only', async () => {
    const { deps, state } = makeDeps({});
    const evt = makeEvent({
      type: 'charge.dispute.created', id: 'evt_dsp',
      data: { object: { id: 'ch_z', amount: 10000, currency: 'usd', metadata: { organization_id: 'org-B' } } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    expect(state.payments).toHaveLength(0);
    expect(state.recordedEvents[0].organizationId).toBe('org-B'); // metadata fallback
  });

  test('subscription event → record-only with attribution from metadata', async () => {
    const { deps, state } = makeDeps({});
    const evt = makeEvent({
      type: 'customer.subscription.created', id: 'evt_sub',
      data: { object: { id: 'sub_42', metadata: { organization_id: 'org-A' } } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    expect(state.payments).toHaveLength(0);
    expect(state.completedPurchases).toHaveLength(0);
    expect(state.recordedEvents[0].organizationId).toBe('org-A');
  });

  test('failed payment with matching purchase → failPurchase invoked', async () => {
    const { deps, state } = makeDeps({
      purchaseLookup: (id) => id === 'pi_fail' ? { id: 'cp-fail', organization_id: 'org-A', status: 'pending', fulfillment_status: 'pending' } : null,
    });
    const evt = makeEvent({
      type: 'invoice.payment_failed', id: 'evt_fail',
      data: { object: { id: 'in_fail', payment_intent: 'pi_fail', amount_due: 10000, currency: 'usd' } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    expect(state.failedPurchases).toEqual([{ purchaseId: 'cp-fail', referenceId: 'evt_fail' }]);
    expect(state.completedPurchases).toHaveLength(0);
  });

  test('failed payment with no matching purchase → ignored, audit recorded', async () => {
    const { deps, state } = makeDeps({});
    const evt = makeEvent({
      type: 'invoice.payment_failed', id: 'evt_fail_orphan',
      data: { object: { id: 'in_orphan', amount_due: 10000, currency: 'usd' } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('ignored');
    if (r.status === 'ignored') expect(r.reason).toBe('no_matching_purchase');
    expect(state.recordedEvents).toHaveLength(1);
  });

  test('unsupported event type → ignored with reason', async () => {
    const { deps, state } = makeDeps({});
    const evt = makeEvent({ type: 'product.created', id: 'evt_unsup', data: { object: { id: 'prod_x' } } });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('ignored');
    if (r.status === 'ignored') expect(r.reason).toBe('unsupported_event_type');
    expect(state.recordedEvents).toHaveLength(1);
  });

  test('charge.succeeded with no matching purchase + no metadata → records event, no payment_transactions insert', async () => {
    const { deps, state } = makeDeps({});
    const evt = makeEvent({
      type: 'charge.succeeded', id: 'evt_orphan_charge',
      data: { object: { id: 'ch_orphan', amount: 5000, currency: 'usd' } }, // no metadata.org
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    if (r.status === 'processed') {
      expect(r.organizationId).toBeNull();
      expect(r.paymentRecorded).toBe(false);
    }
    expect(state.recordedEvents).toHaveLength(1);
    expect(state.recordedEvents[0].organizationId).toBeNull();
    expect(state.payments).toHaveLength(0);
  });

  test('charge.succeeded falls back to metadata.organization_id when no purchase match', async () => {
    const { deps, state } = makeDeps({});
    const evt = makeEvent({
      type: 'charge.succeeded', id: 'evt_meta',
      data: { object: { id: 'ch_meta', amount: 7500, currency: 'usd', metadata: { organization_id: 'org-fallback' } } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    if (r.status === 'processed') {
      expect(r.organizationId).toBe('org-fallback');
      expect(r.paymentRecorded).toBe(true);
    }
    expect(state.payments[0].organizationId).toBe('org-fallback');
    expect(state.payments[0].amount).toBe(75);
  });

  test('payment_transactions failure does NOT roll back credit grant — best-effort write', async () => {
    const { deps, state } = makeDeps({
      purchaseLookup: () => ({ id: 'cp-1', organization_id: 'org-A', status: 'pending', fulfillment_status: 'pending' }),
      recordTransactionFails: true,
    });
    const evt = makeEvent({
      type: 'charge.succeeded', id: 'evt_pt_fail',
      data: { object: { id: 'ch_y', payment_intent: 'pi_y', amount: 10000, currency: 'usd' } },
    });
    const r = await processStripeWebhookEvent(evt, deps);
    expect(r.status).toBe('processed');
    if (r.status === 'processed') {
      expect(r.creditsGranted).toBe(500);
      expect(r.paymentRecorded).toBe(false); // PT insert failed but event was processed
    }
    expect(state.completedPurchases).toHaveLength(1);
  });

  test('invalid event payload → failed status, no crash', async () => {
    const { deps, state } = makeDeps({});
    const r = await processStripeWebhookEvent({} as StripeEventPayload, deps);
    expect(r.status).toBe('failed');
    expect(state.recordedEvents).toHaveLength(0);
  });
});
