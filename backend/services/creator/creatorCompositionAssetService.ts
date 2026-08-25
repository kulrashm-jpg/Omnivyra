/**
 * Content Creator composition assets — server orchestration.
 *
 * Two jobs, both thin:
 *
 *   1. Promote a file the EXISTING upload path already stored into a canonical
 *      media asset. `/api/media/upload` -> mediaService.uploadMedia() ->
 *      Supabase Storage + a `media_files` row is untouched and remains the only
 *      upload implementation. This adds canonical IDENTITY on top of it; it
 *      does not move bytes, and it does not replace `media_files`.
 *
 *   2. Attach / list / detach that asset against a Creator draft, through
 *      `compositionAssetReferenceService` — the canonical write boundary. UI
 *      code never touches either table.
 *
 * TENANCY. `media_files` is anchored on `user_id` and has NO company column
 * (the very asymmetry `canonical_media_assets` exists to end), so promotion
 * takes tenancy from an explicit `companyId` the caller has already been
 * authorised for, and separately proves the FILE is the caller's by matching
 * `media_files.user_id`. The client never supplies a bucket or a path: it
 * supplies a `media_files` id, and everything else is read from that row. A
 * forged path is therefore not expressible.
 */

import { supabase } from '../../db/supabaseClient';
import {
  createCanonicalMediaAsset,
  getCanonicalMediaAsset,
  setCanonicalMediaAssetLifecycle,
} from '../canonicalMediaAssetService';
import {
  addCompositionAssetReference,
  listCompositionAssetReferences,
  removeCompositionAssetReference,
  listReferencesForAsset,
} from '../compositionAssetReferenceService';
import type { CanonicalMediaAsset } from '../../../lib/content/canonicalMediaAsset';
import { isUsableMediaAsset } from '../../../lib/content/canonicalMediaAsset';
import type {
  CompositionAssetMode,
  CompositionAssetPurpose,
  CompositionAssetReference,
} from '../../../lib/content/compositionAssetReference';
import {
  defaultModeForPurpose,
  isModeAllowedForPurpose,
} from '../../../lib/content/compositionAssetRouting';
import {
  CREATOR_COMPOSITION_TYPE,
  isCreatorAssetUsagePurpose,
} from '../../../lib/content/creatorCompositionAsset';
import {
  parseMediaStorageLocator,
  parseMediaDimensions,
} from '../../../lib/content/mediaStorageLocator';

/**
 * A stored upload, as production `media_files` ACTUALLY records it.
 *
 * This previously named `storage_bucket`, `file_path`, `mime_type`, `file_size`,
 * `width`, `height` and `file_url` — none of which exist on the production
 * table. The SELECT itself failed ("column media_files.storage_bucket does not
 * exist"), so canonical registration could never succeed against production.
 * The fields below are the real ones; `storage_url` carries the location.
 */
interface MediaFileRow {
  id: string;
  user_id: string | null;
  storage_url: string | null;
  file_type: string | null;
  file_size_bytes: number | null;
  dimensions: string | null;
  metadata: unknown;
  file_name: string | null;
}

export interface RegisterUploadedAssetInput {
  companyId: string;
  /** The authenticated user. Proves the file is theirs; also stored as provenance. */
  userId: string;
  /** `media_files.id` from the existing upload response. */
  mediaFileId: string;
}

/**
 * Promote an already-uploaded file to a canonical media asset.
 *
 * Returns an asset in `ready`: the upload endpoint validated the bytes and wrote
 * the object synchronously before responding, so by the time a caller holds a
 * `media_files` id the file IS readable. `pending` exists for the two-step
 * resumable path (stream, then verify), which is not this one — inventing a
 * pending state here would mean nothing ever moved it to ready.
 *
 * Idempotent on (storage_bucket, storage_path): that pair is UNIQUE on the
 * table, so re-registering the same upload returns the existing asset instead
 * of failing or creating a twin.
 */
