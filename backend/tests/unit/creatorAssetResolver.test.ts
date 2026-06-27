/**
 * @jest-environment jsdom
 */
import { registerGeneratedAsset, type CreatorAsset, type CreatorAssetRef } from '../../../lib/content/creatorAssetLibrary';
import {
  resolveCreatorAsset,
  resolveCreatorAssetFiles,
  resolveCreatorAssetPreviewUrl,
  resolveCreatorAssetThumbnails,
  resolveCreatorAssetMetadata,
  resolveCreatorAssetVersion,
  listCreatorAssetRefs,
} from '../../../lib/content/creatorAssetResolver';
import { setCreatorAssetBackend, localCreatorAssetBackend, type CreatorAssetBackend } from '../../../lib/content/creatorAssetBackend';
import { clearAssetCache } from '../../../lib/content/creatorAssetCache';
import type { WriterAttachedAsset } from '../../../lib/content/writerCreatorAssetLaunch';

const mk = (id: string): WriterAttachedAsset => ({ id, creatorType: 'carousel', title: id, url: `${id}.png`, files: [`${id}-1.png`, `${id}-2.png`], metadata: { preview_kind: 'slides' }, createdAt: 'x' });

afterEach(() => setCreatorAssetBackend(localCreatorAssetBackend));
beforeEach(() => { window.localStorage.clear(); clearAssetCache(); });

describe('Creator Asset Resolver — the one async read API', () => {
  it('exposes payload / version / metadata / files / preview / thumbnails by ref', async () => {
    const { ref } = await registerGeneratedAsset(mk('a1'), { now: '2026-06-26T00:00:00.000Z' });
    expect((await resolveCreatorAsset(ref))!.id).toBe('a1');
    expect(await resolveCreatorAssetVersion(ref)).toBe(1);
    expect(await resolveCreatorAssetMetadata(ref)).toEqual({ preview_kind: 'slides' });
    expect(await resolveCreatorAssetFiles(ref)).toEqual(['a1-1.png', 'a1-2.png']);
    expect(await resolveCreatorAssetPreviewUrl(ref)).toBe('a1.png');
    expect(await resolveCreatorAssetThumbnails(ref)).toEqual(['a1.png']);
    expect((await listCreatorAssetRefs()).some((r) => r.assetId === 'a1')).toBe(true);
  });

  it('tolerates stale/missing refs (stale version → current; unknown → null)', async () => {
    await registerGeneratedAsset(mk('a2'));
    expect(await resolveCreatorAssetVersion({ assetId: 'a2', version: 99 })).toBe(1); // current fallback
    expect(await resolveCreatorAsset({ assetId: 'missing', version: 1 } as CreatorAssetRef)).toBeNull();
    expect(await resolveCreatorAsset(null)).toBeNull();
  });

  it('is storage-agnostic — swapping the (async) backend changes nothing for consumers', async () => {
    // An in-memory async backend (future: server / CDN / DB). Consumers call the same resolver API.
    const mem: Record<string, CreatorAsset> = {};
    const memBackend: CreatorAssetBackend = {
      read: (id) => Promise.resolve(mem[id] ?? null),
      readAll: () => Promise.resolve(Object.values(mem)),
      write: (a) => { mem[a.id] = a; return Promise.resolve(); },
      remove: (id) => { delete mem[id]; return Promise.resolve(); },
    };
    setCreatorAssetBackend(memBackend);
    const { ref } = await registerGeneratedAsset(mk('a3'), { now: '2026-06-26T00:00:00.000Z' });
    expect(window.localStorage.getItem('creator_asset_library')).toBeNull(); // nothing hit localStorage
    expect((await resolveCreatorAsset(ref))!.id).toBe('a3'); // resolver reads the swapped backend, unchanged API
    expect(mem.a3).toBeTruthy();
  });
});
