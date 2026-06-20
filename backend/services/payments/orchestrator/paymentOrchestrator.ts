/**
 * Section B — paymentOrchestrator. Provider-agnostic entry point:
 * resolve provider (internal routing) → create order (with fallback/retry) →
 * verify payment → handle webhooks. No UI, no billing logic here.
 *
 * Test/sandbox only. Charges nothing by itself; delegates to test-gated adapters.
 */
import type { CanonicalOrder, OrderRequest, VerifyRequest, VerifyResult, WebhookVerifyResult, PaymentProvider, PaymentProviderId } from './types';
import { resolveProviders, resolvePrimaryProvider, PROVIDER_REGISTRY } from './providerRegistry';
import { getAdapter } from './adapters';
import { getWebhookHandler } from './webhookHandlers';
import { assertConfiguredProvidersOrThrow, validateConfiguredProviders, getActiveMode } from './providerConfig';

/** Section D — opt-in fail-fast init. Call from a gated startup, NOT bootstrap. */
export function initPaymentOrchestrator(): void {
  assertConfiguredProvidersOrThrow(PROVIDER_REGISTRY);
}

/** Section C — internal provider resolution. Never user-driven. */
export function resolveProviderForCurrency(currency: string): PaymentProvider | null {
  return resolvePrimaryProvider(currency);
}

export interface CreateOrderOutcome {
  order: CanonicalOrder | null;
  provider: PaymentProviderId | null;
  attempts: Array<{ provider: PaymentProviderId; ok: boolean; error?: string }>;
}

/**
 * Create an order with internal routing + fallback: try the primary provider,
 * fall through to the next usable provider on failure (Razorpay → Cashfree).
 */
export async function createOrder(req: OrderRequest, opts?: { retriesPerProvider?: number }): Promise<CreateOrderOutcome> {
  const candidates = resolveProviders(req.currency); // usable, priority-ordered
  const attempts: CreateOrderOutcome['attempts'] = [];
  if (candidates.length === 0) {
    return { order: null, provider: null, attempts };
  }
  const retries = Math.max(1, opts?.retriesPerProvider ?? 1);

  for (const provider of candidates) {
    const adapter = getAdapter(provider.provider_id);
    if (!adapter || !adapter.isConfigured()) {
      attempts.push({ provider: provider.provider_id, ok: false, error: 'not_configured' });
      continue;
    }
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const order = await adapter.createOrder(req);
        attempts.push({ provider: provider.provider_id, ok: true });
        return { order, provider: provider.provider_id, attempts };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        attempts.push({ provider: provider.provider_id, ok: false, error: msg });
        // last retry for this provider → fall through to next provider
      }
    }
  }
  return { order: null, provider: null, attempts };
}

export async function verifyPayment(provider: PaymentProviderId, req: VerifyRequest): Promise<VerifyResult> {
  const adapter = getAdapter(provider);
  if (!adapter) return { verified: false, status: 'failed' };
  return adapter.verifyPayment(req);
}

export async function handleWebhook(provider: PaymentProviderId, rawBody: string, headers: Record<string, string>): Promise<WebhookVerifyResult> {
  const handler = getWebhookHandler(provider);
  if (!handler) return { verified: false, eventId: null, eventType: null, recorded: false };
  return handler.verifyAndRecord(rawBody, headers);
}

/** Section G — non-mutating health/diagnostics snapshot. */
export function orchestratorHealth() {
  const mode = getActiveMode();
  const config = validateConfiguredProviders(PROVIDER_REGISTRY, mode);
  return {
    mode,
    providers: PROVIDER_REGISTRY.map((p) => ({
      provider_id: p.provider_id,
      enabled: p.enabled,
      priority: p.priority,
      mode: p.mode,
      currencies: p.supported_currencies,
      adapter: Boolean(getAdapter(p.provider_id)),
      webhook: Boolean(getWebhookHandler(p.provider_id)),
      configured: config.configured.includes(p.provider_id),
    })),
    routing: { INR: resolveProviders('INR', false).map((p) => p.provider_id) },
    config,
  };
}
