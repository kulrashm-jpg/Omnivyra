/**
 * Section A — canonical payment provider registry, and
 * Section C — internal currency-based routing with fallback.
 *
 * Razorpay = primary (priority 1), Cashfree = secondary (priority 2), both test
 * mode. New providers are added by appending a row — no architecture change.
 * Provider selection is INTERNAL; never exposed to or chosen by users.
 */
import type { PaymentProvider, PaymentProviderId } from './types';
import { isProviderConfigured } from './providerConfig';

export const PROVIDER_REGISTRY: PaymentProvider[] = [
  {
    provider_id: 'razorpay',
    provider_name: 'Razorpay',
    enabled: true,
    priority: 1,
    supported_currencies: ['INR'],
    supported_payment_methods: ['card', 'upi', 'netbanking', 'wallet'],
    mode: 'test',
  },
  {
    provider_id: 'cashfree',
    provider_name: 'Cashfree',
    enabled: true,
    priority: 2,
    supported_currencies: ['INR'],
    supported_payment_methods: ['card', 'upi', 'netbanking'],
    mode: 'test',
  },
  // Future: Stripe (USD/EUR), PayPal — append here; routing picks them up by currency.
];

/** Enabled providers, highest precedence first. */
export function getProviders(): PaymentProvider[] {
  return PROVIDER_REGISTRY.filter((p) => p.enabled).sort((a, b) => a.priority - b.priority);
}

export function getProvider(id: PaymentProviderId): PaymentProvider | undefined {
  return PROVIDER_REGISTRY.find((p) => p.provider_id === id);
}

/**
 * Ordered candidate providers for a currency (primary → fallbacks).
 * `requireConfigured` (default true) drops providers without credentials so the
 * orchestrator never routes to an unusable provider.
 */
export function resolveProviders(currency: string, requireConfigured = true): PaymentProvider[] {
  const cur = currency.toUpperCase();
  return getProviders().filter(
    (p) => p.supported_currencies.includes(cur) && (!requireConfigured || isProviderConfigured(p.provider_id)),
  );
}

/** Primary usable provider for a currency, or null if none. */
export function resolvePrimaryProvider(currency: string, requireConfigured = true): PaymentProvider | null {
  return resolveProviders(currency, requireConfigured)[0] ?? null;
}
