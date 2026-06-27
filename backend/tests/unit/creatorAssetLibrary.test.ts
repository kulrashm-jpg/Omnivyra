/**
 * @jest-environment jsdom
 */
import {
  registerGeneratedAsset,
  addAssetVersion,
  duplicateAsset,
  restoreAssetVersion,
} from '../../../lib/content/creatorAssetLibrary';
import {
  resolveCreatorAsset,
  resolveCreatorAssetCurrentVersion,
  resolveCreatorAssetHistory,
} from '../../../lib/content/creatorAssetResolver';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id: string, url: string): WriterAttachedAsset => ({ id, creatorType: 'supporting_image', title: id, url, createdAt: 'x' });
beforeEach(() => { window.localStorage.clear(); clearAssetCache(); });

describe('Creator Asset Library — canonical, versioned, async (reads via resolver)', () => {
  it('registers with a stable id + v1; payload resolvable via the resolver', async () => {
    const { ref } = await registerGeneratedAsset(mk('asset-1', 'u1'), { now: '2026-06-26T00:00:00.000Z' });
    expect(ref).toEqual({ assetId: 'asset-1', version: 1, selectedVariant: null });
    expect(await resolveCreatorAssetCurrentVersion('asset-1')).toBe(1);
    expect((await resolveCreatorAsset(ref))!.url).toBe('u1');
  });

  it('regenerate/replace add versions without breaking older refs', async () => {
    await registerGeneratedAsset(mk('asset-2', 'u1'), { now: '2026-06-26T00:00:00.000Z' });
    const v2 = (await addAssetVersion('asset-2', mk('asset-2', 'u2'), 'regenerate', { now: '2026-06-26T00:00:01.000Z' }))!;
    expect(v2.ref.version).toBe(2);
    expect((await resolveCreatorAsset({ assetId: 'asset-2', version: 1 }))!.url).toBe('u1');
    expect((await resolveCreatorAsset({ assetId: 'asset-2', version: 2 }))!.url).toBe('u2');
    expect(await resolveCreatorAssetCurrentVersion('asset-2')).toBe(2);
  });

  it('duplicate creates an independent new asset id', async () => {
    await registerGeneratedAsset(mk('asset-3', 'u1'), { now: '2026-06-26T00:00:00.000Z' });
    const dup = (await duplicateAsset('asset-3', { now: '2026-06-26T00:00:05.000Z' }))!;
    expect(dup.ref.assetId).not.toBe('asset-3');
    expect((await resolveCreatorAssetHistory(dup.ref))[0].op).toBe('duplicate');
    expect((await resolveCreatorAsset(dup.ref))!.url).toBe('u1');
    await addAssetVersion(dup.ref.assetId, mk(dup.ref.assetId, 'u9'), 'replace');
    expect(await resolveCreatorAssetCurrentVersion('asset-3')).toBe(1); // original untouched
  });

  it('restore appends a previous version as the new current version', async () => {
    await registerGeneratedAsset(mk('asset-4', 'u1'), { now: '2026-06-26T00:00:00.000Z' });
    await addAssetVersion('asset-4', mk('asset-4', 'u2'), 'regenerate', { now: '2026-06-26T00:00:01.000Z' });
    const restored = (await restoreAssetVersion('asset-4', 1, { now: '2026-06-26T00:00:02.000Z' }))!;
    expect(restored.ref.version).toBe(3);
    const history = await resolveCreatorAssetHistory(restored.ref);
    expect(history[2]).toMatchObject({ op: 'restore', restoredFrom: 1 });
    expect((await resolveCreatorAsset(restored.ref))!.url).toBe('u1'); // v1 content as v3
  });

  it('library writes invalidate the resolver cache automatically (no manual clearing)', async () => {
    const { ref } = await registerGeneratedAsset(mk('asset-5', 'u1'), { now: '2026-06-26T00:00:00.000Z' });
    expect((await resolveCreatorAsset(ref))!.url).toBe('u1'); // warms the cache
    // a new version invalidates → the resolver reflects it without any manual cache clear
    await addAssetVersion('asset-5', mk('asset-5', 'u2'), 'regenerate', { now: '2026-06-26T00:00:01.000Z' });
    expect(await resolveCreatorAssetCurrentVersion('asset-5')).toBe(2);
    expect((await resolveCreatorAsset({ assetId: 'asset-5', version: 2 }))!.url).toBe('u2');
  });
});
