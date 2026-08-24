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
  CompositionAssetPurpose,
  CompositionAssetReference,
} from '../../../lib/content/compositionAssetReference';
import {
  CREATOR_COMPOSITION_TYPE,
  CREATOR_ASSET_DEFAULT_MODE,
  isCreatorAssetUsagePurpose,
} from '../../../lib/content/creatorCompositionAsset';

/** A stored upload, as `media_files` records it. */
interface MediaFileRow {
  id: string;
  user_id: string | null;
  storage_bucket: string | null;
  file_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  width: number | null;
  height: number | null;
  file_name: string | null;
  file_url: string | null;
}

/**
 * `mediaService` writes `file_path` as `<bucket>/<key>` while Supabase Storage
 * addresses the object by `<key>` alone. `canonical_media_assets` stores bucket
 * and path as the two separate values the storage API actually takes, so strip
 * the redundant prefix rather than persisting a path that resolves to nothing.
 */
export function storageKeyFromMediaPath(bucket: string, filePath: string): string {
  const b = String(bucket || '').replace(/^\/+|\/+$/g, '');
  const p = String(filePath || '').replace(/^\/+/, '');
  return b && p.startsWith(`${b}/`) ? p.slice(b.length + 1) : p;
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
    .select('id, user_id, storage_bucket, file_path, mime_type, file_size, width, height, file_name, file_url')
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

  const bucket = String(row.storage_bucket || '').trim();
  const filePath = String(row.file_path || '').trim();
  if (!bucket || !filePath) throw new Error('Uploaded file has no storage location');
  const storagePath = storageKeyFromMediaPath(bucket, filePath);

  const mimeType = String(row.mime_type || '').trim();
  if (!mimeType.startsWith('image/')) {
    throw new Error('Only image uploads can be attached to a composition');
  }

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
    byteSize: typeof row.file_size === 'number' ? row.file_size : null,
    width: typeof row.width === 'number' ? row.width : null,
    height: typeof row.height === 'number' ? row.height : null,
    originalFilename: row.file_name ?? null,
    sourceUrl: row.file_url ?? null,
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

  return addCompositionAssetReference({
    companyId,
    compositionType: CREATOR_COMPOSITION_TYPE,
    compositionId,
    assetId,
    purpose: input.purpose,
    mode: CREATOR_ASSET_DEFAULT_MODE,
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
  const attached = await attachCreatorCompositionAsset({
    companyId: input.companyId,
    compositionId: input.compositionId,
    assetId: input.assetId,
    purpose: input.purpose,
    ordinal: input.ordinal,
    metadata: input.metadata,
  });
  // Only after the new relationship exists, so a failure cannot leave the
  // composition with no asset at all.
  await detachCreatorCompositionAsset(input.companyId, input.referenceId);
  return attached;
}

/** Where else is this asset used? Proves detach did not orphan the file. */
export async function listCreatorAssetUsages(
  companyId: string,
  assetId: string,
): Promise<CompositionAssetReference[]> {
  return listReferencesForAsset(companyId, assetId);
}
