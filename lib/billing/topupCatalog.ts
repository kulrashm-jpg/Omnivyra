/**
 * Top-up catalog — SINGLE SOURCE OF TRUTH for the 250 / 750 / 1500 credit packs.
 *
 * The UI and the catalog API both read from here (no hardcoded values in the UI).
 * The wired Razorpay order path (`createRazorpayStagingCreditOrder`) reads the
 * matching rows from the `credit_packages` TABLE by id — so the prepared seed
 * migration `20260721_seed_topup_credit_packages.sql` must mirror these ids.
 *
 * Presentation/config only — this file charges nothing and mutates no state.
 *
 * ⚠ PRICES BELOW ARE PLACEHOLDERS — confirm the approved INR amounts before any
 *   live launch. The structure (credits + amount + currency) is the source of
 *   truth; the exact numbers are operator-configurable.
 */

export interface TopupPack {
  /**
   * Stable `credit_packages.id` (UUID) — MUST match the seeded row so the order
   * path (`createRazorpayStagingCreditOrder`) resolves it. Mirrors the seed
   * migration 20260721. The DB row is the source of truth for `price`; the value
   * here is display-only.
   */
  id: string;
  credits: number;
  /** Display price in major units (₹). PLACEHOLDER — DB `credit_packages.price` is authoritative. */
  price: number;
  currency: 'INR';
  label: string;
}

// Canonical SKUs 250 / 500 / 1000 — ids + INR charge amounts mirror
// lib/billing/commercialPlans.ts (display) and seed 20260721 (DB). The charge
// is INR (Razorpay India); USD on the page is display-only.
export const TOPUP_PACKS: TopupPack[] = [
  { id: '0a0a0a25-0000-4000-8000-000000000250', credits: 250, price: 2499, currency: 'INR', label: '250 credits' },
  { id: '0a0a0500-0000-4000-8000-000000000500', credits: 500, price: 4599, currency: 'INR', label: '500 credits' },
  { id: '0a0a1000-0000-4000-8000-000000001000', credits: 1000, price: 8299, currency: 'INR', label: '1,000 credits' },
];

export function getTopupPack(id: string): TopupPack | undefined {
  return TOPUP_PACKS.find((p) => p.id === id);
}
