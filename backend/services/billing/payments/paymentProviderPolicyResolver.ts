/**
 * Centralized payment-provider policy resolver (SINGLE READ PATH).
 *
 * The ONE backend path that decides which payment providers are available
 * and visible for checkout. Resolves per-provider governance from
 * payment_provider_config (migration 20260714) and applies deterministic
 * filtering (enablement, maintenance mode, geography, currency).
 *
 * NEVER THROWS: any error (table absent because the migration is unapplied,
 * transient DB error, malformed row) falls back to COMPILED_DEFAULT_PROVIDERS
 * — which mirror the migration's seed exactly, so behavior is byte-identical
 * whether or not the table exists. Safe to deploy ahead of the migration.
 *
 * SCOPE GUARD: provider orchestration governance ONLY. This resolver carries
 * and returns NO pricing data — no plan prices, no amounts, no public pricing.
 * Hidden-pricing behavior is structurally preserved (there is nowhere here
 * for a price to leak).
 *
 * It does NOT touch the ledger/wallet, HOLD semantics, or reconciliation.
 * It does NOT implement routing intelligence — `recommended` is a placeholder
 * (always null) reserved for a future payment-intelligence layer.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';
import type { SupportedProvider } from './paymentProviderAdapter';

/** Provider tags this governance layer knows about. Mirrors SupportedProvider. */
export const GOVERNED_PROVIDERS: SupportedProvider[] = ['razorpay', 'stripe', 'cashfree', 'phonepe'];

export interface ProviderGovernanceRow {
  provider: SupportedProvider;
  enabled: boolean;
  visible_in_checkout: boolean;
  subscriptions_enabled: boolean;
  topups_enabled: boolean;
  supported_countries: string[];
  supported_currencies: string[];
  supported_payment_methods: string[];
  priority: number;
  maintenance_mode: boolean;
  sandbox_mode: boolean;
}

/**
 * Compiled defaults — mirror the 20260714 seed EXACTLY. Used when the table
 * is absent or empty so the resolver is default-preserving.
 */
export const COMPILED_DEFAULT_PROVIDERS: ProviderGovernanceRow[] = [
  {
    provider: 'razorpay',
    enabled: true,
    visible_in_checkout: true,
    subscriptions_enabled: false,
    topups_enabled: true,
    supported_countries: ['IN'],
    supported_currencies: ['INR', 'USD'],
    supported_payment_methods: ['card', 'upi', 'netbanking'],
    priority: 10,
    maintenance_mode: false,
    sandbox_mode: true,
  },
  {
    provider: 'stripe',
    enabled: false,
    visible_in_checkout: false,
    subscriptions_enabled: false,
    topups_enabled: false,
    supported_countries: [],
    supported_currencies: ['USD', 'EUR', 'GBP'],
    supported_payment_methods: ['card'],
    priority: 20,
    maintenance_mode: false,
    sandbox_mode: true,
  },
  // cashfree + phonepe — registered but HIDDEN + DISABLED by default. Inert
  // until an operator enables them via the super-admin governance surface.
  {
    provider: 'cashfree',
    enabled: false,
    visible_in_checkout: false,
    subscriptions_enabled: false,
    topups_enabled: true,
    supported_countries: ['IN'],
    supported_currencies: ['INR'],
    supported_payment_methods: ['card', 'upi', 'netbanking'],
    priority: 30,
    maintenance_mode: false,
    sandbox_mode: true,
  },
  {
    provider: 'phonepe',
    enabled: false,
    visible_in_checkout: false,
    subscriptions_enabled: false,
    topups_enabled: true,
    supported_countries: ['IN'],
    supported_currencies: ['INR'],
    supported_payment_methods: ['upi', 'card'],
    priority: 40,
    maintenance_mode: false,
    sandbox_mode: true,
  },
];

/** Checkout-rendering view of a single available provider. NO pricing fields. */
export interface ResolvedCheckoutProvider {
  provider: SupportedProvider;
  visible_in_checkout: boolean;
  subscriptions_enabled: boolean;
  topups_enabled: boolean;
  supported_payment_methods: string[];
  supported_countries: string[];
  supported_currencies: string[];
  priority: number;
  sandbox_mode: boolean;
}

