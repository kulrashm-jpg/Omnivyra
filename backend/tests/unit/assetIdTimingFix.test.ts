/**
 * Asset-id timing fix — Creator → Lead Attribution Completion, Phase 1.
 *
 * Proves createContentAsset threads a caller-supplied asset_id through to the
 * row insert on a NEW asset (so a tracking link minted with that id matches the
 * persisted asset), and reuses the existing id on a regeneration (so the link
 * and the asset can never disagree). The content store is mocked — this is a
 * wiring proof, not a DB test.
 */

/** Argument tuples derived from the real store, so a signature change fails here. */
type AssetStore = typeof import('../../db/contentAssetStore');

const createAsset = jest.fn(async (input: any) => ({
  asset_id: input.assetId ?? 'db-generated-uuid',
  ...input,
}));
const getContentAssetByKey = jest.fn();
const createContentVersion = jest.fn(async (input: any) => ({ version: input.version, content_json: input.content }));
const updateContentAssetStatus = jest.fn(async (input: any) => ({ asset_id: input.assetId, status: input.status, current_version: input.currentVersion }));

jest.mock('../../db/contentAssetStore', () => ({
  __esModule: true,
  createContentAsset: (...args: Parameters<AssetStore['createContentAsset']>) => createAsset(...args),
  getContentAssetByKey: (...args: any[]) => getContentAssetByKey(...args),
  createContentVersion: (...args: Parameters<AssetStore['createContentVersion']>) => createContentVersion(...args),
  createContentReview: jest.fn(),
  getContentAssetById: jest.fn(),
  getContentAssetByKey2: jest.fn(),
  listContentAssets: jest.fn(),
  listContentVersions: jest.fn(async () => []),
  updateContentAssetStatus: (...args: Parameters<AssetStore['updateContentAssetStatus']>) => updateContentAssetStatus(...args),
}));

// contentAssetService imports regenerateContent from contentGenerationService at
// module load — stub it so we don't drag in the AI gateway.
jest.mock('../../services/contentGenerationService', () => ({
  __esModule: true,
  regenerateContent: jest.fn(),
}));

import { createContentAsset } from '../../services/contentAssetService';

const baseInput = {
  campaignId: 'campaign-1',
  weekNumber: 2,
  day: '2026-06-03',
  platform: 'linkedin',
  content: { body: 'hello', primary_cta_url: 'https://acme.example.com/?omn_asset_id=asset-pre-9' },
};

describe('createContentAsset — asset-id timing', () => {
  beforeEach(() => {
    createAsset.mockClear();
    getContentAssetByKey.mockClear();
    createContentVersion.mockClear();
    updateContentAssetStatus.mockClear();
  });

  it('uses the caller-supplied assetId as the primary key on a NEW asset', async () => {
    getContentAssetByKey.mockResolvedValueOnce(null); // first generation
    await createContentAsset({ ...baseInput, assetId: 'asset-pre-9' });

    expect(createAsset).toHaveBeenCalledTimes(1);
    expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-pre-9' }));
    // Version is written against that same id.
    expect(createContentVersion).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-pre-9', version: 1 }));
  });

  it('reuses the EXISTING asset_id on a regeneration and ignores the supplied id', async () => {
    getContentAssetByKey.mockResolvedValueOnce({ asset_id: 'existing-asset-id', current_version: 1, status: 'draft' });
    await createContentAsset({ ...baseInput, assetId: 'asset-pre-9' });

    // No new asset is created; the existing id wins.
    expect(createAsset).not.toHaveBeenCalled();
    expect(createContentVersion).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'existing-asset-id', version: 2 }));
  });

  it('is backward compatible: omitting assetId falls back to the DB default', async () => {
    getContentAssetByKey.mockResolvedValueOnce(null);
    await createContentAsset(baseInput);

    expect(createAsset).toHaveBeenCalledWith(expect.objectContaining({ assetId: null }));
  });
});
