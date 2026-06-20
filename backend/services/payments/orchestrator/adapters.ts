/**
 * Adapter registry — provider_id → adapter instance. Add Stripe/PayPal here.
 */
import type { PaymentAdapter, PaymentProviderId } from './types';
import { RazorpayAdapter } from './razorpayAdapter';
import { CashfreeAdapter } from './cashfreeAdapter';

const ADAPTERS: Partial<Record<PaymentProviderId, PaymentAdapter>> = {
  razorpay: new RazorpayAdapter(),
  cashfree: new CashfreeAdapter(),
};

export function getAdapter(id: PaymentProviderId): PaymentAdapter | undefined {
  return ADAPTERS[id];
}

export function getAllAdapters(): PaymentAdapter[] {
  return Object.values(ADAPTERS).filter(Boolean) as PaymentAdapter[];
}
