jest.mock('../../services/creatorAssetPersistenceService', () => ({ listCreatorAssets: jest.fn() }));
jest.mock('../../services/creatorRenderObservability', () => ({ recordCreatorRenderMetric: jest.fn() }));
import { listCreatorAssets } from '../../services/creatorAssetPersistenceService';
import { recordCreatorRenderMetric } from '../../services/creatorRenderObservability';
import { resolvePublishMedia } from '../../services/creator/creatorPublishResolution';

const mockList = listCreatorAssets as jest.Mock;
const mockMetric = recordCreatorRenderMetric as jest.Mock;
const ctx = { companyId: 'co', userId: 'u', platform: 'linkedin' };
beforeEach(() => { mockList.mockReset(); mockMetric.mockReset(); });

describe('Single publishing-resolution path', () => {
  it('resolves refs → server media unioned with legacy; emits the canonical metric', async () => {
    mockList.mockResolvedValue([{ id: 'a1', url: 'a1.png', files: ['a1.png'], creator_type: 'image' }]);
    const r = await resolvePublishMedia({ ...ctx, assetRefs: [{ assetId: 'a1', version: 1 }], legacyMediaUrls: ['video.mp4'] });
    expect(r.mediaUrls.sort()).toEqual(['a1.png', 'video.mp4']); // server ∪ legacy (non-asset preserved)
    expect(r.resolvedCount).toBe(1);
    expect(r.usedFallback).toBe(false);
    expect(mockMetric).toHaveBeenCalledWith(expect.objectContaining({ name: 'creator_publish_ref_resolution' }));
    expect(mockMetric.mock.calls[0][0].tags).toEqual(expect.objectContaining({ total: '1', server_resolved: '1', fallback: '0' }));
  });

  it('falls back to legacy media when resolution genuinely fails; reports fallback=1', async () => {
    mockList.mockResolvedValue([]); // ref not found in persistence
    const r = await resolvePublishMedia({ ...ctx, creatorAttachments: [{ id: 'missing' }], legacyMediaUrls: ['snap.png'] });
    expect(r.mediaUrls).toEqual(['snap.png']); // legacy fallback only
    expect(r.usedFallback).toBe(true);
    expect(mockMetric.mock.calls[0][0].tags).toEqual(expect.objectContaining({ total: '1', server_resolved: '0', fallback: '1' }));
  });

  it('no refs → legacy passthrough, no resolver call, no metric (legacy clients unchanged)', async () => {
    const r = await resolvePublishMedia({ ...ctx, legacyMediaUrls: ['only.png'] });
    expect(r.mediaUrls).toEqual(['only.png']);
    expect(r.totalRefs).toBe(0);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockMetric).not.toHaveBeenCalled();
  });

  it('normalizes legacy attachments once (asset_ref preferred, else id)', async () => {
    mockList.mockResolvedValue([{ id: 'y', url: 'y.png', files: [] }]);
    const r = await resolvePublishMedia({ ...ctx, creatorAttachments: [{ id: 'y', asset_ref: { assetId: 'y', version: 2 } }], legacyMediaUrls: [] });
    expect(r.mediaUrls).toEqual(['y.png']);
    expect(r.resolvedCount).toBe(1);
  });
});
