/**
 * Payment orchestrator — canonical contracts.
 *
 * Provider-agnostic types shared by the registry, router, adapters, webhooks,
 * and the orchestrator. New providers (Stripe, PayPal) implement these without
 * any architecture change. Test/sandbox only — no live charging here.
 */

export type PaymentProviderId = 'razorpay' | 'cashfree' | 'stripe' | 'paypal';
export type ProviderMode = 'test' | 'live';

/** Section A — canonical provider model. */
export interface PaymentProvider {
  provider_id: PaymentProviderId;
  provider_name: string;
  enabled: boolean;
  priority: number; // lower = higher precedence
  supported_currencies: string[]; // ISO 4217, uppercase
  supported_payment_methods: string[];
  mode: ProviderMode;
}

/** Section E — canonical order model. */
export interface CanonicalOrder {
  provider: PaymentProviderId;
  currency: string;
  amount: number; // major units (e.g. INR rupees)
  amountSubunits: number; // minor units (e.g. paise)
  reference_id: string;
  organization_id: string;
  status: OrderStatus;
  providerOrderId?: string;
  /** Provider-specific token needed by the client SDK (e.g. Cashfree session). */
  clientToken?: string;
  raw?: unknown;
}

export type OrderStatus = 'created' | 'pending' | 'paid' | 'failed';

export interface OrderRequest {
  currency: string;
  amount: number; // major units
  reference_id: string;
  organization_id: string;
}

export interface VerifyRequest {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface VerifyResult {
  verified: boolean;
  status: OrderStatus;
  raw?: unknown;
}

/** Common adapter shape — every provider returns the same shapes. */
export interface PaymentAdapter {
  readonly providerId: PaymentProviderId;
  /** True when required test credentials are present. */
  isConfigured(): boolean;
  createOrder(req: OrderRequest): Promise<CanonicalOrder>;
  verifyPayment(req: VerifyRequest): Promise<VerifyResult>;
  /** Verify a webhook payload signature (no side effects). */
  verifyWebhookSignature(rawBody: string, signature: string, extra?: Record<string, string>): boolean;
}

/** Section F — webhook handler shape. Verifies + records only; no billing. */
export interface WebhookVerifyResult {
  verified: boolean;
  eventId: string | null;
  eventType: string | null;
  recorded: boolean;
}

export interface WebhookHandler {
  readonly providerId: PaymentProviderId;
  verifyAndRecord(rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult>;
}
