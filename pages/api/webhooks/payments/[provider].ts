import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/webhooks/payments/:provider   (razorpay | cashfree)
 *
 * Provider webhooks via the Payment Orchestrator.
 *
 * THIS ROUTE ALLOCATES CREDITS. (The original Phase-1 header said it recorded
 * the event only; that stopped being true when P1 added fulfilment here, and
 * the stale text is corrected rather than left to mislead a reviewer into
 * believing no money moves on this path.)
 *
 * The signature is verified FIRST and an unverified event is rejected 401
 * before anything else happens — an unauthenticated payload can never reach
 * allocation. Only a verified SUCCESS that matches a local purchase by
 * `provider_order_id` proceeds to `fulfillProviderConfirmedPurchase`.
 *
 * Duplicate deliveries and replays are harmless. Three layers:
 *   1. An already-settled purchase (status + fulfillment_status both
 *      'completed') short-circuits as `payment_webhook_duplicate` — no second
 *      grant.
 *   2. CAS — the pending → completed flip is `.eq('status','pending')`.
 *   3. `credit_transactions` carries UNIQUE INDEX
 *      `credit_transactions_idempotency_key_lockdown_unique`, and the key is
 *      derived deterministically from the purchase, so a concurrent second
 *      insert is rejected by Postgres rather than by application code.
 *
 * A verified success with NO local purchase is never silently absorbed and
 * never creates a purchase: it is logged at ERROR as
 * `payment_webhook_unmatched_order`, because it may be money taken without a
 * record.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { handleWebhook } from '@/backend/services/payments/orchestrator';
import type { PaymentProviderId } from '@/backend/services/payments/orchestrator';
import { logger } from '@/backend/services/logger';
import { supabase } from '@/backend/db/supabaseClient';
import { fulfillProviderConfirmedPurchase } from '@/backend/services/billing/purchaseClosureService';
import { markPaymentEventState, readPaymentEventState } from '@/backend/services/payments/paymentEventState';

