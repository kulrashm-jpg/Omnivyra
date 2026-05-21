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

import crypto from 'crypto';
import { logger } from '../../logger';

export type SupportedProvider = 'razorpay' | 'stripe' | 'cashfree' | 'phonepe';

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
  /** ISO-3166-1 alpha-2 — optional; consulted by the governance pre-check. */
  country?:           string;
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

  // Additive governance pre-check (migration 20260714). The resolver is
  // default-preserving: when payment_provider_config is absent it returns
  // compiled defaults, so behavior is unchanged where the table is unapplied.
  const { isProviderAvailableForCheckout } = await import('./paymentProviderPolicyResolver');
  const gate = await isProviderAvailableForCheckout(req.provider, {
    country: req.country ?? null,
    currency: req.currency ?? null,
  });
  if (!gate.ok) {
    const reason = (gate as { ok: false; reason: string }).reason;
    return {
      ok: false, provider: req.provider, amount: req.amount, currency: req.currency,
      error: `Provider ${req.provider} unavailable: ${reason}`, code: 'VALIDATION',
    };
  }

  return adapter.createCheckoutSession(req);
}

/**
 * Backend-authoritative checkout provider list. The (future) checkout UI MUST
 * call this rather than hardcoding providers — frontend never decides
 * availability/enablement. Re-exported from the policy resolver so callers
 * have one orchestration entry point. Carries NO pricing data.
 */
export { resolveAvailableProviders } from './paymentProviderPolicyResolver';
export type { ResolvedProviderList, ResolvedCheckoutProvider } from './paymentProviderPolicyResolver';

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

// ── Cashfree + PhonePe — SANDBOX-ONLY adapters ──────────────────────────────
// These adapters implement the provider contract for governance/orchestration
// integration. createCheckoutSession produces a DETERMINISTIC sandbox session
// LOCALLY — no network call, no live order, no settlement. handleWebhook is
// inert (webhook settlement is NOT activated). describe().mode is 'test'.
function makeSandboxAdapter(name: SupportedProvider, sandboxHost: string): PaymentProviderAdapter {
  return {
    describe: () => ({ name, mode: 'test', capabilities: ['checkout', 'sandbox-only'] }),
    createCheckoutSession: async (req) => {
      // Deterministic sandbox reference — same (org, package, amount) → same
      // ref, so a retried checkout reuses the sandbox session (idempotent).
      const ref = `${name}_sbx_${crypto
        .createHash('sha1')
        .update([req.organizationId, req.creditPackageId ?? '', String(req.amount)].join('|'))
        .digest('hex')
        .slice(0, 24)}`;
      return {
        ok: true,
        provider: name,
        amount: req.amount,
        currency: req.currency,
        sessionId: ref,
        redirectUrl: `https://${sandboxHost}/checkout/${ref}`,
        raw: { mode: 'sandbox', note: `${name} sandbox adapter — no live settlement` },
      };
    },
    handleWebhook: async () => ({
      ok: false,
      status: 'ignored',
      message: `${name} sandbox adapter — webhook settlement not activated`,
    }),
  };
}

registerProviderAdapter('cashfree', makeSandboxAdapter('cashfree', 'sandbox.cashfree.com'));
registerProviderAdapter('phonepe',  makeSandboxAdapter('phonepe',  'sandbox.phonepe.com'));