export interface ResolveProvidersContext {
  /** ISO-3166-1 alpha-2; when provided, providers must support it (or be unrestricted). */
  country?: string | null;
  /** ISO-4217; when provided, providers must support it (or be unrestricted). */
  currency?: string | null;
  /**
   * Whether the caller has authoritative geography for this request.
   * When explicitly `false` AND `country` is absent, the resolver applies a
   * CONSERVATIVE filter: geography-restricted providers are EXCLUDED (we will
   * not expose a country-restricted provider to an unknown-geography user).
   * Omitted/true preserves the prior default-preserving behavior (a missing
   * country matches every provider).
   */
  geographyKnown?: boolean;
}

export interface ResolvedProviderList {
  /** Providers enabled, not in maintenance, and matching geography/currency. */
  available: ResolvedCheckoutProvider[];
  /** Subset of `available` that is ALSO visible_in_checkout. */
  visible: ResolvedCheckoutProvider[];
  /** Union of supported methods across the visible providers (de-duplicated). */
  supported_methods: string[];
  /**
   * Placeholder for a future payment-intelligence recommendation. ALWAYS null
   * today — routing intelligence is explicitly out of scope.
   */
  recommended: SupportedProvider | null;
  /** Provenance: whether the DB table backed this resolution. */
  source: 'db' | 'compiled_default';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0)
    .map((x) => x.trim());
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Single DB read. Returns the raw governance rows for every known provider.
 * Falls back to COMPILED_DEFAULT_PROVIDERS on any error / missing table /
 * missing rows. Never throws.
 */
