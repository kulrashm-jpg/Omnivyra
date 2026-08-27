/**
 * A user's own photograph, as the faded background of an infographic.
 *
 * WHAT THIS IS
 * ------------
 * The infographic renderer composites deterministically — SVG over a base
 * layer, sharp, no model anywhere in the path. It has always been able to take
 * a full-bleed base image; what it could never take was a picture belonging to
 * the person using it, because the one wired source was an `https://` URL and a
 * canonical user asset deliberately has no URL.
 *
 * This is the missing half-step, and nothing more: it turns an accepted
 * `background` reference into the `Buffer` that mechanism already wanted.
 * Crop, scrim, gradient, layer order and every fallback stay exactly as they
 * are — the only new fact is where the bytes may come from.
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is NOT a second resolver. Tenant scoping, lifecycle gating and purpose
 * routing all happened upstream in `resolveCompositionAssets`; this reads the
 * result and fetches bytes through the same reader both existing lanes use.
 *
 * It is NOT CONDITION. No provider is called or imported. The image is placed,
 * then softened — a deterministic operation with a deterministic outcome.
 *
 * It is NOT style interpretation. Only `background` is handled here. A
 * `style_reference` cannot be honoured by a compositor that can copy pixels but
 * cannot emulate a manner of seeing, and quietly treating one as the other
 * would be the same false promise this whole line of work has been removing.
 */

import { getCanonicalMediaAsset } from '../canonicalMediaAssetService';
import { readCanonicalAssetBytes } from './creatorReferenceImageFetch';
import { isUsableMediaAsset } from '../../../lib/content/canonicalMediaAsset';
import type { RoutedReference } from '../../../lib/content/compositionAssetRouting';

/**
 * THE capability gate for user-owned infographic backgrounds.
 *
 * Deliberately NOT `INFOGRAPHIC_BACKGROUND_IMAGES_ENABLED`. That flag governs a
 * template/brand-authored backdrop: content the product itself chose, with a
 * blast radius of "our own art direction". This governs a customer's private
 * photograph reaching a rendered asset. They are different risks with different
 * rollback decisions, and one switch for both would mean neither could be
 * turned on alone.
 *
 * Exact match on the one supported value, so unset, empty, `TRUE`, or a
 * trailing space are all OFF. A gate that also accepts the spellings it was not
 * told about is a gate that opens on a typo.
 */
export function infographicUserBackgroundEnabled(): boolean {
  return process.env.CREATOR_INFOGRAPHIC_USER_BACKGROUND_ENABLED === 'true';
}

/**
 * The largest canonical asset this renderer will decode.
 *
 * The URL path this replaces is capped at 25 MiB by the SSRF fetcher's streamed
 * byte limit. `readCanonicalAssetBytes` has no such cap — it reads a trusted
 * private object — so the bound has to be reasserted here or the byte path
 * would be strictly more permissive than the path it stands in for. Matching
 * the existing number is deliberate: this is the same operation with a
 * different source, not a new policy.
 *
 * Checked against the asset's RECORDED size before any download, so an
 * oversized object is never fetched, let alone handed to sharp.
 */
export const MAX_INFOGRAPHIC_BACKGROUND_BYTES = 25 * 1024 * 1024;

/** Formats sharp decodes reliably for this compositor. */
const SUPPORTED_MIME = new Set(['image/png', 'image/webp', 'image/jpeg', 'image/jpg']);

export type InfographicBackgroundRejectionReason =
  | 'capability_disabled'
  | 'asset_not_found'
  | 'asset_not_ready'
  | 'unsupported_mime_type'
  | 'asset_too_large'
  | 'bytes_unavailable';

export interface InfographicBackgroundResult {
  /** The bytes to composite, or null when none could be used. */
  bytes: Buffer | null;
  /**
   * Tenant-scoped cache identity for these bytes.
   *
   * Null whenever `bytes` is null. Company FIRST and always present: a cache
   * key built from asset identity alone would let one tenant's render be served
   * to another the moment two ids ever collided or were guessed, and a global
   * in-process cache gives that mistake no second line of defence.
   */
  cacheKey: string | null;
  reason: InfographicBackgroundRejectionReason | null;
}

const NONE = (reason: InfographicBackgroundRejectionReason): InfographicBackgroundResult =>
  ({ bytes: null, cacheKey: null, reason });

/**
 * Resolve the `background` reference of an infographic into compositable bytes.
 *
 * Returns bytes only when the capability is on AND a background reference
 * exists AND the asset is this company's, ready, a format sharp reads, and
 * within the size bound. Every other outcome returns null with a typed reason,
 * because the renderer's contract is to produce an infographic either way — a
 * picture that could not be read must not cost the user the design.
 *
 * `condition` is the routed CONDITION lane. Reading `background` from it is not
 * a contradiction of the mode: routing decided WHICH references are eligible,
 * and this family then honours the eligible one the only way it can. Nothing
 * here re-decides purpose, and nothing but `background` is looked at.
 */
export async function resolveInfographicBackgroundBytes(input: {
  companyId: string | null | undefined;
  condition: readonly RoutedReference[] | null | undefined;
  width: number;
  height: number;
}): Promise<InfographicBackgroundResult> {
  if (!infographicUserBackgroundEnabled()) return NONE('capability_disabled');

  const companyId = String(input.companyId || '').trim();
  if (!companyId) return NONE('asset_not_found');

  const routed = (input.condition ?? []).find((r) => r.reference?.purpose === 'background');
  if (!routed) return { bytes: null, cacheKey: null, reason: null };

  // Tenancy before bytes. A foreign asset is never fetched, and is
  // indistinguishable from one that does not exist.
  const asset = await getCanonicalMediaAsset(companyId, routed.reference.assetId);
  if (!asset) return NONE('asset_not_found');
  if (!isUsableMediaAsset(asset)) return NONE('asset_not_ready');

  const mime = String(asset.mimeType || '').toLowerCase();
  if (!SUPPORTED_MIME.has(mime)) return NONE('unsupported_mime_type');

  if (typeof asset.byteSize === 'number' && asset.byteSize > MAX_INFOGRAPHIC_BACKGROUND_BYTES) {
    return NONE('asset_too_large');
  }

  const bytes = await readCanonicalAssetBytes(asset.storageBucket, asset.storagePath);
  if (!bytes) return NONE('bytes_unavailable');
  // The recorded size can disagree with the object; the bound is what matters,
  // so it is applied to what was actually read as well as to what was claimed.
  if (bytes.byteLength > MAX_INFOGRAPHIC_BACKGROUND_BYTES) return NONE('asset_too_large');

  return {
    bytes,
    /*
     * Company · asset · canvas. Asset id is stable for the life of the row and
     * its bytes are immutable once `ready` — a replacement is a new asset with
     * a new id, never the same id with different content — so identity alone
     * cannot serve stale pixels. Dimensions are in the key because the cached
     * value is the RESIZED buffer, which differs per canvas.
     */
    cacheKey: `infographic-bg:user:${companyId}:${asset.id}:${input.width}x${input.height}`,
    reason: null,
  };
}
