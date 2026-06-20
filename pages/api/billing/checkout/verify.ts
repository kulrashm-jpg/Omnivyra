/**
 * POST /api/billing/checkout/verify
 *   { org_id, purchase_id, provider, order_id, payment_id, signature }
 *
 * Checkout Phase 1 — verify a payment via the Payment Orchestrator and update
 * the purchase record (pending → paid | failed). INR / test.
 *
 * Does NOT allocate credits and does NOT touch the wallet. Record update only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withOrgAccess } from '../../../../backend/middleware/withOrgAccess';
import { logger } from '../../../../backend/services/logger';
import { supabase } from '@/backend/db/supabaseClient';
import { verifyPayment } from '@/backend/services/payments/orchestrator';
import type { PaymentProviderId } from '@/backend/services/payments/orchestrator';
import { completePurchase, failPurchase } from '@/backend/services/purchaseService';
import { generateTopupInvoice } from '@/backend/services/billing/topupInvoiceService';

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
    await failPurchase(purchaseId, paymentId || undefined);
    logger.warn('checkout_verify_failed', { organizationId, purchaseId, provider });
    return res.status(400).json({ ok: false, purchase_id: purchaseId, status: 'failed', provider });
  }

  // Payment verified (paid) → allocate into the top-up (paid) pool via the
  // existing idempotent fulfillment. Duplicate verify/webhook/retry → one grant.
  const fulfillment = await completePurchase(purchaseId, paymentId || undefined);
  if (!fulfillment.success) {
    const reason = (fulfillment as any).reason ?? (fulfillment as any).detail ?? 'fulfillment_failed';
    logger.error('checkout_fulfillment_failed', { organizationId, purchaseId, reason });
    return res.status(500).json({
      ok: false, purchase_id: purchaseId, status: 'paid', fulfillment_status: 'failed', error: reason,
    });
  }

  // Generate the invoice (idempotent; best-effort — never blocks fulfillment).
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

export default withOrgAccess(handler);
