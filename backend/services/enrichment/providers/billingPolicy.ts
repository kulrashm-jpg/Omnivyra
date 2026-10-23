/**
 * Provider billing policy: who governs a provider's spend.
 *
 *   platform_ceiling     Omnivyra's daily call ceiling (`enrichment_spend_ceiling`,
 *                        M1 / PI-ADR-007) applies. This is the default for every
 *                        provider, including any provider added later.
 *   vendor_subscription  The vendor's own subscription governs spend: its plan,
 *                        its credits and its rate limits. Omnivyra applies no
 *                        ceiling of its own and shows the tenant the vendor's
 *                        exact refusal instead.
 *
 * ─── OWNER DECISION (2026-10-23) ──────────────────────────────────────────
 * "Apollo is based on their subscription, hence we need not control it, but we
 * need to show the exact error — be it no credits, low credits, no
 * subscription, daily limit if any, etc."
 *
 * So Apollo, and only Apollo, is `vendor_subscription`. The exemption is narrow
 * on purpose. It removes the ceiling and nothing else. Authority
 * (`PROSPECT_INGEST`, `PROSPECT_ENRICH_EXECUTE`), tenant binding, the tenant's
 * own credential, idempotency, duplicate suppression, and the per-request
 * page, result and call bounds all still apply. Any other `allow` control
 * attached to the cost port also still applies. A provider absent from this map
 * is `platform_ceiling`, so adding a provider can never silently drop its
 * ceiling.
 */

export type ProviderBillingPolicy = 'platform_ceiling' | 'vendor_subscription';

export const PROVIDER_BILLING_POLICY: Readonly<Record<string, ProviderBillingPolicy>> = Object.freeze({
  apollo: 'vendor_subscription',
});

export function providerBillingPolicy(providerId: string): ProviderBillingPolicy {
  const key = String(providerId ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROVIDER_BILLING_POLICY, key)
    ? PROVIDER_BILLING_POLICY[key]
    : 'platform_ceiling';
}

/** True only for providers whose spend the vendor's subscription governs. */
export function isBillingGovernedByVendorSubscription(providerId: string): boolean {
  return providerBillingPolicy(providerId) === 'vendor_subscription';
}
