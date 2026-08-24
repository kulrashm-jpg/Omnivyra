/**
 * CONDITION lane — canonical asset bytes as provider reference input.
 *
 * Phase 59B gave COMPOSE its bytes. This is the other lane: assets the user
 * marked as references, delivered to `images.edit` as actual image input rather
 * than described in words.
 *
 *   canonical asset → storage.download(bucket, path) → Buffer
 *     → generateProviderImage({ referenceImages })  → images.edit
 *
 * WHY BYTES AND NOT A URL
 * -----------------------
 * The pre-existing edit path took a single `referenceImageUrl` and re-fetched
 * it over HTTP, which is right for the public showcase image it was built for.
 * For an asset a tenant owns it would be wrong twice: it turns a private object
 * into a fetchable address, and it adds an outbound request for the SSRF layer
 * to police. `download()` returns the bytes in-process.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This does not make COMPOSE and CONDITION interchangeable. Compose preserves
 * pixels; condition hands them to a model that may reinterpret them freely.
 * Only the condition lane reaches this module, and only ever as provider input.
 */

import { supabase } from '../db/supabaseClient';
import { getCanonicalMediaAsset } from './canonicalMediaAssetService';
import { isUsableMediaAsset } from '../../lib/content/canonicalMediaAsset';
import type { RoutedReference } from '../../lib/content/compositionAssetRouting';
import { resolveProviderCapabilities } from './creator/creatorMultimodalReferences';

/**
 * Formats the model accepts. From the installed SDK's own contract for
 * gpt-image-1: "each image should be a `png`, `webp`, or `jpg` file less than
 * 50MB." Anything else is refused here rather than at the provider, so the
 * caller learns which asset was unusable and why.
 */
const SUPPORTED_MIME = new Set(['image/png', 'image/webp', 'image/jpeg', 'image/jpg']);
const MAX_REFERENCE_BYTES = 50 * 1024 * 1024;

export interface ConditionReferenceBytes {
  bytes: Buffer;
  mimeType: string;
  assetId: string;
  ordinal: number;
}

export type ConditionRejectionReason =
  | 'asset_not_found'
  | 'asset_not_ready'
  | 'unsupported_mime_type'
  | 'reference_too_large'
  | 'bytes_unavailable'
  | 'provider_reference_limit_exceeded';

export interface ConditionRejection {
  referenceId: string;
  assetId: string;
  reason: ConditionRejectionReason;
  detail: string;
}

export interface ConditionReferencesResult {
  references: ConditionReferenceBytes[];
  rejected: ConditionRejection[];
  /**
   * True when the resolved endpoint cannot take image input at all, so these
   * would reach the model only as text descriptors. Reported, never implied:
   * "the model saw your photo" and "the model read a sentence about your photo"
   * are different products.
   */
  degradedToText: boolean;
}

async function downloadBytes(bucket: string, path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Resolve the CONDITION lane into provider-ready bytes.
 *
 * Cardinality beyond the endpoint's documented maximum is a TYPED REJECTION,
 * never a silent slice: a user who attached twenty references must be told
 * which four were not sent, not quietly given four.
 */
export async function resolveConditionReferenceBytes(input: {
  companyId: string;
  /** CONDITION lane only. The compose lane must never be passed here. */
  condition: readonly RoutedReference[];
  providerId: string;
  /** The operation actually about to be called. Capability depends on it. */
  endpoint: 'generate' | 'edit';
}): Promise<ConditionReferencesResult> {
  const references: ConditionReferenceBytes[] = [];
  const rejected: ConditionRejection[] = [];
  const capability = resolveProviderCapabilities(input.providerId, input.endpoint);

  if (!capability.acceptsReferenceImages) {
    // Not a failure: the existing text-descriptor fallback still runs upstream.
    // Surfaced so no caller can represent it as image conditioning.
    return { references: [], rejected: [], degradedToText: input.condition.length > 0 };
  }

  for (const routed of input.condition) {
    const reference = routed.reference;
    const reject = (reason: ConditionRejectionReason, detail: string) =>
      rejected.push({ referenceId: reference.id, assetId: reference.assetId, reason, detail });

    // Tenancy before bytes — a foreign asset is never even fetched, and a
    // missing one is indistinguishable from it.
    const asset = await getCanonicalMediaAsset(input.companyId, reference.assetId);
    if (!asset) {
      reject('asset_not_found', 'The referenced asset does not exist for this company.');
      continue;
    }
    if (!isUsableMediaAsset(asset)) {
      reject('asset_not_ready', `Asset lifecycle is "${asset.lifecycleState}"; only "ready" assets may be sent.`);
      continue;
    }

    const mime = String(asset.mimeType || '').toLowerCase();
    if (!SUPPORTED_MIME.has(mime)) {
      reject('unsupported_mime_type', `The provider accepts png, webp or jpg; this asset is "${mime}".`);
      continue;
    }
    if (typeof asset.byteSize === 'number' && asset.byteSize > MAX_REFERENCE_BYTES) {
      reject('reference_too_large', `The provider accepts images under 50MB; this asset is ${asset.byteSize} bytes.`);
      continue;
    }

    // Capacity is checked BEFORE the download so a reference that cannot be
    // sent is never fetched — and is reported, not dropped.
    if (references.length >= capability.maxReferenceImages) {
      reject('provider_reference_limit_exceeded',
        `The endpoint accepts at most ${capability.maxReferenceImages} reference image(s).`);
      continue;
    }

    const bytes = await downloadBytes(asset.storageBucket, asset.storagePath);
    if (!bytes) {
      reject('bytes_unavailable', 'The stored object could not be read.');
      continue;
    }

    references.push({ bytes, mimeType: mime, assetId: asset.id, ordinal: reference.ordinal });
  }

  return { references, rejected, degradedToText: false };
}
