/**
 * Composition Asset Reference — repository/service layer.
 *
 * The only way `composition_asset_references` is read or written. Like the
 * Phase 43 asset service, every accessor takes an explicit `companyId` and
 * filters on it, so holding a reference id is never sufficient to reach another
 * tenant's row.
 *
 * The cross-tenant guarantee here is defence in depth, and the order matters:
 *   1. the DATABASE refuses structurally — the composite FK (company_id,
 *      asset_id) -> (company_id, id) means naming an asset requires naming its
 *      owner, so company B cannot attach company A's asset even by direct SQL;
 *   2. this service ALSO resolves the asset through the Phase 43 accessor
 *      first, so the attempt fails with a clear error instead of a raw FK
 *      violation, and so a missing asset and a foreign asset are indistinguish-
 *      able to the caller — which is what stops a reference attempt being used
 *      to probe whether another tenant's asset id exists.
 *
 * ADDITIVE. Nothing calls this yet. The provider seam
 * (creatorMultimodalReferences / generateProviderImage / images.edit) is
 * untouched; no existing flow reads these rows.
 */

import { ownedDbTable } from '../db/writeOwner';
import { getCanonicalMediaAsset } from './canonicalMediaAssetService';
import {
  compareCompositionAssetReferences,
  validateCompositionAssetReferenceInput,
  type CompositionAssetMode,
  type CompositionAssetPurpose,
  type CompositionAssetReference,
  type CompositionAssetReferenceInput,
} from '../../lib/content/compositionAssetReference';

const TABLE = 'composition_asset_references';

/** Explicit projection so a later schema addition cannot silently widen reads. */
const COLUMNS =
  'id, company_id, composition_type, composition_id, asset_id, purpose, mode, ordinal, created_at, updated_at';

type Row = Record<string, unknown>;

function toDomain(row: Row): CompositionAssetReference {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    compositionType: String(row.composition_type),
    compositionId: String(row.composition_id),
    assetId: String(row.asset_id),
    purpose: row.purpose as CompositionAssetPurpose,
    mode: row.mode as CompositionAssetMode,
    ordinal: Number(row.ordinal ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Attach an asset to a composition in a stated role.
 *
 * The asset is resolved within the caller's company BEFORE the insert. A
 * missing asset and another tenant's asset produce the same error, deliberately:
 * distinguishing them would turn this into an existence oracle for foreign ids.
 */
export async function addCompositionAssetReference(
  input: CompositionAssetReferenceInput,
): Promise<CompositionAssetReference> {
  const validation = validateCompositionAssetReferenceInput(input);
  if (!validation.ok) {
    throw new Error(`Invalid composition asset reference: ${validation.errors.join('; ')}`);
  }

  const asset = await getCanonicalMediaAsset(input.companyId, input.assetId);
  if (!asset) {
    throw new Error('Referenced canonical media asset not found for this company');
  }

  const { data, error } = await ownedDbTable(TABLE)
    .insert({
      company_id: input.companyId,
      composition_type: input.compositionType,
      composition_id: input.compositionId,
      asset_id: input.assetId,
      purpose: input.purpose,
      mode: input.mode,
      ordinal: input.ordinal ?? 0,
    })
    .select(COLUMNS)
    .single();

  if (error) throw new Error(`Failed to add composition asset reference: ${error.message}`);
  return toDomain(data as Row);
}

/**
 * Every reference for one composition, in deterministic order.
 *
 * `ordinal` alone is not a total order — ties are permitted so that reordering
 * does not have to dodge a unique constraint — so the comparator resolves ties
 * on (created_at, id). Sorting here rather than relying solely on the database
 * keeps the order identical regardless of how the rows arrive.
 */
export async function listCompositionAssetReferences(
  companyId: string,
  compositionType: string,
  compositionId: string,
): Promise<CompositionAssetReference[]> {
  if (!companyId?.trim() || !compositionType?.trim() || !compositionId?.trim()) return [];

  const { data, error } = await ownedDbTable(TABLE)
    .select(COLUMNS)
    .eq('company_id', companyId)
    .eq('composition_type', compositionType)
    .eq('composition_id', compositionId)
    .order('ordinal', { ascending: true });

  if (error) throw new Error(`Failed to list composition asset references: ${error.message}`);
  return (data ?? []).map((row) => toDomain(row as Row)).sort(compareCompositionAssetReferences);
}

/**
 * Where is this asset used? Needed before an asset can ever be safely retired,
 * and the reason asset identity had to survive reuse in the first place.
 */
export async function listReferencesForAsset(
  companyId: string,
  assetId: string,
): Promise<CompositionAssetReference[]> {
  if (!companyId?.trim() || !assetId?.trim()) return [];

  const { data, error } = await ownedDbTable(TABLE)
    .select(COLUMNS)
    .eq('company_id', companyId)
    .eq('asset_id', assetId);

  if (error) throw new Error(`Failed to list references for asset: ${error.message}`);
  return (data ?? []).map((row) => toDomain(row as Row)).sort(compareCompositionAssetReferences);
}

/** Detach one reference. Scoped by company, so an id alone is not enough. */
export async function removeCompositionAssetReference(
  companyId: string,
  referenceId: string,
): Promise<void> {
  if (!companyId?.trim() || !referenceId?.trim()) return;

  const { error } = await ownedDbTable(TABLE)
    .delete()
    .eq('company_id', companyId)
    .eq('id', referenceId);

  if (error) throw new Error(`Failed to remove composition asset reference: ${error.message}`);
}
