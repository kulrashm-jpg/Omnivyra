/**
 * Canonical Media Asset — repository/service layer.
 *
 * The ONLY way this table is read or written. Every function takes an explicit
 * `companyId` and filters on it, so a caller cannot accidentally reach another
 * tenant's asset by holding an id: an id alone is never sufficient.
 *
 * That signature is the point. The audit found media_files anchored on user_id
 * with no company column, which forced "tenant == row owner" and left
 * /api/media/* reachable across tenants until MEDIA-SEC-001 closed it. The
 * canonical table refuses to inherit that equivalence — `created_by` is
 * provenance and is never consulted for access.
 *
 * ADDITIVE. Nothing calls this yet. It replaces no existing service, redirects
 * no endpoint and changes no existing authorization behaviour; media_files,
 * creator_assets and creator_asset_attachments are untouched.
 *
 * Uses `ownedDbTable` — the repository's standard observability-wrapped table
 * accessor — rather than a bespoke client.
 */

import { ownedDbTable } from '../db/writeOwner';
import { supabase } from '../db/supabaseClient';
import {
  canTransitionMediaAsset,
  validateCanonicalMediaAssetInput,
  type CanonicalMediaAsset,
  type CanonicalMediaAssetInput,
  type MediaAssetLifecycleState,
} from '../../lib/content/canonicalMediaAsset';

const TABLE = 'canonical_media_assets';

/**
 * The reference table, named here rather than imported.
 *
 * `compositionAssetReferenceService` imports `getCanonicalMediaAsset` from THIS
 * module, so importing its `listReferencesForAsset` back would close a runtime
 * cycle (`check:runtime-cycles` enforces against exactly that). Deletion needs
 * only "does any reference exist", which is one scoped existence probe, so the
 * table name is duplicated deliberately in preference to the cycle.
 */
const REFERENCE_TABLE = 'composition_asset_references';

/** Thrown when an asset is still in use. Distinct so callers can map it to 409. */
export const ASSET_STILL_REFERENCED = 'Asset is still referenced by a composition';

/** Columns every read projects. Explicit so a schema addition cannot silently widen reads. */
const COLUMNS =
  'id, company_id, created_by, storage_bucket, storage_path, mime_type, byte_size, width, height, checksum_sha256, original_filename, source_url, origin, lifecycle_state, metadata, created_at, updated_at';

type Row = Record<string, unknown>;

