import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/billing/checkout/verify
 *   { org_id, purchase_id, provider, order_id, payment_id, signature }
 *
 * Verify a payment via the Payment Orchestrator and settle the purchase.
 *
 * THIS ROUTE ALLOCATES CREDITS. (The original Phase-1 header said it did not;
 * that stopped being true when P1 routed settlement through
 * `fulfillProviderConfirmedPurchase`, and the stale text is corrected here
 * rather than left to mislead a reviewer into thinking no money moves.)
 *
 * On a provider-verified success it calls `fulfillProviderConfirmedPurchase`
 * (which grants via the idempotent `completePurchase` → `createCredit` path)
 * and then `generateTopupInvoice`.
 *
 * Provider-authoritative: the client's claim is never the deciding evidence. A
 * FAILED verification is treated as a client-side signal and routed through
 * `closePurchaseFromClient`, which asks the provider first — so if the gateway
 * actually captured the payment this FULFILLS instead of failing.
 *
 * Duplicate/concurrent settlement cannot double-credit. Two guards, the outer
 * one enforced by Postgres:
 *   1. CAS — the pending → completed flip is `.eq('status','pending')`, so only
 *      one caller can perform it; a loser gets `already_completed`.
 *   2. `createCredit` uses a deterministic idempotency key
 *      (org + 'credit_purchase' + purchaseId) and `credit_transactions` carries
 *      UNIQUE INDEX `credit_transactions_idempotency_key_lockdown_unique`, so a
 *      second insert is rejected by the database, not merely by application code.
 * `generateTopupInvoice` is likewise idempotent (deterministic number + UNIQUE).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../../backend/middleware/withOrgAccess';
import { logger } from '../../../../backend/services/logger';
import { supabase } from '@/backend/db/supabaseClient';
import { verifyPayment } from '@/backend/services/payments/orchestrator';
import type { PaymentProviderId } from '@/backend/services/payments/orchestrator';
import { generateTopupInvoice } from '@/backend/services/billing/topupInvoiceService';
import {
  closePurchaseFromClient,
  fulfillProviderConfirmedPurchase,
} from '@/backend/services/billing/purchaseClosureService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {});
  const organizationId = String(body.org_id ?? body.organization_id ?? '').trim();
  const purchaseId = String(body.purchase_id ?? '').trim();
  const provider = String(body.provider ?? 'razorpay').trim() as PaymentProviderId;
  const orderId = String(body.razorpay_order_id ?? body.order_id ?? '').trim();
  const paymentId = String(body.razorpay_payment_id ?? body.payment_id ?? '').trim();
  const signature = String(body.razorpay_signature ?? body.signature ?? '').trim();
  if (!organizationId || !purchaseId) return res.status(400).json({ error: 'org_id and purchase_id are required' });

  // Ownership guard: the purchase must belong to this org.
  const { data: purchase } = await supabase
    .from('credit_purchases')
    .select('id, organization_id, status, provider, provider_order_id')
    .eq('id', purchaseId)
    .maybeSingle();
  if (!purchase || (purchase as any).organization_id !== organizationId) {
    return res.status(404).json({ error: 'purchase_not_found' });
  }

  const result = await verifyPayment(provider, {
    providerOrderId: orderId || (purchase as any).provider_order_id,
    providerPaymentId: paymentId,
    signature,
  });

  if (!result.verified) {
    // P1: a failed verification is a CLIENT-side signal (bad/absent signature),
    // so it goes through the provider-authoritative closure rather than a blind
    // failPurchase. If the provider actually captured the payment, this
    // fulfills instead of failing — provider truth beats client claim.
    logger.warn('payment_failed', {
      organizationId, purchaseId, provider, source: 'verify_signature_rejected',
    });
    const closure = await closePurchaseFromClient({
      purchaseId, organizationId, reason: 'client_reported_failure',
    });
    if (closure.action === 'fulfilled') {
      return res.status(200).json({
        ok: true, purchase_id: purchaseId, status: 'paid',
        fulfillment_status: 'fulfilled', provider, recovered: true,
      });
    }
    return res.status(400).json({
      ok: false, purchase_id: purchaseId, status: 'failed', provider, action: closure.action,
    });
  }

  // Payment verified (paid) → allocate into the top-up (paid) pool via the
  // existing idempotent fulfillment. Duplicate verify/webhook/retry → one grant.
  // Reopen-safe: if an expiry sweep closed this row moments earlier, a genuine
  // provider-verified success still fulfills.
  const fulfillment = await fulfillProviderConfirmedPurchase(purchaseId, paymentId || undefined);
  if (!fulfillment.ok) {
    const reason = fulfillment.detail ?? 'fulfillment_failed';
    logger.error('checkout_fulfillment_failed', { organizationId, purchaseId, reason });
    return res.status(500).json({
      ok: false, purchase_id: purchaseId, status: 'paid', fulfillment_status: 'failed', error: reason,
    });
  }

  // Read back the invoice number for the response. Fulfillment already
  // generated it; generateTopupInvoice is idempotent (deterministic number +
  // UNIQUE), so this call returns the existing one rather than a second invoice.
  let invoiceNumber: string | null = null;
  try { invoiceNumber = (await generateTopupInvoice(purchaseId))?.invoiceNumber ?? null; }
  catch (e: any) { logger.warn('checkout_invoice_failed', { purchaseId, message: e?.message }); }

  return res.status(200).json({
    ok: true,
    purchase_id: purchaseId,
    status: 'paid',
    fulfillment_status: 'fulfilled',
    credits_granted: fulfillment.creditsGranted,
    invoice_number: invoiceNumber,
    provider,
  });
}

export default __createApiRoute(withOrgAccess(handler), { route: '/api/billing/checkout/verify' });