export async function registerUploadedMediaAsset(
  input: RegisterUploadedAssetInput,
): Promise<CanonicalMediaAsset> {
  const companyId = String(input?.companyId || '').trim();
  const userId = String(input?.userId || '').trim();
  const mediaFileId = String(input?.mediaFileId || '').trim();
  if (!companyId) throw new Error('companyId is required');
  if (!userId) throw new Error('userId is required');
  if (!mediaFileId) throw new Error('mediaFileId is required');

  const { data, error } = await supabase
    .from('media_files')
    .select('id, user_id, storage_url, file_type, file_size_bytes, dimensions, metadata, file_name')
    .eq('id', mediaFileId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read uploaded file: ${error.message}`);

  const row = data as MediaFileRow | null;
  // A file that is not the caller's and a file that does not exist produce the
  // same error, deliberately: distinguishing them would make this an existence
  // oracle for other people's upload ids.
  if (!row || String(row.user_id || '') !== userId) {
    throw new Error('Uploaded file not found for this user');
  }

  /*
   * The location comes from `storage_url`, which the server itself wrote via
   * `getPublicUrl`. It is parsed — never trusted from a caller and never
   * rebuilt into a URL — and a locator that is not a known-bucket public
   * object fails closed rather than resolving to a guessed object.
   */
  const locator = parseMediaStorageLocator(row.storage_url);
  if (!locator.ok) {
    throw new Error(`Uploaded file has no usable storage location: ${locator.error}`);
  }
  const bucket = locator.bucket;
  const storagePath = locator.path;

  const mimeType = String(row.file_type || '').trim();
  if (!mimeType.startsWith('image/')) {
    throw new Error('Only image uploads can be attached to a composition');
  }

  // Absent or unparseable dimensions stay NULL. A guessed size would be
  // indistinguishable downstream from a measured one.
  const { width, height } = parseMediaDimensions(row.dimensions, row.metadata);

  // Reuse rather than duplicate — the storage pair is UNIQUE, and the same file
  // registered twice is the same asset.
  const existing = await findCanonicalAssetByStorage(companyId, bucket, storagePath);
  if (existing) return existing;

  const created = await createCanonicalMediaAsset({
    companyId,
    createdBy: userId,
    storageBucket: bucket,
    storagePath,
    mimeType,
    byteSize: typeof row.file_size_bytes === 'number' ? row.file_size_bytes : null,
    width,
    height,
    originalFilename: row.file_name ?? null,
    // Provenance only — the canonical record of where this row came from. It is
    // never read back to address the object; `storageBucket`/`storagePath` are.
    sourceUrl: row.storage_url ?? null,
    origin: 'upload',
    // Trace only — how this canonical row came to exist. No application
    // semantics, and emphatically no usage: usage is the relationship's job.
    metadata: { mediaFileId: row.id },
  });

  // The bytes are already verified and readable, so the asset is usable now.
  const ready = await setCanonicalMediaAssetLifecycle(companyId, created.id, 'ready');
  return ready ?? created;
}

/** Look up a canonical asset by its storage location within one company. */
async function findCanonicalAssetByStorage(
  companyId: string,
  storageBucket: string,
  storagePath: string,
): Promise<CanonicalMediaAsset | null> {
  const { data, error } = await supabase
    .from('canonical_media_assets')
    .select('id')
    .eq('company_id', companyId)
    .eq('storage_bucket', storageBucket)
    .eq('storage_path', storagePath)
    .maybeSingle();
  if (error || !data) return null;
  return getCanonicalMediaAsset(companyId, String((data as { id: string }).id));
}

export interface AttachCreatorAssetInput {
  companyId: string;
  compositionId: string;
  assetId: string;
  purpose: CompositionAssetPurpose;
  /**
   * Optional. Omitted — which is what Content Creator does — the mode is
   * DERIVED from the purpose by the one routing policy. Stated, it is honoured
   * or refused, never quietly corrected.
   */
  mode?: CompositionAssetMode;
  ordinal?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Attach an asset to a Creator draft in a stated role.
 *
 * Refuses an asset that is not `ready`: a reference pointing at a half-written
 * or failed upload would be a composition that cannot render, and the failure
 * would surface far from its cause.
 */
export async function attachCreatorCompositionAsset(
  input: AttachCreatorAssetInput,
): Promise<CompositionAssetReference> {
  const companyId = String(input?.companyId || '').trim();
  const compositionId = String(input?.compositionId || '').trim();
  const assetId = String(input?.assetId || '').trim();
  if (!companyId) throw new Error('companyId is required');
  if (!compositionId) throw new Error('compositionId is required');
  if (!assetId) throw new Error('assetId is required');

  if (!isCreatorAssetUsagePurpose(input?.purpose)) {
    throw new Error('purpose is not one Content Creator offers');
  }

  // Resolves within the company, so another tenant's asset reads as absent.
  const asset = await getCanonicalMediaAsset(companyId, assetId);
  if (!asset) throw new Error('Canonical media asset not found for this company');
  if (!isUsableMediaAsset(asset)) {
    throw new Error(`Asset is not ready (lifecycle: ${asset.lifecycleState})`);
  }

  /*
   * The mode is DERIVED from the purpose, never assumed.
   *
   * Attaching everything as `compose` was the defect: it is the wrong
   * guarantee for a purpose the policy defines as CONDITION-only, so a
   * `style_reference` was persisted in a mode its own purpose forbids and was
   * dropped at render — and a `product` could never satisfy the one template
   * slot that asks for `condition`. `defaultModeForPurpose` is the single
   * existing policy; deriving from it is what makes the stored relationship
   * mean what the user chose.
   */
  const mode = input.mode ?? defaultModeForPurpose(input.purpose);
  if (!isModeAllowedForPurpose(input.purpose, mode)) {
    // A stated mode is refused, not corrected — the caller asked for a
    // guarantee this purpose cannot give, and silently substituting another
    // would be the same lie in the opposite direction.
    throw new Error(`Mode "${mode}" is not allowed for purpose "${input.purpose}"`);
  }

  return addCompositionAssetReference({
    companyId,
    compositionType: CREATOR_COMPOSITION_TYPE,
    compositionId,
    assetId,
    purpose: input.purpose,
    mode,
    ordinal: typeof input.ordinal === 'number' ? input.ordinal : 0,
    metadata: input.metadata,
  });
}

/** Every asset attached to one Creator draft, in the canonical total order. */
export async function listCreatorCompositionAssets(
  companyId: string,
  compositionId: string,
): Promise<CompositionAssetReference[]> {
  return listCompositionAssetReferences(companyId, CREATOR_COMPOSITION_TYPE, compositionId);
}

/** A reference together with the asset it points at. */
export interface CreatorCompositionAsset {
  reference: CompositionAssetReference;
  asset: CanonicalMediaAsset | null;
}

/**
 * The draft's attachments, resolved for display.
 *
 * The reference carries identity and usage but no way to SHOW the image, so the
 * asset is resolved alongside it — within the same company, so a reference whose
 * asset is gone or foreign yields `asset: null` rather than leaking anything.
 * Order is the reference order; resolution never reorders.
 */
export async function listCreatorCompositionAssetsResolved(
  companyId: string,
  compositionId: string,
): Promise<CreatorCompositionAsset[]> {
  const references = await listCreatorCompositionAssets(companyId, compositionId);
  return Promise.all(references.map(async (reference) => ({
    reference,
    asset: await getCanonicalMediaAsset(companyId, reference.assetId),
  })));
}

/**
 * Detach one reference.
 *
 * Removes the RELATIONSHIP only. The canonical asset survives, because it is
 * reusable by design and may already be referenced by another composition —
 * deleting the file because one draft stopped using it is exactly the coupling
 * the asset/reference split exists to prevent.
 */
export async function detachCreatorCompositionAsset(
  companyId: string,
  referenceId: string,
): Promise<void> {
  await removeCompositionAssetReference(companyId, referenceId);
}

/**
 * Replace whatever currently occupies a purpose with a different asset.
 *
 * "Replace" was an append. The uniqueness key includes `asset_id`, so a second
 * upload under the same purpose is a legitimately distinct row — the database
 * had no reason to refuse it — and the composition ended up holding both the
 * old image and the new one while the panel, which shows a single attachment,
 * displayed only one of them. The other stayed invisible and kept feeding the
 * render.
 *
 * Order is attach-then-detach, matching `changeCreatorCompositionAssetUsage`:
 * if the detach fails the composition still has an asset for that purpose,
 * whereas detach-first would leave it with none.
 *
 * Only the named purpose is touched. A subject being replaced says nothing
 * about the background or the logo, and removing them would discard choices the
 * user never revisited.
 *
 * The canonical asset behind the displaced reference is NOT deleted: it belongs
 * to the company's library, may be referenced by another composition, and
 * outliving one draft's use of it is the entire point of separating identity
 * from usage.
 */
export async function replaceCreatorCompositionAssetForPurpose(input: {
  companyId: string;
  compositionId: string;
  assetId: string;
  purpose: CompositionAssetPurpose;
  mode?: CompositionAssetMode;
  ordinal?: number;
  metadata?: Record<string, unknown>;
  /**
   * A reference the CALLER is replacing, whatever purpose it holds.
   *
   * The purpose-scoped rule alone is not enough for a single-image surface: a
   * panel that shows one attachment and offers "Replace" means "this image
   * becomes that one", and if the replacement is given a different usage the
   * old reference would survive under its old purpose — attached, invisible,
   * and still reaching the render. The surface states what it is replacing.
   */
  replacesReferenceId?: string | null;
}): Promise<{ reference: CompositionAssetReference; replacedReferenceIds: string[] }> {
  const companyId = String(input?.companyId || '').trim();
  const compositionId = String(input?.compositionId || '').trim();
  const assetId = String(input?.assetId || '').trim();

  // Read BEFORE attaching, so the new reference is never mistaken for one of
  // the ones being displaced.
  const occupying = (await listCreatorCompositionAssets(companyId, compositionId))
    .filter((r) => r.purpose === input.purpose);
  const already = occupying.find((r) => r.assetId === assetId) ?? null;
  const stale = occupying.filter((r) => r.assetId !== assetId);

  /*
   * Re-attaching what is already attached is the same request twice — a double
   * click, a retry — and the uniqueness key would refuse it as a duplicate. The
   * requested state already holds, so report it rather than fail it, and still
   * clear anything else sitting in this purpose.
   */
  const reference = already ?? await attachCreatorCompositionAsset({
    companyId,
    compositionId,
    assetId,
    purpose: input.purpose,
    mode: input.mode,
    ordinal: input.ordinal,
    metadata: input.metadata,
  });

  const supersededId = String(input.replacesReferenceId || '').trim();
  const displaced = supersededId && supersededId !== reference.id
    && !stale.some((r) => r.id === supersededId)
      ? [...stale, { id: supersededId } as CompositionAssetReference]
      : stale;

  const replacedReferenceIds: string[] = [];
  for (const gone of displaced) {
    await detachCreatorCompositionAsset(companyId, gone.id);
    replacedReferenceIds.push(gone.id);
  }
  return { reference, replacedReferenceIds };
}

/**
 * Change how an attached asset is used, without re-uploading it.
 *
 * `purpose` is part of the uniqueness key, so a change is a detach plus an
 * attach of the SAME `assetId`. One canonical asset, one new relationship —
 * never a second copy of the file.
 */
export async function changeCreatorCompositionAssetUsage(input: {
  companyId: string;
  compositionId: string;
  referenceId: string;
  assetId: string;
  purpose: CompositionAssetPurpose;
  ordinal?: number;
  metadata?: Record<string, unknown>;
}): Promise<CompositionAssetReference> {
  // Moving into a purpose that another asset already occupies displaces it —
  // the destination holds one asset, exactly as the source did.
  const { reference } = await replaceCreatorCompositionAssetForPurpose({
    companyId: input.companyId,
    compositionId: input.compositionId,
    assetId: input.assetId,
    purpose: input.purpose,
    ordinal: input.ordinal,
    metadata: input.metadata,
  });
  // Only after the new relationship exists, so a failure cannot leave the
  // composition with no asset at all.
  if (reference.id !== input.referenceId) {
    await detachCreatorCompositionAsset(input.companyId, input.referenceId);
  }
  return reference;
}

/** Where else is this asset used? Proves detach did not orphan the file. */
export async function listCreatorAssetUsages(
  companyId: string,
  assetId: string,
): Promise<CompositionAssetReference[]> {
  return listReferencesForAsset(companyId, assetId);
}
