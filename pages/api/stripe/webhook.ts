/**
 * Stripe webhook endpoint (runtime ingestion).
 *
 * Disables Next.js body parser so we can verify Stripe's HMAC over the raw
 * body. Delegates orchestration to `stripeWebhookService` which is fully
 * dependency-injected and unit-tested.
 *
 * Response contract:
 *   200 — processed | duplicate | ignored (Stripe should not retry)
 *   400 — invalid signature / malformed payload (no retry)
 *   500 — transient failure (Stripe will retry)
 *
 * NO financial-core writes here — every side-effect goes through the
 * existing primitives in `purchaseService` (recordPaymentProviderEvent /
 * completePurchase / failPurchase). Append-only event lineage via
 * `payment_provider_events` (UNIQUE(provider, provider_event_id)).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ownedDbTable } from '../../../backend/db/writeOwner';
import {
  recordPaymentProviderEvent,
  completePurchase,
  failPurchase,
} from '../../../backend/services/purchaseService';
import {
  verifyStripeWebhookSignature,
  processStripeWebhookEvent,
  type StripeEventPayload,
  type StripeWebhookDeps,
} from '../../../backend/services/payments/stripeWebhookService';

export const config = { api: { bodyParser: false } };

const PROVIDER = 'stripe';

function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
  });
}

function getWebhookSecret(): string {
  const v = process.env.STRIPE_WEBHOOK_SECRET;
  if (!v) throw new Error('missing_STRIPE_WEBHOOK_SECRET');
  return v;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  let rawBody: string;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'invalid_body' });
  }

  const sigHeader = String(req.headers['stripe-signature'] ?? '');
  let secret: string;
  try { secret = getWebhookSecret(); }
  catch { return res.status(500).json({ error: 'webhook_secret_unconfigured' }); }

  const verify = verifyStripeWebhookSignature({ rawBody, signatureHeader: sigHeader, secret });
  if (!verify.ok) {
    const reason = (verify as { ok: false; reason: string }).reason;
    return res.status(400).json({ error: 'invalid_signature', reason });
  }

  let event: StripeEventPayload;
  try {
    event = JSON.parse(rawBody) as StripeEventPayload;
  } catch {
    return res.status(400).json({ error: 'invalid_json' });
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
    findPurchaseByProviderEventId: async (providerEventId) => {
      const { data } = await ownedDbTable('credit_purchases')
        .select('id, organization_id, status, fulfillment_status')
        .eq('provider', PROVIDER)
        .or(`provider_event_id.eq.${providerEventId},provider_payment_id.eq.${providerEventId},provider_order_id.eq.${providerEventId}`)
        .maybeSingle();
      if (!data) return null;
      const row = data as { id: string; organization_id: string; status: string; fulfillment_status: string | null };
      return { id: row.id, organization_id: row.organization_id, status: row.status, fulfillment_status: row.fulfillment_status };
    },
    completePurchase: async (purchaseId, referenceId) => {
      const r = await completePurchase(purchaseId, referenceId);
      if (r.success) return { success: true, purchaseId: r.purchaseId, creditsGranted: r.creditsGranted };
      const failure = r as { success: false; reason: string };
      return { success: false, reason: failure.reason };
    },
    failPurchase: async (purchaseId, referenceId) => {
      await failPurchase(purchaseId, referenceId);
    },
    recordPaymentTransaction: async (input) => {
      const { error } = await ownedDbTable('payment_transactions').insert({
        organization_id: input.organizationId,
        provider: PROVIDER,
        provider_transaction_id: input.providerTransactionId,
        amount:      input.amount,
        fee_amount:  input.fee,
        net_amount:  input.net,
        currency:    input.currency,
        status:      input.status,
        occurred_at: input.occurredAt,
        metadata: {
          ...input.metadata,
          payment_intent_id: input.paymentIntentId,
          invoice_id:        input.invoiceId,
          subscription_id:   input.subscriptionId,
        },
      });
      if (!error) return { inserted: true, duplicate: false };
      const code = (error as { code?: string }).code;
      if (code === '23505') return { inserted: false, duplicate: true };
      throw new Error(`payment_transactions insert failed: ${error.message}`);
    },
    markEvent: async (eventId, status, errorMsg) => {
      await ownedDbTable('payment_provider_events')
        .update({
          processing_status: status,
          processed_at: new Date().toISOString(),
          error_message: errorMsg ?? null,
        })
        .eq('id', eventId);
    },
  };

  try {
    const outcome = await processStripeWebhookEvent(event, deps);
    return res.status(200).json(outcome);
  } catch (err) {
    return res.status(500).json({ error: 'webhook_processing_failed', message: err instanceof Error ? err.message : 'unknown' });
  }
}
