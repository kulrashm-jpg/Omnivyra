import { getContentAssetById } from '../db/contentAssetStore';
import { upsertPerformanceMetric } from '../db/performanceStore';

export async function ingestPerformanceData(input: {
  platform: string;
  contentAssetId: string;
  metrics: {
    likes: number;
    comments: number;
    shares: number;
    saves?: number;
    clicks?: number;
    reach?: number;
    watchTime?: number;
    impressions?: number;
  };
  capturedAt?: string;
}): Promise<void> {
  const asset = await getContentAssetById(input.contentAssetId);
  if (!asset) {
    throw new Error('Content asset not found');
  }

  const capturedAt = input.capturedAt ?? new Date().toISOString();
  await upsertPerformanceMetric({
    contentAssetId: input.contentAssetId,
    platform: input.platform,
    campaignId: asset.campaign_id,
    weekNumber: asset.week_number,
    day: asset.day,
    metrics: input.metrics,
    capturedAt,
  });
  console.log('PERFORMANCE DATA INGESTED', {
    assetId: input.contentAssetId,
    platform: input.platform,
  });
}
