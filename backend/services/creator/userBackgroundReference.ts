/**
 * A user's own photograph as the background of a deterministically rendered
 * creative — the part that is identical whichever family is asking.
 *
 * WHY THIS IS SHARED
 * ------------------
 * Infographic and carousel are the same kind of renderer: SVG over a base
 * layer, sharp, no model anywhere in the path. Both can therefore honour a
 * `background` reference the same way, and both need exactly the same answers
 * first — is the capability on, is this asset this company's, is it ready, is
 * it a format sharp reads, is it small enough to decode.
 *
 * Those questions were answered once for infographic in Phase 63. Asking them a
 * second time for carousel would mean two places where "may we use this
 * picture?" could drift apart, and the drift would only be visible in what
 * reached the canvas. So the answering lives here and each family supplies the
 * two things that genuinely differ: its own capability flag, and its own cache
 * namespace.
 *
 * WHAT IT DELIBERATELY IS NOT
 * ---------------------------
 * It is NOT a resolver. Tenant scoping, lifecycle gating and purpose routing
 * all already happened upstream in `resolveCompositionAssets`; this reads that
 * result and fetches bytes through the ONE canonical reader both existing lanes
 * already use.
 *
 * It calls no provider, mints no URL, and touches only `background`. A
 * `style_reference` cannot be honoured by a compositor that copies pixels but
 * cannot emulate a manner of seeing, and quietly treating one as the other
 * would be the false promise this whole line of work has been removing.
 */

import { getCanonicalMediaAsset } from '../canonicalMediaAssetService';
import { readCanonicalAssetBytes } from './creatorReferenceImageFetch';
import { isUsableMediaAsset } from '../../../lib/content/canonicalMediaAsset';
import type { RoutedReference } from '../../../lib/content/compositionAssetRouting';

/**
 * The largest canonical asset any of these renderers will decode.
 *
 * The URL path this stands beside is capped at 25 MiB by the SSRF fetcher's
 * streamed byte limit. `readCanonicalAssetBytes` has no cap — it reads a
 * trusted private object — so the bound is reasserted here, or the byte path
 * would be strictly more permissive than the path it replaces.
 */
export const MAX_USER_BACKGROUND_BYTES = 25 * 1024 * 1024;

/** Formats sharp decodes reliably for these compositors. */
const SUPPORTED_MIME = new Set(['image/png', 'image/webp', 'image/jpeg', 'image/jpg']);

export type UserBackgroundRejectionReason =
  | 'capability_disabled'
  | 'asset_not_found'
  | 'asset_not_ready'
  | 'unsupported_mime_type'
  | 'asset_too_large'
  | 'bytes_unavailable';

export interface UserBackgroundResult {
  /** The bytes to composite, or null when none may be used. */
  bytes: Buffer | null;
  /**
   * Tenant-scoped cache identity for these bytes.
   *
   * Company FIRST and always present: a key built from asset identity alone
   * would let one tenant's render be served to another the moment two ids ever
   * coincided, and a process-global cache offers no second line of defence.
   */
  cacheKey: string | null;
  reason: UserBackgroundRejectionReason | null;
}

const NONE = (reason: UserBackgroundRejectionReason): UserBackgroundResult =>
  ({ bytes: null, cacheKey: null, reason });

/**
 * Resolve the `background` reference of a deterministic family into bytes.
 *
 * Returns bytes only when the capability is on AND a background reference
 * exists AND the asset is this company's, ready, decodable and within bounds.
 * Every other outcome returns null with a typed reason, because the renderer's
 * contract is to produce a creative either way — a picture that could not be
 * read must never cost the user their design.
 *
 * `condition` is the routed CONDITION lane. Reading `background` from it is not
 * a contradiction of the mode: routing decided WHICH references are eligible,
 * and this family then honours the eligible one the only way it can. Nothing
 * here re-decides purpose, and nothing but `background` is looked at.
 */
export async function resolveUserBackgroundBytes(input: {
  companyId: string | null | undefined;
  condition: readonly RoutedReference[] | null | undefined;
  width: number;
  height: number;
  /** The calling family's own capability gate, already evaluated. */
  enabled: boolean;
  /** Cache namespace, so two families never collide on one key. */
  namespace: string;
}): Promise<UserBackgroundResult> {
  if (!input.enabled) return NONE('capability_disabled');

  const companyId = String(input.companyId || '').trim();
  if (!companyId) return NONE('asset_not_found');

  /*
   * The FIRST background reference, and only that one.
   *
   * `ordinal` keeps its existing meaning — ordering within a purpose — and is
   * emphatically not read as a slide index. A carousel background applies to
   * the whole deck; per-slide targeting would need a contract this table does
   * not have, and inventing one silently is exactly what was ruled out.
   */
  const routed = (input.condition ?? []).find((r) => r.reference?.purpose === 'background');
  if (!routed) return { bytes: null, cacheKey: null, reason: null };

  // Tenancy before bytes. A foreign asset is never fetched, and is
  // indistinguishable from one that does not exist.
  const asset = await getCanonicalMediaAsset(companyId, routed.reference.assetId);
  if (!asset) return NONE('asset_not_found');
  if (!isUsableMediaAsset(asset)) return NONE('asset_not_ready');

  const mime = String(asset.mimeType || '').toLowerCase();
  if (!SUPPORTED_MIME.has(mime)) return NONE('unsupported_mime_type');

  if (typeof asset.byteSize === 'number' && asset.byteSize > MAX_USER_BACKGROUND_BYTES) {
    return NONE('asset_too_large');
  }

  const bytes = await readCanonicalAssetBytes(asset.storageBucket, asset.storagePath);
  if (!bytes) return NONE('bytes_unavailable');
  // The recorded size can disagree with the object; the bound is what matters,
  // so it applies to what was actually read as well as to what was claimed.
  if (bytes.byteLength > MAX_USER_BACKGROUND_BYTES) return NONE('asset_too_large');

  return {
    bytes,
    /*
     * Namespace · company · asset · canvas. Asset id is stable for the life of
     * the row and its bytes are immutable once `ready` — a replacement is a new
     * asset with a new id — so identity alone cannot serve stale pixels.
     * Dimensions are in the key because the cached value is the RESIZED buffer.
     */
    cacheKey: `${input.namespace}:${companyId}:${asset.id}:${input.width}x${input.height}`,
    reason: null,
  };
}

/** THE capability gate for user-owned carousel backgrounds. */
export function carouselUserBackgroundEnabled(): boolean {
  return process.env.CREATOR_CAROUSEL_USER_BACKGROUND_ENABLED === 'true';
}
