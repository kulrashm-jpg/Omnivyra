/**
 * Writer Attachment ⇄ Usage Graph — graph is the durable relationship source.
 *
 * The Usage Graph persists itself (every mutation writes immediately), so it is
 * the single durable relationship store. There is NO per-load hydration: the
 * legacy durable attachment store is read EXACTLY ONCE per draft by an idempotent
 * migration (marker-gated), after which all relationship discovery comes straight
 * from the persisted graph and the legacy store is never read at runtime again.
 *
 * Runtime read path: graph → listAssetsForConsumer() → resolveCreatorAsset().
 * The legacy store is payload persistence only.
 */

import {
  loadWriterAttachedAssetsDurable,
  type WriterAttachedAsset,
  type WriterSourceType,
} from './writerCreatorAssetLaunch';
import { registerGeneratedAsset } from './creatorAssetLibrary';
import { resolveCreatorAsset, resolveCreatorAssetCurrentVersion } from './creatorAssetResolver';
import { attachUsage, listAssetsForConsumer, writerDraftConsumer, type AssetConsumer } from './creatorAssetUsageGraph';

const migratedKey = (sourceType: WriterSourceType, sourceId: string): string =>
  `creator_asset_graph_migrated_${sourceType}_${sourceId || 'draft'}`;

function isMigrated(sourceType: WriterSourceType, sourceId: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(migratedKey(sourceType, sourceId)) === '1'; } catch { return false; }
}
function markMigrated(sourceType: WriterSourceType, sourceId: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(migratedKey(sourceType, sourceId), '1'); } catch { /* ignore */ }
}

/**
 * Move a draft's persisted attachments into the library (payloads) + graph
 * (relationships + order). Internal to the migration — idempotent: an asset
 * already in the library is referenced, not re-registered (no version inflation).
 */
async function moveAttachmentsIntoGraph(durable: WriterAttachedAsset[], sourceType: WriterSourceType, sourceId: string): Promise<void> {
  const consumer: AssetConsumer = writerDraftConsumer(sourceType, sourceId);
  const n = durable.length;
  for (let i = 0; i < n; i += 1) {
    const asset = durable[i];
    if (!asset?.id) continue;
    const currentVersion = await resolveCreatorAssetCurrentVersion(asset.id);
    let ref;
    if (currentVersion == null) {
      ref = (await registerGeneratedAsset(asset, { now: asset.createdAt })).ref;
    } else {
      ref = { assetId: asset.id, version: currentVersion, selectedVariant: null };
    }
    // durable is newest-first → newest (i=0) gets the highest order (n) → top.
    await attachUsage(ref, consumer, { role: 'attachment', order: n - i, now: asset.createdAt });
  }
}

/**
 * ONE-TIME migration from the legacy durable attachment store into the persisted
 * graph. Runs at most once per draft (marker-gated) and is idempotent. After it
 * completes the legacy store is never read again at runtime. Returns true if it
 * performed the migration this call.
 */
export async function migrateWriterAttachmentsToGraph(input: {
  companyId?: string | null;
  sourceType: WriterSourceType;
  sourceId: string;
}): Promise<boolean> {
  if (isMigrated(input.sourceType, input.sourceId)) return false;
  const durable = await loadWriterAttachedAssetsDurable(input); // the ONLY legacy read
  await moveAttachmentsIntoGraph(durable, input.sourceType, input.sourceId);
  markMigrated(input.sourceType, input.sourceId);
  return true;
}

/**
 * The canonical Writer attachment read path. Triggers the one-time migration if
 * needed (no-op once migrated), then reads relationships from the persisted graph
 * and payloads from the resolver. No runtime hydration; no legacy-store read after
 * migration.
 */
export async function loadWriterAttachmentsViaGraph(input: {
  companyId?: string | null;
  sourceType: WriterSourceType;
  sourceId: string;
}): Promise<WriterAttachedAsset[]> {
  await migrateWriterAttachmentsToGraph(input);

  const refs = await listAssetsForConsumer(writerDraftConsumer(input.sourceType, input.sourceId));
  const out: WriterAttachedAsset[] = [];
  for (const ref of refs) {
    const payload = await resolveCreatorAsset(ref);
    if (payload) out.push(payload);
  }
  return out;
}
