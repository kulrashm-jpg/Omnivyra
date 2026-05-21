/**
 * Canonical billing amount-resolution service (HIDDEN, server-side only).
 *
 * Resolves a checkout amount + currency from a plan_reference (subscription)
 * or topup_reference (topup). DB-BACKED: reads the hidden operator-managed
 * `hidden_billing_catalog` table (migration 20260717).
 *
 * DEFAULT-PRESERVING: when the table is absent (migration unapplied) or a DB
 * error occurs, the resolver falls back to COMPILED_FALLBACK — which mirrors
 * the 20260717 seed exactly — so behavior is identical whether or not the
 * migration has been applied. Mirrors the established billing-resolver pattern
 * (paymentProviderPolicyResolver, billingPolicyResolver).
 *
 * HIDDEN-PRICING — STRICT:
 *   - No pricing source is ever exported. The resolver returns ONLY
 *     { amount, currency } and only to the server-side orchestrator.
 *   - Never serialized into an API response, billing shell, frontend state,
 *     provider discovery, query params, or logs.
 *
 * Deterministic: same reference → same result (the DB row / fallback entry is
 * the single source of truth). Rejection behavior preserved exactly:
 * malformed_reference / unknown_reference / disabled_reference.
 *
 * NO live settlement, NO ledger mutation, NO invoice generation — resolves a
 * number, nothing more.
 */

import { supabase } from '../../../db/supabaseClient';
import { logger } from '../../logger';

export type BillingReferenceKind = 'subscription' | 'topup';

export interface ResolvedBillingAmount {
  /** Major-currency-unit amount (the provider adapter handles sub-unit conversion). */
  amount: number;
  /** ISO-4217. */
  currency: string;
}

export type ResolveAmountResult =
  | { ok: true; amount: ResolvedBillingAmount }
  | { ok: false; code: 'unknown_reference' | 'disabled_reference' | 'malformed_reference'; reason: string };

interface CatalogEntry {
  kind: BillingReferenceKind;
  amount_minor: number;
  currency: string;
  enabled: boolean;
}

/**
 * COMPILED FALLBACK — mirrors the 20260717 seed EXACTLY. Used ONLY when
 * hidden_billing_catalog is absent / errors, so the resolver is
 * default-preserving. NOT exported.
 */
const COMPILED_FALLBACK: Readonly<Record<string, CatalogEntry>> = {
  plan_starter_monthly: { kind: 'subscription', amount_minor: 49900,  currency: 'INR', enabled: true },
  plan_pro_monthly:     { kind: 'subscription', amount_minor: 199900, currency: 'INR', enabled: true },
  plan_legacy_v1:       { kind: 'subscription', amount_minor: 99900,  currency: 'INR', enabled: false },
  topup_credits_500:    { kind: 'topup', amount_minor: 50000,  currency: 'INR', enabled: true },
  topup_credits_2000:   { kind: 'topup', amount_minor: 180000, currency: 'INR', enabled: true },
  topup_legacy_pack:    { kind: 'topup', amount_minor: 70000,  currency: 'INR', enabled: false },
};

/** Reference identifier shape — lowercase, alphanumeric + underscore, 3-64 chars. */
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** ISO-4217 zero-decimal currencies (no minor unit). */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'XOF', 'XAF']);

function minorToMajor(minor: number, currency: string): number {
  const m = Math.max(0, Math.round(minor) || 0);
  return ZERO_DECIMAL.has(currency.trim().toUpperCase()) ? m : m / 100;
}

/**
 * Single read path. Returns the catalog entry for `referenceKey`, or null when
 * the table exists but has no such row. On a missing table / DB error, falls
 * back to COMPILED_FALLBACK. Never throws.
 */
async function readCatalogEntry(referenceKey: string): Promise<CatalogEntry | null> {
  try {
    const { data, error } = await supabase
      .from('hidden_billing_catalog')
      .select('kind, amount_minor, currency, enabled')
      .eq('reference_key', referenceKey)
      .maybeSingle();

    if (error) {
      // Table absent (migration unapplied) / permission / transient → fallback.
      logger.warn('hidden_billing_catalog_read_failed', { message: error.message });
      return COMPILED_FALLBACK[referenceKey] ?? null;
    }
    if (!data) return null; // table exists, no such reference → unknown
    const row = data as Record<string, unknown>;
    return {
      kind: String(row.kind ?? '') as BillingReferenceKind,
      amount_minor: Number(row.amount_minor ?? 0) || 0,
      currency: String(row.currency ?? ''),
      enabled: row.enabled === true,
    };
  } catch (err) {
    logger.warn('hidden_billing_catalog_resolve_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return COMPILED_FALLBACK[referenceKey] ?? null;
  }
}

/**
 * Resolve { amount, currency } for a plan/topup reference. DB-backed,
 * deterministic, never throws.
 *
 *  - malformed reference (shape mismatch)   → malformed_reference
 *  - unknown reference / kind mismatch      → unknown_reference
 *  - retired (enabled=false) plan/topup     → disabled_reference
 */
export async function resolveBillingAmount(args: {
  intentType: BillingReferenceKind;
  reference: string;
}): Promise<ResolveAmountResult> {
  const ref = typeof args.reference === 'string' ? args.reference.trim() : '';

  if (!REFERENCE_PATTERN.test(ref)) {
    return { ok: false, code: 'malformed_reference', reason: 'reference does not match the expected identifier shape' };
  }

  const entry = await readCatalogEntry(ref);
  if (!entry) {
    return { ok: false, code: 'unknown_reference', reason: `no pricing entry for reference: ${ref}` };
  }
  if (entry.kind !== args.intentType) {
    return { ok: false, code: 'unknown_reference', reason: `reference ${ref} is not a ${args.intentType} reference` };
  }
  if (!entry.enabled) {
    return { ok: false, code: 'disabled_reference', reason: `reference ${ref} is retired/disabled` };
  }

  return {
    ok: true,
    amount: { amount: minorToMajor(entry.amount_minor, entry.currency), currency: entry.currency },
  };
}
