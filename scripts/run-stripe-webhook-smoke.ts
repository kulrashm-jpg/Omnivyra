/**
 * LOCAL-ONLY: end-to-end Stripe webhook service smoke against a local
 * Supabase. Exercises the same runtime path the HTTP endpoint uses —
 * recordPaymentProviderEvent + completePurchase wiring + payment_transactions
 * write — but without the HTTP shim (which is already unit-tested).
 *
 * Guarded by the same localhost env contract as the reconciliation runner.
 */

import {
  processStripeWebhookEvent,
  type StripeWebhookDeps,
  type StripeEventPayload,
} from '../backend/services/payments/stripeWebhookService';
import { assertLocalhostOnly } from '../backend/services/billing/reconciliation/runnerDispatch';
import {
  recordPaymentProviderEvent,
  completePurchase,
  failPurchase,
} from '../backend/services/purchaseService';
import { ownedDbTable } from '../backend/db/writeOwner';

const PROVIDER = 'stripe';

async function main() {
  const guard = assertLocalhostOnly();
  if (!guard.ok) {
    const err = (guard as { ok: false; error: string }).error;
    console.error(JSON.stringify({ ok: false, error: err }));
    process.exitCode = 3;
    return;
  }

  const deps: StripeWebhookDeps = {
    recordEvent: async (input) => {
      const r = await recordPaymentProviderEvent({
        provider: PROVIDER,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        purchaseId: input.purchaseId ?? null,
        organizationId: input.organizationId ?? null,
        payload: input.payload,
      });
      return { id: r.id, duplicate: r.duplicate, processingStatus: r.processingStatus ?? null };
    },
    findPurchaseByProviderEventId: async () => null, // no purchase seeded in local DB
    completePurchase: async (purchaseId, referenceId) => {
      const r = await completePurchase(purchaseId, referenceId);
      if (r.success) return { success: true, purchaseId: r.purchaseId, creditsGranted: r.creditsGranted };
      const failure = r as { success: false; reason: string };
      return { success: false, reason: failure.reason };
    },
    failPurchase: async (purchaseId, referenceId) => { await failPurchase(purchaseId, referenceId); },
    recordPaymentTransaction: async (input) => {
      const { error } = await ownedDbTable('payment_transactions').insert({
        organization_id: input.organizationId,
        provider: PROVIDER,
        provider_transaction_id: input.providerTransactionId,
        amount: input.amount, fee_amount: input.fee, net_amount: input.net,
        currency: input.currency, status: input.status, occurred_at: input.occurredAt,
        metadata: { ...input.metadata, payment_intent_id: input.paymentIntentId, invoice_id: input.invoiceId, subscription_id: input.subscriptionId },
      });
      if (!error) return { inserted: true, duplicate: false };
      const code = (error as { code?: string }).code;
      if (code === '23505') return { inserted: false, duplicate: true };
      throw new Error(`payment_transactions insert failed: ${error.message}`);
    },
    markEvent: async (eventId, status, errorMsg) => {
      await ownedDbTable('payment_provider_events').update({
        processing_status: status, processed_at: new Date().toISOString(), error_message: errorMsg ?? null,
      }).eq('id', eventId);
    },
  };

  const event: StripeEventPayload = {
    id: 'evt_local_smoke_1',
    type: 'charge.succeeded',
    created: Math.floor(Date.UTC(2026, 4, 19, 12, 0, 0) / 1000),
    data: { object: { id: 'ch_local_smoke_1', amount: 10000, currency: 'usd',
      payment_intent: 'pi_local_smoke_1', metadata: { organization_id: '00000000-0000-0000-0000-000000000001' } } },
  };

  console.log('--- run 1: fresh ---');
  const r1 = await processStripeWebhookEvent(event, deps);
  console.log(JSON.stringify(r1, null, 2));

  console.log('--- run 2: replay (same evt_id) ---');
  const r2 = await processStripeWebhookEvent(event, deps);
  console.log(JSON.stringify(r2, null, 2));

  console.log('--- failure drill: invalid event payload ---');
  const r3 = await processStripeWebhookEvent({} as StripeEventPayload, deps);
  console.log(JSON.stringify(r3, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
