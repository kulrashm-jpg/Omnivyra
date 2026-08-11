/**
 * RazorpayAdapter — test/sandbox. Provider-level (amount + currency), not
 * billing-coupled. Returns the canonical adapter shapes.
 */
import crypto from 'crypto';
import type {
  PaymentAdapter, OrderRequest, CanonicalOrder, VerifyRequest, VerifyResult, ProviderOrderOutcome,
} from './types';
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

  /**
   * Authoritative order outcome, straight from Razorpay — no client input.
   *
   * Razorpay's order object carries `status` ('created' | 'attempted' | 'paid')
   * and `amount_paid`. `paid` is the only state that means funds were captured;
   * `attempted` means a payment was tried and did NOT succeed. Any transport or
   * credential problem resolves to `unknown` so callers never treat an outage
   * as "customer did not pay".
   */
  async fetchOrderOutcome(providerOrderId: string): Promise<ProviderOrderOutcome> {
    const { keyId, keySecret } = getProviderCredentials('razorpay');
    if (!keyId || !keySecret) return { outcome: 'unknown', reason: 'razorpay_not_configured' };
    if (!providerOrderId) return { outcome: 'unknown', reason: 'missing_provider_order_id' };

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    let body: any;
    try {
      const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(providerOrderId)}`, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
      });
      body = await res.json();
      if (!res.ok) {
        return { outcome: 'unknown', reason: `razorpay_order_fetch_failed:${body?.error?.description ?? res.status}` };
      }
    } catch (err) {
      return { outcome: 'unknown', reason: `razorpay_order_fetch_error:${err instanceof Error ? err.message : String(err)}` };
    }

    const rawStatus = String(body?.status ?? '');
    if (rawStatus !== 'paid') {
      return { outcome: 'unpaid', providerRawStatus: rawStatus };
    }

    // Paid — resolve the CAPTURED payment so fulfillment carries a real provider
    // reference AND the authoritative amount/currency the financial validator
    // needs. `status === 'paid'` on the order alone is deliberately not enough:
    // without the captured entity we cannot state what was actually taken, and
    // the validator must then treat it as UNKNOWN rather than grant.
    let providerPaymentId: string | undefined;
    let providerAmountSubunits: number | undefined;
    let providerCurrency: string | undefined;
    try {
      const pres = await fetch(`${API_BASE}/orders/${encodeURIComponent(providerOrderId)}/payments`, {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
      });
      if (pres.ok) {
        const plist = (await pres.json()) as any;
        const captured = (plist?.items ?? []).find((p: any) => p?.status === 'captured');
        if (captured?.id) providerPaymentId = String(captured.id);
        // Razorpay reports payment amounts in minor units already.
        if (Number.isFinite(Number(captured?.amount))) providerAmountSubunits = Number(captured.amount);
        if (typeof captured?.currency === 'string' && captured.currency) {
          providerCurrency = String(captured.currency).toUpperCase();
        }
      }
    } catch { /* financials stay undefined → validator resolves UNKNOWN */ }

    return {
      outcome: 'paid',
      providerPaymentId,
      providerAmountSubunits,
      providerCurrency,
      providerRawStatus: rawStatus,
    };
  }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
