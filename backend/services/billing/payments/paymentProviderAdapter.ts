/**
 * Payment Provider Adapter — Phase E
 *
 * Provider-agnostic interface for payment gateways. The existing Razorpay
 * staging service today is gateway-specific; this adapter defines the
 * generalized contract that future providers (Stripe, Adyen, etc.) plug
 * into. Stripe live-mode work is Sprint 4+ scope per the audit roadmap.
 *
 * Current state:
 *   - Razorpay adapter is "registered" but routed to the existing
 *     razorpayStagingService — keeps behavior identical.
 *   - Stripe adapter slot is reserved with a clear "not implemented" return
 *     so callers can detect and report instead of falling through silently.
 *
 * The orchestrator + ledger code never imports a specific provider — they
 * import this adapter and dispatch on `provider`.
 */

import { logger } from '../../logger';

export type SupportedProvider = 'razorpay' | 'stripe';

export interface CheckoutSessionRequest {
  provider:           SupportedProvider;
  organizationId:     string;
  amount:             number;
  currency:           string;
  description?:       string;
  metadata?:          Record<string, unknown>;
  successUrl?:        string;
  cancelUrl?:         string;
  creditPackageId?:   string;
  initiatedByUserId:  string;
}

export interface CheckoutSessionResult {
  ok:           boolean;
  provider:     SupportedProvider;
  sessionId?:   string;
  paymentIntentId?: string;
  redirectUrl?: string;
  amount:       number;
  currency:     string;
  raw?:         unknown;
  error?:       string;
  code?:        'NOT_IMPLEMENTED' | 'PROVIDER_ERROR' | 'VALIDATION';
}

export interface WebhookEventInput {
  provider:        SupportedProvider;
  providerEventId: string;
  eventType:       string;
  payload:         Record<string, unknown>;
  signature?:      string;
  rawBody?:        string;
}

export interface WebhookProcessingResult {
  ok:        boolean;
  status:    'processed' | 'duplicate' | 'ignored' | 'invalid_signature' | 'error';
  message?:  string;
}

/** Adapter registry. */
const adapters: Partial<Record<SupportedProvider, PaymentProviderAdapter>> = {};

export interface PaymentProviderAdapter {
  createCheckoutSession(req: CheckoutSessionRequest): Promise<CheckoutSessionResult>;
  handleWebhook(input: WebhookEventInput): Promise<WebhookProcessingResult>;
  describe(): { name: SupportedProvider; mode: 'test' | 'live' | 'unknown'; capabilities: string[] };
}

export function registerProviderAdapter(provider: SupportedProvider, adapter: PaymentProviderAdapter): void {
  adapters[provider] = adapter;
  logger.info('payment_provider_registered', {
    provider,
    capabilities: adapter.describe().capabilities,
  });
}

export function getProviderAdapter(provider: SupportedProvider): PaymentProviderAdapter | null {
  return adapters[provider] ?? null;
}

export async function dispatchCheckout(req: CheckoutSessionRequest): Promise<CheckoutSessionResult> {
  const adapter = getProviderAdapter(req.provider);
  if (!adapter) {
    return {
      ok: false, provider: req.provider, amount: req.amount, currency: req.currency,
      error: `Provider ${req.provider} not registered`, code: 'NOT_IMPLEMENTED',
    };
  }
  return adapter.createCheckoutSession(req);
}

export async function dispatchWebhook(input: WebhookEventInput): Promise<WebhookProcessingResult> {
  const adapter = getProviderAdapter(input.provider);
  if (!adapter) {
    return { ok: false, status: 'ignored', message: `Provider ${input.provider} not registered` };
  }
  return adapter.handleWebhook(input);
}

// ── Default registrations ─────────────────────────────────────────────────────
// Stripe is intentionally a stub — production rollout is Sprint 4+ scope.
registerProviderAdapter('stripe', {
  describe: () => ({ name: 'stripe', mode: 'unknown', capabilities: ['stub'] }),
  createCheckoutSession: async (req) => ({
    ok: false, provider: 'stripe', amount: req.amount, currency: req.currency,
    error: 'Stripe adapter is not yet implemented (Phase 2 reserves the slot)',
    code: 'NOT_IMPLEMENTED',
  }),
  handleWebhook: async () => ({ ok: false, status: 'ignored', message: 'Stripe adapter not implemented' }),
});

registerProviderAdapter('razorpay', {
  describe: () => ({ name: 'razorpay', mode: 'test', capabilities: ['checkout', 'webhook', 'staging-only'] }),
  createCheckoutSession: async (req) => {
    try {
      const svc = await import('../../payments/razorpayStagingService');
      const fn = (svc as { createRazorpayStagingCreditOrder?: (a: unknown) => Promise<unknown> })
        .createRazorpayStagingCreditOrder;
      if (typeof fn !== 'function') {
        return { ok: false, provider: 'razorpay', amount: req.amount, currency: req.currency,
                 error: 'razorpayStagingService missing createRazorpayStagingCreditOrder export', code: 'PROVIDER_ERROR' };
      }
      const raw = await fn({
        organizationId:   req.organizationId,
        amount:           req.amount,
        currency:         req.currency,
        creditPackageId:  req.creditPackageId,
        initiatedByUserId: req.initiatedByUserId,
        metadata:         req.metadata,
      });
      const obj = (raw as Record<string, unknown> | null) ?? {};
      return {
        ok: true, provider: 'razorpay', amount: req.amount, currency: req.currency,
        sessionId:    String(obj.order_id ?? obj.id ?? ''),
        redirectUrl:  obj.checkout_url ? String(obj.checkout_url) : undefined,
        raw,
      };
    } catch (err: unknown) {
      return { ok: false, provider: 'razorpay', amount: req.amount, currency: req.currency,
               error: err instanceof Error ? err.message : String(err), code: 'PROVIDER_ERROR' };
    }
  },
  handleWebhook: async (input) => {
    try {
      const svc = await import('../../payments/razorpayStagingService');
      const fn = (svc as { handleRazorpayStagingWebhook?: (a: unknown) => Promise<unknown> })
        .handleRazorpayStagingWebhook;
      if (typeof fn !== 'function') {
        return { ok: false, status: 'error', message: 'razorpayStagingService missing handleRazorpayStagingWebhook export' };
      }
      const raw = await fn({
        providerEventId: input.providerEventId,
        eventType:       input.eventType,
        payload:         input.payload,
        signature:       input.signature,
        rawBody:         input.rawBody,
      });
      const obj = (raw as Record<string, unknown> | null) ?? {};
      const status = String(obj.status ?? 'processed') as WebhookProcessingResult['status'];
      return { ok: true, status, message: typeof obj.message === 'string' ? obj.message : undefined };
    } catch (err: unknown) {
      return { ok: false, status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  },
});