function safeParse(s: string): any {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/** Extract (order_id, payment_id) from a SUCCESS webhook, else null. */
interface WebhookSuccess {
  orderId: string;
  paymentId: string;
  /** Minor units, as stated by the provider in the signature-verified payload. */
  amountSubunits?: number;
  currency?: string;
}

/**
 * Extract the settlement facts from a SUCCESS payload.
 *
 * Amount and currency are carried through deliberately: they previously were
 * not, so nothing downstream could tell a ₹1 capture from a ₹2,520 one. The
 * payload is safe to read for this because the HMAC over the raw body has
 * already been verified — these are the provider's own figures, not a client's.
 * Anything absent stays `undefined`, and the financial validator then blocks
 * fulfillment as UNKNOWN rather than guessing.
 */
function extractSuccess(provider: PaymentProviderId, evt: any): WebhookSuccess | null {
  if (provider === 'razorpay') {
    if (evt?.event !== 'payment.captured') return null;
    const e = evt?.payload?.payment?.entity ?? {};
    if (!e.order_id) return null;
    return {
      orderId: String(e.order_id),
      paymentId: String(e.id ?? ''),
      // Razorpay states payment amounts in minor units already.
      amountSubunits: Number.isFinite(Number(e.amount)) ? Number(e.amount) : undefined,
      currency: typeof e.currency === 'string' && e.currency ? String(e.currency).toUpperCase() : undefined,
    };
  }
  // cashfree
  if (!String(evt?.type ?? '').toUpperCase().includes('SUCCESS')) return null;
  const orderId = evt?.data?.order?.order_id;
  if (!orderId) return null;
  // Cashfree states order amounts in MAJOR units → convert to minor.
  const cfAmount = Number(evt?.data?.order?.order_amount);
  const cfCurrency = evt?.data?.order?.order_currency;
  return {
    orderId: String(orderId),
    paymentId: String(evt?.data?.payment?.cf_payment_id ?? ''),
    amountSubunits: Number.isFinite(cfAmount) ? Math.round(cfAmount * 100) : undefined,
    currency: typeof cfCurrency === 'string' && cfCurrency ? String(cfCurrency).toUpperCase() : undefined,
  };
}

// Raw body required for signature verification.
export const config = { api: { bodyParser: false } };

function readRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();
  const provider = String(req.query.provider ?? '').trim() as PaymentProviderId;
  if (provider !== 'razorpay' && provider !== 'cashfree') return res.status(404).json({ error: 'unknown_provider' });

  try {
    const raw = await readRawBody(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v ?? '');

    const result = await handleWebhook(provider, raw, headers);
    if (!result.verified) {
      logger.warn('payment_webhook_rejected', { provider, reason: 'signature_invalid' });
      return res.status(401).json({ ok: false, error: 'signature_invalid' });
    }

    logger.info('payment_webhook_received', {
      provider, eventId: result.eventId, eventType: result.eventType, recorded: result.recorded,
    });

    // 20270217000003 (e9): the event's STATE lives in payment_provider_event_state,
    // written by the guarded forward-only RPC. A redelivery of an event whose money
    // action FAILED is reprocessed: failed -> requeued first (failed -> processed is
    // not a legal transition). Bookkeeping writes never fail the webhook.
    const rowId = result.eventRowId ?? null;
    if (rowId && (await readPaymentEventState(rowId)) === 'failed') {
      await markPaymentEventState(rowId, 'requeued');
    }
    const settle = async (status: 'processed' | 'failed', reason?: string) => {
      if (rowId) await markPaymentEventState(rowId, status, reason ?? null);
    };

    // On a verified SUCCESS event → allocate via the idempotent fulfillment
    // (top-up paid pool). Duplicate webhooks / verify races resolve to one grant.
    let allocated = false;
    const success = extractSuccess(provider, safeParse(raw));
    if (!success) await settle('processed', `ignored:${result.eventType ?? 'unknown'}`);
    if (success) {
      const { data: purchase, error: purchaseErr } = await supabase
        .from('credit_purchases')
        .select('id, status, fulfillment_status')
        .eq('provider_order_id', success.orderId)
        .maybeSingle();
      if (purchaseErr) {
        // MONEY: a failed read is not "no purchase" - answer non-2xx so the provider redelivers.
        logger.error('payment_webhook_purchase_lookup_failed', { provider, eventId: result.eventId, message: purchaseErr.message });
        await settle('failed', 'purchase_lookup_error');
        return res.status(500).json({ ok: false, error: 'webhook_money_action_failed', retryable: true });
      }
      if (purchase) {
        const alreadyFulfilled = (purchase as any).status === 'completed'
          && (purchase as any).fulfillment_status === 'completed';
        if (alreadyFulfilled) {
          // Verify (or an earlier delivery) already granted — this redelivery
          // is a no-op, not a second grant.
          logger.info('payment_webhook_duplicate', {
            provider, eventId: result.eventId, purchaseId: (purchase as any).id,
          });
          allocated = true;
          await settle('processed');
        } else {
          // P1: routed through fulfillProviderConfirmedPurchase rather than
          // completePurchase directly, so a purchase Omnivyra closed itself
          // (stale-pending expiry, client-reported failure) is REOPENED before
          // fulfillment. This is what stops "expired → late webhook → lost
          // payment". A provider-declined purchase carries no reopenable
          // marker and is still refused.
          // The provider's own amount/currency travel with the call so the
          // financial gate can compare them against the purchase before any
          // credit moves. A payload missing them resolves to UNKNOWN and is
          // blocked, not granted.
          const fulfillment = await fulfillProviderConfirmedPurchase(
            (purchase as any).id, success.paymentId || undefined,
            { amountSubunits: success.amountSubunits, currency: success.currency },
          );
          allocated = fulfillment.ok;
          if (fulfillment.ok) {
            await settle('processed');
          } else if (fulfillment.detail && TERMINAL_FULFILLMENT_DETAILS.has(fulfillment.detail)) {
            // An EXPLICITLY deterministic refusal (05): a retry cannot change it -
            // terminal, with the reason. Still logged at ERROR.
            logger.error('payment_webhook_fulfillment_blocked', {
              provider, eventId: result.eventId, purchaseId: (purchase as any).id,
              code: fulfillment.code ?? null, detail: fulfillment.detail,
            });
            await settle('processed', `blocked:${fulfillment.detail}`);
          } else {
            // MONEY (05, BLOCKING): EVERYTHING ELSE fails SAFE - record 'failed' and
            // answer NON-2xx so the provider redelivers. This includes the transient
            // grant failure ('error'), a provider we could not ASK (provider_unknown /
            // unreachable - NOT "not paid"), capture lag (provider_unpaid on a success
            // webhook), a financial gate that could not DETERMINE the amount, and any
            // new or renamed detail. Retrying a deterministic refusal is harmless (the
            // grant is idempotent); making a transient failure terminal loses a paid
            // customer's credits and discards the provider's retry.
            logger.error('payment_webhook_fulfillment_failed', {
              provider, eventId: result.eventId, purchaseId: (purchase as any).id,
              code: fulfillment.code ?? null, detail: fulfillment.detail ?? null,
            });
            await settle('failed', `fulfillment_${fulfillment.detail ?? 'unknown'}`);
            return res.status(500).json({ ok: false, error: 'webhook_money_action_failed', retryable: true });
          }
        }
      } else {
        // A verified success we cannot match to a local purchase is money we
        // may have taken without a record — never silent.
        logger.error('payment_webhook_unmatched_order', {
          provider, eventId: result.eventId, providerOrderId: success.orderId,
        });
        await settle('processed', 'unmatched_order');
      }
    }

    return res.status(200).json({ ok: true, recorded: result.recorded, event_id: result.eventId, event_type: result.eventType, allocated });
  } catch (err: any) {
    logger.error('checkout_webhook_failed', { provider, message: err?.message ?? 'unknown' });
    return res.status(500).json({ ok: false, error: 'webhook_error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
/**
 * 05 (2026-11-12): the ONLY fulfillment outcomes that are TERMINAL (a retry cannot
 * change them). Everything else defaults to failed + 500 + redelivery - the safe
 * direction for money. Keep this list EXPLICIT; never widen it by pattern.
 *   purchase_not_found, no_provider_reference, purchase_not_reopenable - the local
 *     purchase cannot be fulfilled by this event;
 *   provider_amount_differs, provider_currency_differs - the financial gate's
 *     DETERMINED mismatches (its 'UNKNOWN'-coded details mean "could not
 *     determine" and are retried);
 *   not_found, already_failed - completePurchase's deterministic refusals;
 *   already_completed - the status CAS lost to a concurrent completer, who grants.
 * WHY A RETRY WORKS AT ALL (05): completePurchase runs its status CAS only when the
 * purchase is still 'pending'; a completed-but-ungranted purchase SKIPS the CAS and
 * falls through to the idempotent grant (apply_credit_reservation's idempotency-key
 * pre-read; the key is a deterministic sha256 of the purchase). Making that CAS
 * unconditional would silently break every redelivery this route depends on.
 */
const TERMINAL_FULFILLMENT_DETAILS: ReadonlySet<string> = new Set([
  'purchase_not_found', 'no_provider_reference', 'purchase_not_reopenable',
  'provider_amount_differs', 'provider_currency_differs',
  'not_found', 'already_failed', 'already_completed',
]);

export default __createApiRoute(handler, { route: '/api/webhooks/payments/:provider' });
