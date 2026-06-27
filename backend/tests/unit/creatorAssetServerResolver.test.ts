// Mock the EXISTING persistence (no new store) — the resolver reuses listCreatorAssets.
jest.mock('../../services/creatorAssetPersistenceService', () => ({
  listCreatorAssets: jest.fn(),
}));
import { listCreatorAssets } from '../../services/creatorAssetPersistenceService';
import {
  resolveCreatorAssetRefsServer,
  resolveCreatorAssetServer,
  resolveCreatorAssetMediaUrlsServer,
  normalizeServerAssetRefs,
} from '../../services/creator/creatorAssetServerResolver';

const mockList = listCreatorAssets as jest.Mock;
const ctx = { companyId: 'co1', userId: 'u1' };
const row = (id: string, url: string, files: string[] = []) => ({ id, url, files, creator_type: 'image', metadata: { k: 1 } });
beforeEach(() => mockList.mockReset());

describe('Server Creator Asset Resolver (reuses existing persistence)', () => {
  it('resolves refs by id from listCreatorAssets → rendering payload + media', async () => {
    mockList.mockResolvedValue([row('a1', 'a1.png', ['a1.png', 's1.png']), row('a2', 'a2.png')]);
    const resolved = await resolveCreatorAssetRefsServer({ ...ctx, refs: [{ assetId: 'a2' }, { assetId: 'a1' }] });
    expect(resolved.map((r) => r.assetId)).toEqual(['a2', 'a1']); // resolved in ref order
    expect((await resolveCreatorAssetServer(ctx, { assetId: 'a1' }))!.previewUrl).toBe('a1.png');
    expect(await resolveCreatorAssetMediaUrlsServer({ ...ctx, refs: [{ assetId: 'a1' }] })).toEqual(['a1.png', 's1.png']);
    expect(mockList).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co1', userId: 'u1' })); // existing persistence
  });

  it('returns nothing when persistence is unavailable (caller falls back to legacy payload)', async () => {
    mockList.mockRejectedValue(new Error('CREATOR_PERSISTENCE_UNAVAILABLE'));
    expect(await resolveCreatorAssetRefsServer({ ...ctx, refs: [{ assetId: 'a1' }] })).toEqual([]); // no throw
  });

  it('unresolvable refs are skipped (no fabrication)', async () => {
    mockList.mockResolvedValue([row('a1', 'a1.png')]);
    expect((await resolveCreatorAssetRefsServer({ ...ctx, refs: [{ assetId: 'missing' }] }))).toEqual([]);
  });

  it('normalizeServerAssetRefs: assetRefs preferred; legacy attachments + asset_ref converted', () => {
    expect(normalizeServerAssetRefs({ assetRefs: [{ assetId: 'x', version: 3 }] })).toEqual([{ assetId: 'x', version: 3, selectedVariant: null }]);
    // legacy creatorAttachments with embedded asset_ref (server back-compat)
    expect(normalizeServerAssetRefs({ creatorAttachments: [{ id: 'y', asset_ref: { assetId: 'y', version: 2 } }] }))
      .toEqual([{ assetId: 'y', version: 2, selectedVariant: null }]);
    // legacy attachment with only id
    expect(normalizeServerAssetRefs({ creatorAttachments: [{ id: 'z' }] })).toEqual([{ assetId: 'z', version: 1, selectedVariant: null }]);
    expect(normalizeServerAssetRefs({})).toEqual([]);
  });
});
