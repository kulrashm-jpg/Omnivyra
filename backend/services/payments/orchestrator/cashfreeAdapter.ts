/**
 * CashfreeAdapter — sandbox (test). Provider-level, common response shape.
 * Secondary/fallback provider for INR.
 */
import crypto from 'crypto';
import type { PaymentAdapter, OrderRequest, CanonicalOrder, VerifyRequest, VerifyResult } from './types';
import { getProviderCredentials, isProviderConfigured, getActiveMode } from './providerConfig';

const SANDBOX_BASE = 'https://sandbox.cashfree.com/pg';
const PROD_BASE = 'https://api.cashfree.com/pg';
const API_VERSION = '2023-08-01';

function baseUrl(): string {
  return getActiveMode() === 'live' ? PROD_BASE : SANDBOX_BASE;
}

function headers(appId: string, secret: string) {
  return {
    'x-client-id': appId,
    'x-client-secret': secret,
    'x-api-version': API_VERSION,
    'Content-Type': 'application/json',
  };
}

export class CashfreeAdapter implements PaymentAdapter {
  readonly providerId = 'cashfree' as const;

  isConfigured(): boolean {
    return isProviderConfigured('cashfree');
  }

  async createOrder(req: OrderRequest): Promise<CanonicalOrder> {
    const { keyId, keySecret } = getProviderCredentials('cashfree');
    if (!keyId || !keySecret) throw new Error('cashfree_not_configured');

    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: headers(keyId, keySecret),
      body: JSON.stringify({
        order_id: req.reference_id,
        order_amount: req.amount,
        order_currency: req.currency,
        customer_details: {
          customer_id: req.organization_id,
          customer_phone: '9999999999',
        },
      }),
    });
    const body = (await res.json()) as any;
    if (!res.ok) throw new Error(`cashfree_order_failed:${body?.message ?? res.status}`);

    return {
      provider: 'cashfree',
      currency: req.currency,
      amount: req.amount,
      amountSubunits: Math.round(req.amount * 100),
      reference_id: req.reference_id,
      organization_id: req.organization_id,
      status: 'created',
      providerOrderId: body.order_id ?? req.reference_id,
      clientToken: body.payment_session_id,
      raw: body,
    };
  }

  async verifyPayment(req: VerifyRequest): Promise<VerifyResult> {
    const { keyId, keySecret } = getProviderCredentials('cashfree');
    if (!keyId || !keySecret) throw new Error('cashfree_not_configured');

    // Cashfree is verified by fetching authoritative order status (no client signature).
    const res = await fetch(`${baseUrl()}/orders/${encodeURIComponent(req.providerOrderId)}`, {
      method: 'GET',
      headers: headers(keyId, keySecret),
    });
    const body = (await res.json()) as any;
    if (!res.ok) return { verified: false, status: 'failed', raw: body };
    const paid = String(body?.order_status).toUpperCase() === 'PAID';
    return { verified: paid, status: paid ? 'paid' : 'pending', raw: body };
  }

  verifyWebhookSignature(rawBody: string, signature: string, extra?: Record<string, string>): boolean {
    const { webhookSecret } = getProviderCredentials('cashfree');
    if (!webhookSecret) return false;
    // Cashfree: base64( HMAC-SHA256( timestamp + rawBody, secret ) )
    const timestamp = extra?.timestamp ?? '';
    const expected = crypto.createHmac('sha256', webhookSecret).update(timestamp + rawBody).digest('base64');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
