/**
 * Currency & FX foundation — canonical USD catalog → multi-currency display.
 *
 * The catalog is priced in ONE canonical currency (USD). Display prices in INR
 * and EUR are DERIVED from USD via FX rates, with optional per-(sku,currency)
 * market overrides that win over the FX-derived value.
 *
 * Today FX rates + overrides are config defaults. They are structured so a
 * Super-Admin store can manage them later (rates, market overrides, founder /
 * regular pricing) without touching consumers — pass a resolved `FxConfig` in.
 *
 * Display/config only. This module charges nothing and selects no gateway.
 */

export type Currency = 'USD' | 'INR' | 'EUR';
export const CURRENCIES: Currency[] = ['USD', 'INR', 'EUR'];
export const CANONICAL_CURRENCY: Currency = 'USD';

export interface FxConfig {
  /** Units of the currency per 1 USD. USD must be 1. */
  rates: Record<Currency, number>;
  /** Optional explicit price per SKU per currency (major units) — wins over FX. */
  overrides?: Partial<Record<string, Partial<Record<Currency, number>>>>;
  /** ISO timestamp the rates were set (for display / audit). */
  updatedAt?: string;
}

/** Default FX (~mid-market). Super-Admin-overridable; not authoritative for billing. */
export const DEFAULT_FX: FxConfig = {
  rates: { USD: 1, INR: 84, EUR: 0.92 },
};

export function currencySymbol(c: Currency): string {
  return c === 'USD' ? '$' : c === 'EUR' ? '€' : '₹';
}

function roundRetail(value: number, currency: Currency): number {
  // INR → whole rupees; USD/EUR → 2 decimals. Super-Admin overrides give exact retail values.
  return currency === 'INR' ? Math.round(value) : Math.round(value * 100) / 100;
}

/**
 * Resolve a canonical USD price into `currency`. Order of precedence:
 * market override (sku) → FX-derived → USD passthrough.
 */
export function resolvePrice(
  canonicalUsd: number,
  currency: Currency,
  fx: FxConfig = DEFAULT_FX,
  sku?: string,
): number {
  const override = sku ? fx.overrides?.[sku]?.[currency] : undefined;
  if (override != null) return override;
  if (currency === CANONICAL_CURRENCY) return canonicalUsd;
  const rate = fx.rates[currency] ?? 1;
  return roundRetail(canonicalUsd * rate, currency);
}

export function formatPrice(
  canonicalUsd: number,
  currency: Currency,
  fx: FxConfig = DEFAULT_FX,
  sku?: string,
): string {
  const value = resolvePrice(canonicalUsd, currency, fx, sku);
  const locale = currency === 'INR' ? 'en-IN' : currency === 'EUR' ? 'de-DE' : 'en-US';
  return `${currencySymbol(currency)}${value.toLocaleString(locale)}`;
}

/**
 * Internal gateway routing (NOT customer-chosen). Currency → provider.
 * INR → Razorpay (wired). USD/EUR → Stripe (not yet integrated).
 * Returns the intended provider; callers must verify the provider is enabled.
 */
export type Gateway = 'razorpay' | 'stripe';
export function gatewayForCurrency(currency: Currency): Gateway {
  return currency === 'INR' ? 'razorpay' : 'stripe';
}