function toDomain(row: Row): CanonicalMediaAsset {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    createdBy: row.created_by == null ? null : String(row.created_by),
    storageBucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
    mimeType: String(row.mime_type),
    byteSize: row.byte_size == null ? null : Number(row.byte_size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    checksumSha256: row.checksum_sha256 == null ? null : String(row.checksum_sha256),
    originalFilename: row.original_filename == null ? null : String(row.original_filename),
    sourceUrl: row.source_url == null ? null : String(row.source_url),
    origin: row.origin as CanonicalMediaAsset['origin'],
    lifecycleState: row.lifecycle_state as MediaAssetLifecycleState,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Register a storage object as a canonical asset.
 *
 * Created `pending` always — never `ready`. The caller may know it just wrote
 * the bytes, but "I uploaded it" and "the object is verified readable" are
 * different claims, and the two-step upload path already distinguishes them.
 * Promotion is an explicit, separate act.
 */
export async function createCanonicalMediaAsset(
  input: CanonicalMediaAssetInput,
): Promise<CanonicalMediaAsset> {
  const validation = validateCanonicalMediaAssetInput(input);
  if (!validation.ok) {
    throw new Error(`Invalid canonical media asset: ${validation.errors.join('; ')}`);
  }

  const { data, error } = await ownedDbTable(TABLE)
    .insert({
      company_id: input.companyId,
      created_by: input.createdBy ?? null,
      storage_bucket: input.storageBucket,
      storage_path: input.storagePath,
      mime_type: input.mimeType,
      byte_size: input.byteSize ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum_sha256: input.checksumSha256 ?? null,
      original_filename: input.originalFilename ?? null,
      source_url: input.sourceUrl ?? null,
      origin: input.origin,
      lifecycle_state: 'pending',
      metadata: input.metadata ?? {},
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to create canonical media asset: ${error.message}`);
  return toDomain(data as Row);
}

/**
 * Fetch one asset within a company. Returns null when it does not exist OR
 * belongs to another company — the caller learns nothing either way, so an id
 * cannot be used to probe for a foreign asset's existence.
 */
export async function getCanonicalMediaAsset(
  companyId: string,
  assetId: string,
): Promise<CanonicalMediaAsset | null> {
  if (!companyId?.trim() || !assetId?.trim()) return null;

  const { data, error } = await ownedDbTable(TABLE)
    .select(COLUMNS)
    .eq('company_id', companyId)
    .eq('id', assetId)
    .maybeSingle();

  if (error) throw new Error(`Failed to read canonical media asset: ${error.message}`);
  return data ? toDomain(data as Row) : null;
}

/** List a company's assets, newest first. Optionally only the usable ones. */
export async function listCanonicalMediaAssets(
  companyId: string,
  options?: { lifecycleState?: MediaAssetLifecycleState; limit?: number },
): Promise<CanonicalMediaAsset[]> {
  if (!companyId?.trim()) return [];

  let query = ownedDbTable(TABLE)
    .select(COLUMNS)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (options?.lifecycleState) query = query.eq('lifecycle_state', options.lifecycleState);
  if (options?.limit) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list canonical media assets: ${error.message}`);
  return (data ?? []).map((row) => toDomain(row as Row));
}

/**
 * Move an asset's lifecycle forward.
 *
 * The legality of the move is checked against the asset's CURRENT persisted
 * state, not against what the caller believes it to be — so a stale caller
 * cannot resurrect a failed asset or re-promote a ready one.
 */
export async function setCanonicalMediaAssetLifecycle(
  companyId: string,
  assetId: string,
  next: MediaAssetLifecycleState,
): Promise<CanonicalMediaAsset> {
  const current = await getCanonicalMediaAsset(companyId, assetId);
  if (!current) throw new Error('Canonical media asset not found');

  if (!canTransitionMediaAsset(current.lifecycleState, next)) {
    throw new Error(
      `Illegal lifecycle transition: ${current.lifecycleState} -> ${next}`,
    );
  }

  const { data, error } = await ownedDbTable(TABLE)
    .update({ lifecycle_state: next, updated_at: new Date().toISOString() })
    .eq('company_id', companyId)
    .eq('id', assetId)
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to update canonical media asset: ${error.message}`);
  return toDomain(data as Row);
}

/**
 * Delete one asset within a company: the row, then its storage object.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other artifact in this flow could already be removed through a
 * supported path — the reference by detach, the upload and its bytes by
 * `DELETE /api/media/[id]` — but a canonical row could not, so any asset ever
 * created was permanent. That is what blocked controlled production testing.
 * Nothing in the contract, the migration or the table asks for retention; the
 * omission was an omission.
 *
 * REFUSES WHILE REFERENCED. The composite foreign key is `ON DELETE CASCADE`,
 * so deleting a referenced asset would silently destroy the user's composition
 * relationships — including ones in OTHER compositions, since an asset is
 * "reusable by design". Detach is deliberately not deletion, and deletion is
 * deliberately not a cascading detach: the caller must detach first.
 *
 * ORDERING: row first, object second — the opposite of `deleteMediaFile`.
 * Both orders can fail halfway, and Supabase gives no transaction spanning the
 * database and storage, so the choice is which residue is safer:
 *
 *   row → object   worst case leaves BYTES with no row. Nothing reads them;
 *                  the cost is storage.
 *   object → row   worst case leaves a ROW pointing at bytes that are gone,
 *                  which the compose and condition lanes would then try to
 *                  download mid-render. That is a user-visible failure.
 *
 * Orphaned bytes are a cost; a dangling row is a defect. Hence row first. The
 * residual failure mode is therefore an orphaned storage object, and it is NOT
 * cleaned up here — this phase adds no janitor.
 *
 * Returns true when a row was deleted, false when there was nothing to delete.
 * A missing asset and another company's asset both return false: the caller
 * learns nothing either way, matching `getCanonicalMediaAsset`.
 */
export async function deleteCanonicalMediaAsset(
  companyId: string,
  assetId: string,
): Promise<boolean> {
  if (!companyId?.trim() || !assetId?.trim()) return false;

  // Company-scoped read first. This is the ONLY authorization input, and it
  // also supplies the bucket and path — the client never names either, so an
  // arbitrary storage location is not expressible through this function.
  const asset = await getCanonicalMediaAsset(companyId, assetId);
  if (!asset) return false;

  const { data: refRows, error: refError } = await ownedDbTable(REFERENCE_TABLE)
    .select('id')
    .eq('company_id', companyId)
    .eq('asset_id', assetId)
    .limit(1);
  if (refError) {
    throw new Error(`Failed to check composition references: ${refError.message}`);
  }
  if (Array.isArray(refRows) && refRows.length > 0) {
    throw new Error(`${ASSET_STILL_REFERENCED}; detach it before deleting.`);
  }

  const { error: deleteError } = await ownedDbTable(TABLE)
    .delete()
    .eq('company_id', companyId)
    .eq('id', assetId);
  if (deleteError) {
    // Storage is untouched, so the asset remains wholly intact and retryable.
    throw new Error(`Failed to delete canonical media asset: ${deleteError.message}`);
  }

  // Best effort, and deliberately after the row. A storage object that is
  // already gone is success, not an error: the desired end state is reached.
  try {
    const { error: storageError } = await supabase.storage
      .from(asset.storageBucket)
      .remove([asset.storagePath]);
    if (storageError) {
      console.warn('[canonical-media-asset][storage-orphan]', {
        companyId,
        assetId,
        reason: storageError.message,
      });
    }
  } catch (err) {
    console.warn('[canonical-media-asset][storage-orphan]', {
      companyId,
      assetId,
      reason: (err as Error)?.message ?? String(err),
    });
  }

  return true;
}
