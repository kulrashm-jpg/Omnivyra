import type { WriterAttachedAsset } from './writerCreatorAssetLaunch';

export function mediaUrlsFromCreatorAttachments(attachedAssets: WriterAttachedAsset[]): string[] {
  return Array.from(new Set(
    attachedAssets.flatMap((asset) => {
      const list: string[] = [];
      if (typeof asset.url === 'string' && asset.url.trim()) list.push(asset.url.trim());
      if (Array.isArray(asset.files)) {
        for (const file of asset.files) {
          if (typeof file === 'string' && file.trim()) list.push(file.trim());
        }
      }
      return list;
    }),
  ));
}

export function mediaTypesFromCreatorAttachments(input: {
  mediaUrls: string[];
  attachedAssets: WriterAttachedAsset[];
}): string[] {
  return input.mediaUrls.map((url) => {
    const sourceAsset = input.attachedAssets.find((asset) => asset.url === url || asset.files?.includes(url));
    return sourceAsset
      ? `creator:${sourceAsset.creatorType}:${sourceAsset.attachmentMode ?? sourceAsset.compositionIntent?.attachmentMode ?? 'supporting_visual'}:${sourceAsset.compositionIntent?.copyPolicy?.sourceTextTransform ?? 'none'}`
      : 'creator:unknown:supporting_visual:none';
  });
}