export async function resolveProviderGovernance(): Promise<{
  rows: ProviderGovernanceRow[];
  source: 'db' | 'compiled_default';
}> {
  try {
    const { data, error } = await supabase
      .from('payment_provider_config')
      .select(
        'provider, enabled, visible_in_checkout, subscriptions_enabled, topups_enabled, ' +
        'supported_countries, supported_currencies, supported_payment_methods, ' +
        'priority, maintenance_mode, sandbox_mode',
      );

    if (error || !Array.isArray(data) || data.length === 0) {
      return { rows: COMPILED_DEFAULT_PROVIDERS, source: 'compiled_default' };
    }

    const byProvider = new Map<string, Record<string, unknown>>();
    for (const raw of data as unknown as Array<Record<string, unknown>>) {
      const p = String(raw.provider ?? '').trim();
      if (p) byProvider.set(p, raw);
    }

    // Resolve each KNOWN provider; a provider missing from the table falls
    // back to its compiled default row (never silently dropped).
    const rows: ProviderGovernanceRow[] = GOVERNED_PROVIDERS.map((provider) => {
      const r = byProvider.get(provider);
      const fallback = COMPILED_DEFAULT_PROVIDERS.find((d) => d.provider === provider)!;
      if (!r) return fallback;
      return {
        provider,
        enabled:               asBool(r.enabled, fallback.enabled),
        visible_in_checkout:   asBool(r.visible_in_checkout, fallback.visible_in_checkout),
        subscriptions_enabled: asBool(r.subscriptions_enabled, fallback.subscriptions_enabled),
        topups_enabled:        asBool(r.topups_enabled, fallback.topups_enabled),
        supported_countries:   asStringArray(r.supported_countries),
        supported_currencies:  asStringArray(r.supported_currencies),
        supported_payment_methods: asStringArray(r.supported_payment_methods),
        priority:              typeof r.priority === 'number' && Number.isFinite(r.priority)
                                 ? r.priority : fallback.priority,
        maintenance_mode:      asBool(r.maintenance_mode, fallback.maintenance_mode),
        sandbox_mode:          asBool(r.sandbox_mode, fallback.sandbox_mode),
      };
    });
    return { rows, source: 'db' };
  } catch (err) {
    logger.warn('payment_provider_governance_resolve_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return { rows: COMPILED_DEFAULT_PROVIDERS, source: 'compiled_default' };
  }
}

function matchesGeography(
  row: ProviderGovernanceRow,
  country?: string | null,
  geographyKnown?: boolean,
): boolean {
  if (country) {
    if (row.supported_countries.length === 0) return true; // unrestricted
    return row.supported_countries.includes(country.trim().toUpperCase());
  }
  // Country unknown. When the caller explicitly says geography is NOT known,
  // be conservative: only geography-unrestricted providers pass — a
  // country-restricted provider is never exposed to an unknown-geography user.
  if (geographyKnown === false) return row.supported_countries.length === 0;
  // Default-preserving: omitted/true → missing country matches every provider.
  return true;
}

function matchesCurrency(row: ProviderGovernanceRow, currency?: string | null): boolean {
  if (!currency) return true;
  if (row.supported_currencies.length === 0) return true; // unrestricted
  return row.supported_currencies.includes(currency.trim().toUpperCase());
}

function toCheckoutProvider(row: ProviderGovernanceRow): ResolvedCheckoutProvider {
  return {
    provider: row.provider,
    visible_in_checkout: row.visible_in_checkout,
    subscriptions_enabled: row.subscriptions_enabled,
    topups_enabled: row.topups_enabled,
    supported_payment_methods: row.supported_payment_methods,
    supported_countries: row.supported_countries,
    supported_currencies: row.supported_currencies,
    priority: row.priority,
    sandbox_mode: row.sandbox_mode,
  };
}

/**
 * THE single backend resolution path for checkout provider availability.
 *
 * A provider is `available` when: enabled = true AND maintenance_mode = false
 * AND it matches the requested geography/currency (empty support arrays mean
 * "unrestricted"). A provider is `visible` when it is available AND
 * visible_in_checkout = true.
 *
 * Deterministic ordering: by `priority` ascending, then provider name.
 */
export async function resolveAvailableProviders(
  ctx: ResolveProvidersContext = {},
): Promise<ResolvedProviderList> {
  const { rows, source } = await resolveProviderGovernance();

  const available = rows
    .filter((r) => r.enabled && !r.maintenance_mode)
    .filter((r) => matchesGeography(r, ctx.country, ctx.geographyKnown))
    .filter((r) => matchesCurrency(r, ctx.currency))
    .sort((a, b) => (a.priority - b.priority) || a.provider.localeCompare(b.provider))
    .map(toCheckoutProvider);

  const visible = available.filter((p) => p.visible_in_checkout);

  const supported_methods = Array.from(
    new Set(visible.flatMap((p) => p.supported_payment_methods)),
  ).sort();

  return {
    available,
    visible,
    supported_methods,
    recommended: null, // payment-intelligence routing is out of scope
    source,
  };
}

/**
 * Deterministic checkout gate for a single provider. Returns ok=false with a
 * stable reason when governance forbids dispatching this provider for the
 * given geography/currency. Used by dispatchCheckout as an additive guard.
 */
export async function isProviderAvailableForCheckout(
  provider: SupportedProvider,
  ctx: ResolveProvidersContext = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const resolved = await resolveAvailableProviders(ctx);
  if (resolved.available.some((p) => p.provider === provider)) return { ok: true };
  // Distinguish the failure cause from the raw governance rows for a precise reason.
  const { rows } = await resolveProviderGovernance();
  const row = rows.find((r) => r.provider === provider);
  if (!row)                   return { ok: false, reason: 'provider_not_governed' };
  if (!row.enabled)           return { ok: false, reason: 'provider_disabled' };
  if (row.maintenance_mode)   return { ok: false, reason: 'provider_in_maintenance' };
  if (!matchesGeography(row, ctx.country, ctx.geographyKnown))  return { ok: false, reason: 'provider_geography_unsupported' };
  if (!matchesCurrency(row, ctx.currency))  return { ok: false, reason: 'provider_currency_unsupported' };
  return { ok: false, reason: 'provider_unavailable' };
}
