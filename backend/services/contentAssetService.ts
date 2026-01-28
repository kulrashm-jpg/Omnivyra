import {
  createContentAsset as createAsset,
  createContentReview,
  createContentVersion,
  getContentAssetById,
  getContentAssetByKey,
  listContentAssets,
  listContentVersions,
  updateContentAssetStatus,
} from '../db/contentAssetStore';
import { regenerateContent } from './contentGenerationService';

export async function createContentAsset(input: {
  campaignId: string;
  weekNumber: number;
  day: string;
  platform: string;
  content: any;
}): Promise<any> {
  const existing = await getContentAssetByKey({
    campaignId: input.campaignId,
    weekNumber: input.weekNumber,
    day: input.day,
    platform: input.platform,
  });
  const asset = existing || (await createAsset(input));
  const version = existing ? (existing.current_version ?? 1) + 1 : 1;
  const contentVersion = await createContentVersion({
    assetId: asset.asset_id,
    version,
    content: input.content,
    reason: existing ? 'Regenerated from existing asset' : 'Initial draft',
  });
  const updatedAsset = await updateContentAssetStatus({
    assetId: asset.asset_id,
    status: asset.status ?? 'draft',
    currentVersion: version,
  });
  console.log('CONTENT GENERATED', { asset_id: updatedAsset.asset_id, version });
  return { asset: updatedAsset, version: contentVersion };
}

export async function updateContentAssetVersion(input: {
  assetId: string;
  newContent: any;
  reason?: string;
}): Promise<any> {
  const asset = await getContentAssetById(input.assetId);
  if (!asset) {
    throw new Error('Content asset not found');
  }
  const nextVersion = (asset.current_version ?? 1) + 1;
  const version = await createContentVersion({
    assetId: asset.asset_id,
    version: nextVersion,
    content: input.newContent,
    reason: input.reason ?? 'Updated content',
  });
  const updatedAsset = await updateContentAssetStatus({
    assetId: asset.asset_id,
    status: asset.status ?? 'draft',
    currentVersion: nextVersion,
  });
  console.log('ASSET VERSION CREATED', { asset_id: asset.asset_id, version: nextVersion });
  return { asset: updatedAsset, version };
}

export async function regenerateContentAsset(input: {
  assetId: string;
  instruction: string;
}): Promise<any> {
  const asset = await getContentAssetById(input.assetId);
  if (!asset) {
    throw new Error('Content asset not found');
  }
  const versions = await listContentVersions(asset.asset_id);
  const latest = versions[versions.length - 1];
  const regenerated = await regenerateContent({
    existingContent: latest?.content_json ?? {},
    instruction: input.instruction,
    platform: asset.platform,
  });
  console.log('CONTENT REGENERATED', { asset_id: asset.asset_id });
  return updateContentAssetVersion({
    assetId: asset.asset_id,
    newContent: regenerated,
    reason: input.instruction,
  });
}

export async function approveContentAsset(input: { assetId: string; approver?: string }): Promise<any> {
  const asset = await getContentAssetById(input.assetId);
  if (!asset) {
    throw new Error('Content asset not found');
  }
  const nextStatus = asset.status === 'reviewed' ? 'approved' : 'reviewed';
  await createContentReview({
    assetId: asset.asset_id,
    reviewer: input.approver,
    status: nextStatus === 'approved' ? 'approved' : 'reviewed',
    comment: nextStatus === 'approved' ? 'Approved' : 'Reviewed',
  });
  const updatedAsset = await updateContentAssetStatus({
    assetId: asset.asset_id,
    status: nextStatus,
  });
  console.log('CONTENT APPROVED', { asset_id: asset.asset_id, status: nextStatus });
  return updatedAsset;
}

export async function rejectContentAsset(input: { assetId: string; reason: string }): Promise<any> {
  const asset = await getContentAssetById(input.assetId);
  if (!asset) {
    throw new Error('Content asset not found');
  }
  await createContentReview({
    assetId: asset.asset_id,
    status: 'rejected',
    comment: input.reason,
  });
  const updatedAsset = await updateContentAssetStatus({
    assetId: asset.asset_id,
    status: 'draft',
  });
  console.log('CONTENT REJECTED', { asset_id: asset.asset_id });
  return updatedAsset;
}

export async function listAssets(input: { campaignId: string; weekNumber?: number }): Promise<any[]> {
  return listContentAssets({ campaignId: input.campaignId, weekNumber: input.weekNumber });
}
