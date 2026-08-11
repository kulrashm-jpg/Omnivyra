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

/**
 * Authoritative, provider-side outcome for an order — asked of the PROVIDER,
 * never inferred from the client.
 *
 *   paid    — the provider confirms funds were captured for this order
 *   unpaid  — the provider confirms this order has NOT been paid
 *   unknown — we could not obtain an authoritative answer (network error,
 *             missing credentials, unsupported provider). MUST be treated as
 *             "do not close" — never as "unpaid".
 *
 * P1 uses this before any state closure (client-reported failure, stale-pending
 * expiry) so a provider-confirmed success always beats a client claim.
 */
export type ProviderOrderOutcomeKind = 'paid' | 'unpaid' | 'unknown';

export interface ProviderOrderOutcome {
  outcome: ProviderOrderOutcomeKind;
  /** Provider payment/transaction id when the outcome is `paid`. */
  providerPaymentId?: string;
  /** Provider's own status string, for logs/forensics. Never surfaced to users. */
  providerRawStatus?: string;
  /**
   * Amount the PROVIDER reports as captured, in minor units (paise/cents).
   * Minor units so the comparison is integer-exact — no float rounding.
   *
   * Present only when `outcome === 'paid'` AND the provider stated it
   * authoritatively. `undefined` means "not established", which the financial
   * validator treats as UNKNOWN and therefore blocks fulfillment — a provider
   * saying "paid" without a trustworthy amount is not sufficient to grant.
   */
  providerAmountSubunits?: number;
  /** ISO-4217 the provider reports for the capture. Same presence rule as above. */
  providerCurrency?: string;
  /** Populated when outcome is `unknown` — why we could not decide. */
  reason?: string;
}

/** Provider-stated financials handed to the validator by a settlement path. */
export interface ProviderFinancials {
  amountSubunits?: number | null;
  currency?: string | null;
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
  /**
   * Ask the provider for the authoritative outcome of an order, with no client
   * input. Optional: an adapter that cannot answer simply omits it and the
   * orchestrator resolves `unknown` (fail-safe: nothing gets closed).
   */
  fetchOrderOutcome?(providerOrderId: string): Promise<ProviderOrderOutcome>;
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
