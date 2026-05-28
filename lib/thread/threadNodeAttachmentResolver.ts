/**
 * G2-final — bridge between the UI-side per-node attachment map and the
 * server-canonical attachment shape.
 *
 * The UI stores per-node assignments as a compact `ThreadNodeAttachmentMap`:
 *   { [position]: ['<assetId>', '<assetId>', ...] }
 *
 * The server-canonical contract carries full `CanonicalAttachment[]` per node.
 * This resolver turns the compact map into the canonical shape by looking up
 * each asset id in the thread-level `WriterAttachedAsset[]` list.
 *
 * Asset IDs that don't resolve (stale references after a thread-level
 * attachment was removed) are silently skipped — this matches the per-tab
 * resolve-at-render-time policy documented on
 * `lib/thread/threadStorage.ts::ThreadNodeAttachmentMap`.
 */

import type { CanonicalAttachment, CanonicalAttachmentKind } from '@/lib/shared/attachments/canonicalAttachment';
import type { WriterAttachedAsset } from '@/lib/content/writerCreatorAssetLaunch';
import type { ThreadNodeAttachmentMap } from './threadStorage';

/**
 * Project a single WriterAttachedAsset into canonical attachment(s). When the
 * asset carries multiple files (e.g. carousel slides), each file becomes its
 * own CanonicalAttachment entry — mirroring the flattening that
 * `mediaUrlsFromCreatorAttachments` does at the post level.
 */
export function writerAssetToCanonicalAttachments(asset: WriterAttachedAsset): CanonicalAttachment[] {
  const out: CanonicalAttachment[] = [];
  const kind = inferKindFromCreatorType(asset.creatorType);
  const sharedTitle = typeof asset.title === 'string' ? asset.title : undefined;
  const sharedMode = asset.attachmentMode === 'supporting_visual' || asset.attachmentMode === 'embedded_copy'
    ? asset.attachmentMode
    : undefined;

  if (typeof asset.url === 'string' && asset.url.trim()) {
    out.push({
      id: asset.id,
      assetId: asset.id,
      url: asset.url.trim(),
      kind,
      title: sharedTitle,
      previewUrl: asset.url.trim(),
      attachmentMode: sharedMode,
    });
  }
  if (Array.isArray(asset.files)) {
    for (let i = 0; i < asset.files.length; i++) {
      const file = asset.files[i];
      if (typeof file !== 'string' || !file.trim()) continue;
      out.push({
        id: `${asset.id}:${i}`,
        assetId: asset.id,
        url: file.trim(),
        kind,
        title: sharedTitle,
        previewUrl: file.trim(),
        attachmentMode: sharedMode,
      });
    }
  }
  return out;
}

/**
 * Resolve a ThreadNodeAttachmentMap (position → asset id list) into a
 * canonical per-node attachment table consumable by buildThreadNodesFromSegments.
 *
 * Returns an empty object when either input is missing.
 */
export function resolveThreadNodeAttachments(input: {
  nodeAttachmentMap: ThreadNodeAttachmentMap | null | undefined;
  attachedAssets: WriterAttachedAsset[] | null | undefined;
}): Record<number, CanonicalAttachment[]> {
  const map = input.nodeAttachmentMap ?? {};
  const assets = input.attachedAssets ?? [];
  if (!assets.length) return {};
  const assetsById = new Map<string, WriterAttachedAsset>();
  for (const a of assets) {
    if (a && typeof a.id === 'string') assetsById.set(a.id, a);
  }

  const out: Record<number, CanonicalAttachment[]> = {};
  for (const [positionKey, assetIds] of Object.entries(map)) {
    const position = Number(positionKey);
    if (!Number.isFinite(position) || position < 0) continue;
    if (!Array.isArray(assetIds) || assetIds.length === 0) continue;
    const perNode: CanonicalAttachment[] = [];
    for (const assetId of assetIds) {
      if (typeof assetId !== 'string') continue;
      const asset = assetsById.get(assetId);
      if (!asset) continue; // silently skip stale ids; render time owns this policy
      perNode.push(...writerAssetToCanonicalAttachments(asset));
    }
    if (perNode.length > 0) out[position] = perNode;
  }
  return out;
}

function inferKindFromCreatorType(creatorType: WriterAttachedAsset['creatorType']): CanonicalAttachmentKind | undefined {
  switch (creatorType) {
    case 'supporting_image':
    case 'banner':
    case 'infographic':
    case 'brand_card':
      return 'image';
    case 'carousel':
      return 'image';
    default:
      return undefined;
  }
}
