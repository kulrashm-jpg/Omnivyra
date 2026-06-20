/**
 * Section F — webhook foundation. Provider-specific handlers that VERIFY the
 * signature and RECORD the event only. No credit allocation, no billing actions.
 */
import type { WebhookHandler, WebhookVerifyResult, PaymentProviderId } from './types';
import { recordPaymentProviderEvent } from '../../purchaseService';
import { RazorpayAdapter } from './razorpayAdapter';
import { CashfreeAdapter } from './cashfreeAdapter';

const razorpay = new RazorpayAdapter();
const cashfree = new CashfreeAdapter();

const DENY: WebhookVerifyResult = { verified: false, eventId: null, eventType: null, recorded: false };

export class RazorpayWebhookHandler implements WebhookHandler {
  readonly providerId = 'razorpay' as const;

  async verifyAndRecord(rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult> {
    const signature = headers['x-razorpay-signature'] ?? '';
    if (!razorpay.verifyWebhookSignature(rawBody, signature)) return DENY;

    const evt = safeParse(rawBody);
    const eventId = evt?.payload?.payment?.entity?.id ?? headers['x-razorpay-event-id'] ?? `rzp_${rawBody.length}`;
    const eventType = evt?.event ?? 'unknown';
    const rec = await recordPaymentProviderEvent({
      provider: 'razorpay', providerEventId: String(eventId), eventType: String(eventType), payload: evt ?? {},
    });
    return { verified: true, eventId: String(eventId), eventType: String(eventType), recorded: Boolean(rec.id) || rec.duplicate };
  }
}

export class CashfreeWebhookHandler implements WebhookHandler {
  readonly providerId = 'cashfree' as const;

  async verifyAndRecord(rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult> {
    const signature = headers['x-webhook-signature'] ?? '';
    const timestamp = headers['x-webhook-timestamp'] ?? '';
    if (!cashfree.verifyWebhookSignature(rawBody, signature, { timestamp })) return DENY;

    const evt = safeParse(rawBody);
    const eventId = evt?.data?.order?.order_id ?? evt?.data?.payment?.cf_payment_id ?? `cf_${rawBody.length}`;
    const eventType = evt?.type ?? 'unknown';
    const rec = await recordPaymentProviderEvent({
      provider: 'cashfree', providerEventId: String(eventId), eventType: String(eventType), payload: evt ?? {},
    });
    return { verified: true, eventId: String(eventId), eventType: String(eventType), recorded: Boolean(rec.id) || rec.duplicate };
  }
}

const HANDLERS: Partial<Record<PaymentProviderId, WebhookHandler>> = {
  razorpay: new RazorpayWebhookHandler(),
  cashfree: new CashfreeWebhookHandler(),
};

export function getWebhookHandler(id: PaymentProviderId): WebhookHandler | undefined {
  return HANDLERS[id];
}

export function getRegisteredWebhookProviders(): PaymentProviderId[] {
  return Object.keys(HANDLERS) as PaymentProviderId[];
}

function safeParse(s: string): any {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}
