/**
 * COMPOSE lane — canonical asset bytes as deterministic composition layers.
 *
 * The generative lane (CONDITION) reaches the model through
 * `additionalReferences`. This is the other half: assets the user marked as
 * exact must be PLACED, pixel-for-pixel, and never handed to a provider.
 *
 *   canonical asset → storage.download(bucket, path) → Buffer
 *     → resize into the slot's declared box → { input, top, left }
 *     → the renderer's EXISTING composites array
 *
 * WHY download() AND NOT A URL
 * ----------------------------
 * `getPublicUrl` and `createSignedUrl` both mint a URL that leaves the server;
 * `bufferFromRemoteImage` then fetches it back over HTTP. For an asset a tenant
 * owns, that round-trip converts a private object into a fetchable address for
 * no benefit. `download()` returns the bytes in-process — no URL is created, no
 * path reaches the browser, and there is no new outbound request for the SSRF
 * layer to police.
 *
 * NO PROVIDER. Nothing here calls or imports the image provider. Compose is
 * deterministic by definition: if it could be reinterpreted, it would be
 * CONDITION.
 */

import { supabase } from '../db/supabaseClient';
import { getCanonicalMediaAsset } from './canonicalMediaAssetService';
import { isUsableMediaAsset } from '../../lib/content/canonicalMediaAsset';
import {
  validateTemplateAssetPlacement,
  type RoutedReference,
  type TemplateAssetPlacement,
  type TemplateAssetSlot,
} from '../../lib/content/compositionAssetRouting';
import { slotFor } from '../../lib/content/compositionAssetRouting';
import { sharp } from './creatorAssetRendererContracts';

/** One resolved layer, in the exact shape the renderer's composites array takes. */
export interface ComposeLayer {
  input: Buffer;
  top: number;
  left: number;
  /** Retained for assertions and diagnostics; the renderer uses input/top/left. */
  assetId: string;
  ordinal: number;
}

export type ComposeRejectionReason =
  | 'asset_not_found'
  | 'asset_not_ready'
  | 'slot_missing_placement'
  | 'slot_placement_invalid'
  | 'bytes_unavailable';

export interface ComposeRejection {
  referenceId: string;
  assetId: string;
  reason: ComposeRejectionReason;
  detail: string;
}

export interface ComposeLayersResult {
  layers: ComposeLayer[];
  rejected: ComposeRejection[];
}

/**
 * Fetch a canonical asset's bytes.
 *
 * Deliberately the ONLY byte source in this module, and deliberately not a URL.
 */
async function downloadCanonicalBytes(bucket: string, path: string): Promise<Buffer | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) return null;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Turn the routed COMPOSE lane into renderer layers.
 *
 * Ordering is the caller's `ordinal`, preserved end to end — a composition is a
 * stack, and re-sorting it would change which layer sits on top.
 */
export async function buildComposeLayers(input: {
  companyId: string;
  /** COMPOSE lane only. Passing the condition lane here would be a category error. */
  compose: readonly RoutedReference[];
  templateSlots?: readonly TemplateAssetSlot[];
  /** Canvas size the fractions resolve against. */
  width: number;
  height: number;
}): Promise<ComposeLayersResult> {
  const layers: ComposeLayer[] = [];
  const rejected: ComposeRejection[] = [];

  for (const routed of input.compose) {
    const reference = routed.reference;
    const reject = (reason: ComposeRejectionReason, detail: string) =>
      rejected.push({ referenceId: reference.id, assetId: reference.assetId, reason, detail });

    // Tenancy first, and through the company-scoped accessor — an asset id
    // alone must never be sufficient. A foreign asset and a missing one are
    // indistinguishable here, deliberately.
    const asset = await getCanonicalMediaAsset(input.companyId, reference.assetId);
    if (!asset) {
      reject('asset_not_found', 'The referenced asset does not exist for this company.');
      continue;
    }
    if (!isUsableMediaAsset(asset)) {
      reject('asset_not_ready', `Asset lifecycle is "${asset.lifecycleState}"; only "ready" assets may be composed.`);
      continue;
    }

    const slot = slotFor(input.templateSlots, reference.purpose);
    if (!slot?.placement) {
      reject('slot_missing_placement',
        `The template declares no placement for "${reference.purpose}", so it cannot be positioned.`);
      continue;
    }
    const geometry = validateTemplateAssetPlacement(slot.placement);
    if (!geometry.ok) {
      reject('slot_placement_invalid', geometry.errors.join('; '));
      continue;
    }
    const placement: TemplateAssetPlacement = slot.placement;

    const bytes = await downloadCanonicalBytes(asset.storageBucket, asset.storagePath);
    if (!bytes) {
      reject('bytes_unavailable', 'The stored object could not be read.');
      continue;
    }

    // Fractions resolve against the real canvas here — the same late-binding
    // `defaultBrandPlacement` already uses, so one template works at every
    // platform size.
    const boxWidth = Math.max(1, Math.round(placement.maxWidth * input.width));
    const boxHeight = Math.max(1, Math.round(placement.maxHeight * input.height));
    const top = Math.round(placement.top * input.height);
    const left = Math.round(placement.left * input.width);

    // `fit` is passed through as declared. `contain` keeps every source pixel;
    // substituting one for the other silently changes whether the asset is
    // cropped, which is exactly the guarantee the mode encodes.
    const resized = await sharp(bytes, { failOn: 'none' })
      .resize({ width: boxWidth, height: boxHeight, fit: placement.fit ?? 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    layers.push({ input: resized, top, left, assetId: asset.id, ordinal: reference.ordinal });
  }

  return { layers, rejected };
}
