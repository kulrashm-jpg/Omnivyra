/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset } from '../../../lib/content/creatorAssetLibrary';
import { attachUsage, listAssetsForConsumer, writerDraftConsumer, clearUsageGraph } from '../../../lib/content/creatorAssetUsageGraph';
import { listAssets, getAssetsBySource } from '../../../lib/content/creatorAssetCatalog';
import { resolveCreatorAsset } from '../../../lib/content/creatorAssetResolver';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

// Mirrors assetConversion.bridgeConvertedAssetsToGraph (register → attachUsage),
// proving converted assets become canonical (Library + Catalog + Graph) + dedup.
async function bridge(sourceType: 'post' | 'thread', sourceId: string, assets: WriterAttachedAsset[]) {
  const consumer = writerDraftConsumer(sourceType, sourceId);
  for (let i = assets.length - 1; i >= 0; i -= 1) {
    const { ref } = await registerGeneratedAsset(assets[i]);
    await attachUsage(ref, consumer, { role: 'attachment' });
  }
}
const mk = (id: string, url: string): WriterAttachedAsset => ({ id, creatorType: 'supporting_image', title: id, url, metadata: { origin: 'creator' }, createdAt: 'x' });
beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); clearAssetCache(); });

describe('CAMPAIGN: asset conversion registers canonically (Library + Graph + Catalog)', () => {
  it('converted assets become canonical refs, attached + discoverable', async () => {
    await bridge('post', 'post:tok', [mk('cv1', 'u1.png'), mk('cv2', 'u2.png')]);
    // Graph: relationship attached
    const refs = await listAssetsForConsumer(writerDraftConsumer('post', 'post:tok'));
    expect(refs.map((r) => r.assetId).sort()).toEqual(['cv1', 'cv2']);
    // Resolver: payloads resolvable
    expect((await resolveCreatorAsset(refs.find((r) => r.assetId === 'cv1')!))!.url).toBe('u1.png');
    // Catalog: appears automatically
    expect((await listAssets()).map((r) => r.assetId).sort()).toEqual(['cv1', 'cv2']);
    expect((await getAssetsBySource('creator')).length).toBe(2);
  });

  it('duplicate conversions reuse the canonical asset (id/version), no duplicates', async () => {
    await bridge('post', 'post:tok2', [mk('dup', 'v1.png')]);
    await bridge('post', 'post:tok2', [mk('dup', 'v2.png')]); // same id → new version, not a new asset
    const all = await listAssets();
    expect(all.filter((r) => r.assetId === 'dup').length).toBe(1); // single canonical asset
    expect((await resolveCreatorAsset({ assetId: 'dup', version: 2 }))!.url).toBe('v2.png');
    expect((await resolveCreatorAsset({ assetId: 'dup', version: 1 }))!.url).toBe('v1.png'); // history kept
  });
});
