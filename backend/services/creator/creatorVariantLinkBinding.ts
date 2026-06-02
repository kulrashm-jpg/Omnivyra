/**
 * Creator-asset variant link binding.
 *
 * Closes the experiment attribution blind spot by stamping the creator asset's
 * OWN durable variant identity directly into a tracking link at mint time —
 * `asset → applied_variant → omn_variant_id` — instead of resolving variant
 * later through (campaign + platform), which is ambiguous when multiple
 * variants run concurrently.
 *
 * Reuses the existing `generateTrackingLink` (which already emits
 * omn_variant_id / omn_strategy_id) and appends the tracked URL to the asset's
 * EXISTING CTA copy. Purely additive:
 *   - existing CTA text / copy is preserved (URL is appended, not replaced);
 *   - it writes only `packaging.cta` — never `packaging.caption` or
 *     `asset_payload`, so the BOLT deterministic asset-id hash (caption +
 *     payload) is unchanged (no id drift, no dedup/upsert regression);
 *   - any failure (e.g. company has no website_url) returns the output
 *     untouched, so generation / scheduling / publishing are never blocked and
 *     the fallback matches today's behaviour (no link → bridge fallback).
 *
 * No new tables / columns / indexes / migrations. No attribution or analytics
 * change — it only mints a link the attribution pipeline already understands.
 */

import { generateTrackingLink } from '../trackingLinkService';
import type { CanonicalCreatorOutput } from '../executionEngines/types';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function appendVariantTrackingCta(
  output: CanonicalCreatorOutput,
  scope: { companyId: string; campaignId: string },
  applied: { strategy_id: string; variant_id: string; variant_family: string } | null | undefined,
  platform: string,
  contentType: string,
): Promise<CanonicalCreatorOutput> {
  // No variant applied → nothing to bind; return unchanged (legacy parity).
  if (!applied?.variant_id) return output;

  try {
    const tracking = await generateTrackingLink({
      companyId: scope.companyId,
      campaignId: scope.campaignId,
      platform,
      contentType,
      // Creator assets are not week/day keyed; these only shape utm_content.
      weekNumber: 0,
      dayNumber: 0,
      // The asset's OWN variant — bound directly, never resolved by campaign+platform.
      variantId: applied.variant_id,
      strategyId: applied.strategy_id,
    });

    const packaging = asObject((output as unknown as Record<string, unknown>).packaging);
    const existingCta = typeof packaging.cta === 'string' ? packaging.cta.trim() : '';
    // Idempotent — never double-append on regeneration.
    if (existingCta.includes(tracking.url)) return output;
    const cta = existingCta ? `${existingCta} ${tracking.url}` : tracking.url;

    return { ...output, packaging: { ...packaging, cta } } as CanonicalCreatorOutput;
  } catch {
    // Best-effort: link minting must never block creator generation,
    // scheduling, or publishing. Fallback = today's behaviour (no omn link).
    return output;
  }
}
