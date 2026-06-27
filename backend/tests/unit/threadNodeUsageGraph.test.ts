/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset } from '../../../lib/content/creatorAssetLibrary';
import { listAssetsForConsumer, listConsumers, clearUsageGraph } from '../../../lib/content/creatorAssetUsageGraph';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import { saveThreadNodeAttachments, getThreadNodeAttachmentsKey } from '../../../lib/thread/threadStorage';
import {
  threadNodeConsumer, migrateThreadNodeAttachmentsToGraph,
  getThreadNodeAttachmentMapFromGraph, getThreadNodeAttachmentsFromGraph,
  syncThreadNodeMapToGraph, attachThreadNodeAsset,
} from '../../../lib/thread/threadNodeUsageGraph';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id: string): WriterAttachedAsset => ({ id, creatorType: 'supporting_image', title: id, url: `${id}.png`, files: [`${id}.png`], createdAt: 'x' });
const reg = (id: string) => registerGeneratedAsset(mk(id));
beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); clearAssetCache(); });

describe('Thread per-node attachments owned by the Usage Graph', () => {
  it('migrates the legacy map → graph once; projection reads from the graph', async () => {
    await reg('a1'); await reg('a2');
    saveThreadNodeAttachments('tk', { 0: ['a1'], 1: ['a1', 'a2'] }); // legacy store
    const map = await getThreadNodeAttachmentMapFromGraph('tk'); // migrates + projects
    expect(map[0]).toEqual(['a1']);
    expect((map[1] ?? []).sort()).toEqual(['a1', 'a2']);
    // one asset, multiple node edges (no duplication)
    expect((await listConsumers('a1')).filter((c) => c.type === 'thread-node').length).toBe(2);
  });

  it('resolved projection for publishing comes from the graph', async () => {
    await reg('a1');
    await attachThreadNodeAsset('tk2', 0, 'a1');
    const perNode = await getThreadNodeAttachmentsFromGraph('tk2');
    expect(perNode[0]?.length).toBeGreaterThan(0); // CanonicalAttachment[] resolved
  });

  it('sync reconciles a full map (attach added, detach removed)', async () => {
    await reg('a1'); await reg('a2');
    await syncThreadNodeMapToGraph('tk3', { 0: ['a1'] });
    expect((await listAssetsForConsumer(threadNodeConsumer('tk3', 0))).map((r) => r.assetId)).toEqual(['a1']);
    await syncThreadNodeMapToGraph('tk3', { 0: ['a2'] }); // swap
    expect((await listAssetsForConsumer(threadNodeConsumer('tk3', 0))).map((r) => r.assetId)).toEqual(['a2']);
  });

  it('does not read the legacy store at runtime after migration', async () => {
    await reg('a1');
    saveThreadNodeAttachments('tk4', { 0: ['a1'] });
    await getThreadNodeAttachmentMapFromGraph('tk4'); // migrates
    // mutate legacy store directly — must NOT affect graph-backed reads
    window.localStorage.setItem(getThreadNodeAttachmentsKey('tk4'), JSON.stringify({ 0: ['stale'] }));
    const map = await getThreadNodeAttachmentMapFromGraph('tk4');
    expect(map[0]).toEqual(['a1']); // still from the graph
  });

  it('migration is idempotent (runs once)', async () => {
    await reg('a1');
    saveThreadNodeAttachments('tk5', { 0: ['a1'] });
    expect(await migrateThreadNodeAttachmentsToGraph('tk5')).toBe(true);
    expect(await migrateThreadNodeAttachmentsToGraph('tk5')).toBe(false);
  });
});
