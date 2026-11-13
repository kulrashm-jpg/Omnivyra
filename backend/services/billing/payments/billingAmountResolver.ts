/**
 * Billing amount resolution for the provider-neutral checkout-session orchestrator - RETIRED.
 *
 * This resolver priced checkouts from the hidden operator-managed `hidden_billing_catalog` (migration 20260717),
 * falling back to a compiled copy of its seed on any read error. The OWNER RETIRED the hidden-billing stack, and e9
 * ruled (2026-11-13, C97 item 1(a)): a checkout must never price from a retired catalog. So every reference now resolves
 * to 'disabled_reference' - no catalog read, no compiled fallback, no amount.
 *
 * What this means in practice: the checkout-session orchestrator (the SANDBOX-ONLY settlement foundation, staging
 * Razorpay / not-implemented adapters) refuses every request before any provider session is created. Live purchases
 * are unaffected: they price through checkout/create-order -> pricingConfigService (getFxConfigForCharge).
 * Re-activating the foundation requires a NEW pricing source (not the retired catalog) and its own review.
 *
 * The exported types are kept so the orchestrator's contract is unchanged.
 */

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

/** Reference identifier shape - lowercase, alphanumeric + underscore, 3-64 chars (kept: malformed input is still named). */
const REFERENCE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

export const HIDDEN_BILLING_RETIRED_REASON =
  'the hidden billing catalog is retired (owner ruling); no checkout is priced from it';

/**
 * Always refuses. A malformed reference is still reported as malformed (so callers keep their validation signal);
 * every well-formed reference is 'disabled_reference'. Never reads a database, never returns an amount.
 */
export async function resolveBillingAmount(args: {
  intentType: BillingReferenceKind;
  reference: string;
}): Promise<ResolveAmountResult> {
  const ref = typeof args.reference === 'string' ? args.reference.trim() : '';
  if (!REFERENCE_PATTERN.test(ref)) {
    return { ok: false, code: 'malformed_reference', reason: 'reference does not match the expected identifier shape' };
  }
  return { ok: false, code: 'disabled_reference', reason: HIDDEN_BILLING_RETIRED_REASON };
}
