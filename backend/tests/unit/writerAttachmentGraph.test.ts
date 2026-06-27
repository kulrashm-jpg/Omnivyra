/**
 * @jest-environment jsdom
 */
import { loadWriterAttachmentsViaGraph, migrateWriterAttachmentsToGraph } from '../../../lib/content/writerAttachmentGraph';
import { listAssetsForConsumer, writerDraftConsumer, reorderUsage, detachUsage, clearUsageGraph } from '../../../lib/content/creatorAssetUsageGraph';
import { getWriterAttachedAssetsKey, type WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';

const mk = (id: string, url: string, createdAt: string): WriterAttachedAsset => ({ id, creatorType: 'supporting_image', title: id, url, createdAt });
const seedLegacy = (sourceId: string, assets: WriterAttachedAsset[]) =>
  window.localStorage.setItem(getWriterAttachedAssetsKey('post', sourceId), JSON.stringify(assets)); // newest-first

beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); clearAssetCache(); });

describe('Usage Graph is the durable relationship source (one-time migration)', () => {
  it('reads attachments from the persisted graph, newest-first order preserved', async () => {
    seedLegacy('d1', [mk('a3', 'u3', '2026-06-26T00:00:03Z'), mk('a2', 'u2', '2026-06-26T00:00:02Z'), mk('a1', 'u1', '2026-06-26T00:00:01Z')]);
    const list = await loadWriterAttachmentsViaGraph({ sourceType: 'post', sourceId: 'd1' });
    expect(list.map((a) => a.id)).toEqual(['a3', 'a2', 'a1']);
    expect(list.map((a) => a.url)).toEqual(['u3', 'u2', 'u1']);
  });

  it('migration runs ONCE (idempotent marker); second call does not re-migrate', async () => {
    seedLegacy('d2', [mk('b1', 'u1', '2026-06-26T00:00:01Z')]);
    expect(await migrateWriterAttachmentsToGraph({ sourceType: 'post', sourceId: 'd2' })).toBe(true);
    expect(await migrateWriterAttachmentsToGraph({ sourceType: 'post', sourceId: 'd2' })).toBe(false); // marker set
    const refs = await listAssetsForConsumer(writerDraftConsumer('post', 'd2'));
    expect(refs.length).toBe(1);
    expect(refs[0].version).toBe(1); // no version inflation
  });

  it('after migration the legacy store is NEVER read at runtime', async () => {
    seedLegacy('d3', [mk('c1', 'u1', '2026-06-26T00:00:01Z')]);
    await loadWriterAttachmentsViaGraph({ sourceType: 'post', sourceId: 'd3' }); // migrates
    // wipe the legacy store + add a NEW legacy-only asset — neither should affect runtime reads
    seedLegacy('d3', [mk('legacy_only', 'X', '2026-06-26T00:00:09Z')]);
    const after = await loadWriterAttachmentsViaGraph({ sourceType: 'post', sourceId: 'd3' });
    expect(after.map((a) => a.id)).toEqual(['c1']);          // still from the graph
    expect(after.some((a) => a.id === 'legacy_only')).toBe(false); // legacy never re-read
  });

  it('Remove flow: detachUsage() + graph refresh removes the asset (no local array mutation)', async () => {
    seedLegacy('dr', [mk('r2', 'u2', '2026-06-26T00:00:02Z'), mk('r1', 'u1', '2026-06-26T00:00:01Z')]);
    let list = await loadWriterAttachmentsViaGraph({ sourceType: 'post', sourceId: 'dr' });
    expect(list.map((a) => a.id)).toEqual(['r2', 'r1']);
    // UI "Remove" delegates to the canonical graph op, then re-reads the graph
    await detachUsage('r2', writerDraftConsumer('post', 'dr'));
    list = await loadWriterAttachmentsViaGraph({ sourceType: 'post', sourceId: 'dr' });
    expect(list.map((a) => a.id)).toEqual(['r1']); // reflected purely via the graph
  });

  it('reorder is graph-owned and reflected in the read path', async () => {
    seedLegacy('d4', [mk('e2', 'u2', '2026-06-26T00:00:02Z'), mk('e1', 'u1', '2026-06-26T00:00:01Z')]);
    await loadWriterAttachmentsViaGraph({ sourceType: 'post', sourceId: 'd4' });
    await reorderUsage(writerDraftConsumer('post', 'd4'), ['e1', 'e2']);
    const refs = await listAssetsForConsumer(writerDraftConsumer('post', 'd4'));
    expect(refs.map((r) => r.assetId)).toEqual(['e1', 'e2']);
  });
});
