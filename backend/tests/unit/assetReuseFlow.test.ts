/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset, addAssetVersion } from '../../../lib/content/creatorAssetLibrary';
import { getAssetsByType, getRecentAssets, searchAssets, listAssets } from '../../../lib/content/creatorAssetCatalog';
import { resolveCreatorAsset, resolveCreatorAssetCatalogMetadata } from '../../../lib/content/creatorAssetResolver';
import { attachUsage, listAssetsForConsumer, listConsumers, writerDraftConsumer, clearUsageGraph } from '../../../lib/content/creatorAssetUsageGraph';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id: string, url: string): WriterAttachedAsset => ({ id, creatorType: 'carousel', title: id, url, platformContext: 'linkedin', metadata: { origin: 'creator' }, createdAt: 'x' });
beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); clearAssetCache(); });

describe('Reuse Existing Asset — Catalog → Resolver → Usage Graph (no regeneration)', () => {
  it('discovers via the Catalog (refs), resolves payload only on selection, attaches a new edge', async () => {
    const { ref } = await registerGeneratedAsset(mk('cv', 'cv.png'));
    await attachUsage(ref, writerDraftConsumer('post', 'draftA')); // already used by draft A

    // Discovery: Catalog returns refs (by type / recent / search)
    expect((await getAssetsByType('carousel')).map((r) => r.assetId)).toEqual(['cv']);
    expect((await getRecentAssets(10)).some((r) => r.assetId === 'cv')).toBe(true);
    expect((await searchAssets('linkedin')).map((r) => r.assetId)).toEqual(['cv']);
    // Display metadata is available without the payload
    expect((await resolveCreatorAssetCatalogMetadata(ref))!.assetType).toBe('carousel');

    // Selection: resolve the payload (only now), then attach to draft B
    const picked = (await getAssetsByType('carousel'))[0];
    expect((await resolveCreatorAsset(picked))!.url).toBe('cv.png');
    await attachUsage(picked, writerDraftConsumer('post', 'draftB'));

    // No duplicate asset, no new id — a single canonical asset used by both drafts
    expect((await listAssets()).filter((r) => r.assetId === 'cv').length).toBe(1);
    expect((await listAssetsForConsumer(writerDraftConsumer('post', 'draftB'))).map((r) => r.assetId)).toEqual(['cv']);
    expect((await listAssetsForConsumer(writerDraftConsumer('post', 'draftA'))).map((r) => r.assetId)).toEqual(['cv']);
    expect((await listConsumers('cv')).length).toBe(2); // reused, not regenerated
  });

  it('reuse preserves version history (pins the resolved version)', async () => {
    await registerGeneratedAsset(mk('cv2', 'v1.png'));
    await addAssetVersion('cv2', mk('cv2', 'v2.png'), 'regenerate');
    const ref = (await getAssetsByType('carousel')).find((r) => r.assetId === 'cv2')!;
    expect(ref.version).toBe(2); // catalog points at current version
    await attachUsage(ref, writerDraftConsumer('post', 'draftC'));
    expect((await resolveCreatorAsset(ref))!.url).toBe('v2.png');
    expect((await resolveCreatorAsset({ assetId: 'cv2', version: 1 }))!.url).toBe('v1.png'); // history intact
  });
});
