/**
 * Phase 10D — asset/image/video → activity-economy bridge.
 *
 * Brings asset/image/video generation into the SAME activity-economy lifecycle
 * as every other billable activity, with NO parallel economy and NO new
 * pricing:
 *   - class economics (entry / min / max / abandonment) come from the Phase 8A
 *     catalog (IMAGE_GENERATION / VIDEO_GENERATION), via resolveActivityEconomics.
 *   - the ACTUAL settled cost comes from the EXISTING per-asset cost profiles
 *     (creator/costProfiles.ts) — the same numbers the campaign-variant
 *     estimator surfaces to operators.
 *
 * The returned `actualCredits` is fed to executeWithEntryConsumption as
 * amountOverride: entry is consumed, exposure (max − entry) is reserved, and
 * settlement draws `actualCredits − entry` from exposure (the engine caps at the
 * class maximum — i.e. max exposure — and releases the remainder), using the
 * already-certified financial primitives. No billing/settlement/admission code
 * is modified here; this is a read-only resolver.
 */

import { resolveCostProfile } from './costProfiles';
import { resolveActivityEconomics, type ResolvedActivityEconomics } from '../activityEconomyCatalog';

/** Content types that map to the VIDEO_GENERATION class; everything else → image. */
const VIDEO_CONTENT_TYPES = new Set(['video', 'reel', 'short', 'shorts']);

export type AssetActivity = 'image_generation' | 'video_generation';

export interface AssetActivityEconomics extends ResolvedActivityEconomics {
  contentType: string;
  assetCount: number;
  /**
   * Per-asset credits × asset count, from the existing cost profile. This is the
   * settlement amount handed to the engine as amountOverride; the engine caps
   * the draw at the class maximum (max exposure) during settlement.
   */
  actualCredits: number;
}

/** The activity key for a given asset content type. */
export function assetActivityFor(contentType: string): AssetActivity {
  return VIDEO_CONTENT_TYPES.has(String(contentType || '').toLowerCase())
    ? 'video_generation'
    : 'image_generation';
}

/**
 * Resolve the activity-economy + actual cost for an asset/image/video activity.
 * Reuses costProfiles (per-asset credits) and the catalog class economics.
 */
export function resolveAssetActivityEconomics(input: {
  contentType: string;
  assetCount?: number;
}): AssetActivityEconomics {
  const contentType = String(input.contentType || 'image').toLowerCase();
  const assetCount = Math.max(1, Math.floor(Number(input.assetCount ?? 1)));
  const activity = assetActivityFor(contentType);
  const economics = resolveActivityEconomics(activity);
  // resolveCostProfile falls back to the 'image' profile for unknown types.
  const profile = resolveCostProfile(contentType);
  const actualCredits = Math.max(1, Math.ceil(profile.expected_credits_per_asset * assetCount));
  return { ...economics, contentType, assetCount, actualCredits };
}
