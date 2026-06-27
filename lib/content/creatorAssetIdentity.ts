/**
 * Creator Asset identity convergence.
 *
 * The client mints a TEMPORARY id (`casset_…`) at generation time; persistence
 * returns the CANONICAL id (`creator_assets.id` / stableAssetId). This module is
 * the single place that converges the two: it rewrites the temp id to the canonical
 * id atomically across the Library and the Usage Graph. The Resolver and Catalog
 * read through the Library, so they follow automatically; sessions/scheduler hold
 * the returned canonical ref. It is an IDENTITY MIGRATION — never a recreate:
 * versions, history, consumers and relationships are preserved.
 */

import { renameAsset, type CreatorAssetRef } from './creatorAssetLibrary';
import { reassignAssetIdInGraph } from './creatorAssetUsageGraph';
import { isTemporaryCreatorAssetId } from './creatorAssetIdFactory';

/**
 * Converge a temporary asset id to the canonical persisted id. Returns the canonical
 * ref when a migration happened, else null (ids equal, not a temp id, or unknown id —
 * caller keeps its existing ref). Library is renamed first, then graph edges, so no
 * consumer can observe a half-migrated state.
 */
export async function convergeCreatorAssetId(
  tempId: string,
  canonicalId: string,
  opts?: { now?: string },
): Promise<CreatorAssetRef | null> {
  if (!tempId || !canonicalId || tempId === canonicalId) return null;
  if (!isTemporaryCreatorAssetId(tempId)) return null; // already canonical — never re-rename a persisted id
  const renamed = await renameAsset(tempId, canonicalId, opts);
  if (!renamed) return null;
  await reassignAssetIdInGraph(tempId, canonicalId);
  return renamed.ref;
}
