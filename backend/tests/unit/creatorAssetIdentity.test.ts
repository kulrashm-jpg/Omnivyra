/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset, addAssetVersion, renameAsset } from '../../../lib/content/creatorAssetLibrary';
import { resolveCreatorAsset, resolveCreatorAssetHistory, listCreatorAssetRefs } from '../../../lib/content/creatorAssetResolver';
import { attachUsage, listConsumers, listAssetsForConsumer, clearUsageGraph, writerDraftConsumer, reassignAssetIdInGraph } from '../../../lib/content/creatorAssetUsageGraph';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import { convergeCreatorAssetId } from '../../../lib/content/creatorAssetIdentity';
import { generateCreatorAssetId, isTemporaryCreatorAssetId } from '../../../lib/content/creatorAssetIdFactory';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id?: string): WriterAttachedAsset => ({ id: id ?? '', creatorType: 'supporting_image', title: 't', url: 'u.png', files: ['u.png'], createdAt: 'x' });
beforeEach(() => { window.localStorage.clear(); clearUsageGraph(); clearAssetCache(); });

describe('Creator Asset identity convergence (temp → canonical)', () => {
  it('factory ids are temporary; persisted ids are not', () => {
    expect(isTemporaryCreatorAssetId(generateCreatorAssetId({ kind: 'image' }))).toBe(true);
    expect(isTemporaryCreatorAssetId('abc123stablehash')).toBe(false);
  });

  it('renameAsset preserves versions/history, drops the old id (no recreate)', async () => {
    const temp = generateCreatorAssetId({ kind: 'image' });
    await registerGeneratedAsset(mk(temp));
    await addAssetVersion(temp, mk(temp), 'regenerate');
    const renamed = await renameAsset(temp, 'canon1');
    expect(renamed!.ref.assetId).toBe('canon1');
    expect(renamed!.asset.versions.length).toBe(2);              // history preserved
    expect(renamed!.asset.versions.every((v) => v.payload.id === 'canon1')).toBe(true);
    expect(await resolveCreatorAsset({ assetId: temp, version: 1 })).toBeNull(); // old id gone
    expect((await resolveCreatorAssetHistory({ assetId: 'canon1', version: 2 })).length).toBe(2);
  });

  it('converge rewrites Library + Graph atomically; consumers never see the temp id', async () => {
    const temp = generateCreatorAssetId({ kind: 'image' });
    const { ref } = await registerGeneratedAsset(mk(temp));
    const consumer = writerDraftConsumer('post', 'p1');
    await attachUsage(ref, consumer, { role: 'attachment' });

    const canonicalRef = await convergeCreatorAssetId(temp, 'canon2', { now: 'n' });
    expect(canonicalRef!.assetId).toBe('canon2');
    // graph edge migrated
    expect((await listAssetsForConsumer(consumer)).map((r) => r.assetId)).toEqual(['canon2']);
    expect((await listConsumers('canon2')).length).toBe(1);
    expect((await listConsumers(temp)).length).toBe(0);
    // library/catalog migrated
    expect((await listCreatorAssetRefs()).map((r) => r.assetId)).toEqual(['canon2']);
    expect((await resolveCreatorAsset(canonicalRef))!.url).toBeDefined();
  });

  it('converge is a no-op for already-canonical ids (never re-renames a persisted id)', async () => {
    await registerGeneratedAsset(mk('canon3'));
    expect(await convergeCreatorAssetId('canon3', 'somethingElse')).toBeNull(); // not a temp id
    expect((await listCreatorAssetRefs()).map((r) => r.assetId)).toEqual(['canon3']);
  });

  it('idempotent re-converge: canonical already exists → temp dropped, edges de-duped', async () => {
    const temp = generateCreatorAssetId({ kind: 'image' });
    await registerGeneratedAsset(mk('canon4'));        // canonical already present
    await registerGeneratedAsset(mk(temp));            // stray temp
    const consumer = writerDraftConsumer('post', 'p2');
    await attachUsage({ assetId: 'canon4', version: 1 }, consumer, { role: 'attachment', order: 5 });
    await attachUsage({ assetId: temp, version: 1 }, consumer, { role: 'attachment', order: 1 });
    await convergeCreatorAssetId(temp, 'canon4');
    expect((await listAssetsForConsumer(consumer)).map((r) => r.assetId)).toEqual(['canon4']); // de-duped
    expect((await listConsumers(temp)).length).toBe(0);
  });
});
