/**
 * RazorpayAdapter — test/sandbox. Provider-level (amount + currency), not
 * billing-coupled. Returns the canonical adapter shapes.
 */
import crypto from 'crypto';
import type { PaymentAdapter, OrderRequest, CanonicalOrder, VerifyRequest, VerifyResult } from './types';
import { getProviderCredentials, isProviderConfigured, getActiveMode } from './providerConfig';

const API_BASE = 'https://api.razorpay.com/v1';

function toSubunits(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

export class RazorpayAdapter implements PaymentAdapter {
  readonly providerId = 'razorpay' as const;

  isConfigured(): boolean {
    return isProviderConfigured('razorpay');
  }

  async createOrder(req: OrderRequest): Promise<CanonicalOrder> {
    const { keyId, keySecret } = getProviderCredentials('razorpay');
    if (!keyId || !keySecret) throw new Error('razorpay_not_configured');
    // Live keys are only permitted when live mode is explicitly active.
    if (getActiveMode() === 'test' && keyId.startsWith('rzp_live_')) throw new Error('razorpay_live_key_rejected_in_test_mode');

    const amountSubunits = toSubunits(req.amount);
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountSubunits,
        currency: req.currency,
        receipt: req.reference_id,
        notes: { organization_id: req.organization_id },
      }),
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`razorpay_order_failed:${body?.error?.description ?? res.status}`);

    return {
      provider: 'razorpay',
      currency: req.currency,
      amount: req.amount,
      amountSubunits,
      reference_id: req.reference_id,
      organization_id: req.organization_id,
      status: 'created',
      providerOrderId: body.id,
      raw: body,
    };
  }

  async verifyPayment(req: VerifyRequest): Promise<VerifyResult> {
    const { keySecret } = getProviderCredentials('razorpay');
    if (!keySecret) throw new Error('razorpay_not_configured');
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${req.providerOrderId}|${req.providerPaymentId}`)
      .digest('hex');
    const verified = safeEqual(expected, req.signature);
    return { verified, status: verified ? 'paid' : 'failed' };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const { webhookSecret } = getProviderCredentials('razorpay');
    if (!webhookSecret) return false;
    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
