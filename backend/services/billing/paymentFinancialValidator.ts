/**
 * Payment financial validation — THE single authority that decides whether a
 * provider-confirmed payment may be fulfilled.
 *
 * The rule this enforces:
 *
 *     provider state = PAID
 *   AND provider amount   == expected purchase amount
 *   AND provider currency == expected purchase currency
 *
 * Before this existed, `outcome === 'paid'` alone completed a purchase and
 * granted its full credit entitlement. A capture of ₹1 against a ₹2,520
 * purchase fulfilled it, and a USD capture fulfilled an INR purchase, because
 * the settlement contract carried no amount or currency at all to compare.
 *
 * Deliberately NOT done here:
 *   - no FX conversion. A currency difference is a mismatch, never a rate lookup.
 *   - no tolerance band. Amounts compare exactly, in minor units, as integers,
 *     so no float rounding can widen the gap a caller is willing to accept.
 *   - no client input. Both sides come from the server: the expected side from
 *     `credit_purchases`, the provider side from the provider itself or from a
 *     signature-verified webhook payload.
 *
 * Missing or malformed provider financials resolve to UNKNOWN, not to a pass.
 * A provider saying "paid" without a trustworthy amount is not sufficient
 * evidence to move money, and UNKNOWN leaves the purchase recoverable so a
 * later authoritative answer can still settle it.
 */

import type { ProviderFinancials } from '../payments/orchestrator';

export type FinancialValidationCode =
  | 'VALID'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'UNKNOWN';

export interface FinancialValidationResult {
  ok: boolean;
  code: FinancialValidationCode;
  /** Operator-safe diagnostic. Carries no card data, no secrets. */
  detail?: string;
  expectedAmountSubunits?: number;
  providerAmountSubunits?: number;
  expectedCurrency?: string;
  providerCurrency?: string;
}

/** Major units (e.g. 2520 INR) → minor units (252000 paise), integer-exact. */
export function toSubunits(amountMajor: number): number {
  return Math.round(amountMajor * 100);
}

/**
 * Compare what the purchase was for against what the provider says it took.
 *
 * @param expectedAmountMajor `credit_purchases.amount_paid` (major units)
 * @param expectedCurrency    `credit_purchases.currency`
 * @param provider            provider-stated financials (minor units)
 */
export function validateProviderFinancials(args: {
  expectedAmountMajor: unknown;
  expectedCurrency: unknown;
  provider: ProviderFinancials | null | undefined;
}): FinancialValidationResult {
  const { provider } = args;

  // ── expected side must itself be sane ────────────────────────────────────
  const expectedMajor = Number(args.expectedAmountMajor);
  if (!Number.isFinite(expectedMajor) || expectedMajor <= 0) {
    return { ok: false, code: 'UNKNOWN', detail: 'expected_amount_unusable' };
  }
  const expectedCurrency =
    typeof args.expectedCurrency === 'string' && args.expectedCurrency.trim()
      ? args.expectedCurrency.trim().toUpperCase()
      : '';
  if (!expectedCurrency) {
    return { ok: false, code: 'UNKNOWN', detail: 'expected_currency_unusable' };
  }
  const expectedAmountSubunits = toSubunits(expectedMajor);

  // ── provider side must be present and well-formed ────────────────────────
  if (!provider) {
    return { ok: false, code: 'UNKNOWN', detail: 'provider_financials_absent', expectedAmountSubunits, expectedCurrency };
  }

  const rawAmount = provider.amountSubunits;
  if (rawAmount === null || rawAmount === undefined) {
    return { ok: false, code: 'UNKNOWN', detail: 'provider_amount_missing', expectedAmountSubunits, expectedCurrency };
  }
  const providerAmountSubunits = Number(rawAmount);
  if (!Number.isFinite(providerAmountSubunits) || !Number.isInteger(providerAmountSubunits)) {
    return { ok: false, code: 'UNKNOWN', detail: 'provider_amount_malformed', expectedAmountSubunits, expectedCurrency };
  }
  if (providerAmountSubunits <= 0) {
    // Zero/negative is not a "mismatch to investigate" — it is unusable data.
    return {
      ok: false, code: 'UNKNOWN', detail: 'provider_amount_non_positive',
      expectedAmountSubunits, providerAmountSubunits, expectedCurrency,
    };
  }

  const rawCurrency = provider.currency;
  if (rawCurrency === null || rawCurrency === undefined || String(rawCurrency).trim() === '') {
    return {
      ok: false, code: 'UNKNOWN', detail: 'provider_currency_missing',
      expectedAmountSubunits, providerAmountSubunits, expectedCurrency,
    };
  }
  const providerCurrency = String(rawCurrency).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(providerCurrency)) {
    return {
      ok: false, code: 'UNKNOWN', detail: 'provider_currency_malformed',
      expectedAmountSubunits, providerAmountSubunits, expectedCurrency, providerCurrency,
    };
  }

  // ── the two comparisons ──────────────────────────────────────────────────
  // Currency first: an amount comparison across different currencies is
  // meaningless, and reporting AMOUNT_MISMATCH for it would misdirect the
  // operator investigating it.
  if (providerCurrency !== expectedCurrency) {
    return {
      ok: false, code: 'CURRENCY_MISMATCH', detail: 'provider_currency_differs',
      expectedAmountSubunits, providerAmountSubunits, expectedCurrency, providerCurrency,
    };
  }
  if (providerAmountSubunits !== expectedAmountSubunits) {
    return {
      ok: false, code: 'AMOUNT_MISMATCH', detail: 'provider_amount_differs',
      expectedAmountSubunits, providerAmountSubunits, expectedCurrency, providerCurrency,
    };
  }

  return {
    ok: true, code: 'VALID',
    expectedAmountSubunits, providerAmountSubunits, expectedCurrency, providerCurrency,
  };
}
