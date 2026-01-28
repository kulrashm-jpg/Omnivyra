import { PlatformExecutionPlan } from './platformIntelligenceService';

export type SchedulerPayload = {
  jobs: Array<{
    platform: string;
    scheduledAt: string;
    contentPlaceholderId?: string | null;
    contentAssetId?: string | null;
    caption?: string | null;
    mediaPlaceholder?: boolean;
    formattedContent?: string | null;
    hashtags?: string[];
    keywords?: string[];
    altText?: string | null;
    metaTags?: string[];
    cta?: string | null;
    timeWindow?: string | null;
    complianceStatus?: string | null;
    omnivyra?: {
      blueprint?: any;
      promotion?: any;
      compliance?: any;
    };
    status: 'pending';
    weekNumber: number;
    day: string;
  }>;
};

export function buildSchedulerPayload(input: {
  platformExecutionPlan: PlatformExecutionPlan;
  approvedAssets?: Array<any>;
  assetMetadata?: Map<string, any>;
  assetVariants?: Map<string, any>;
  complianceReports?: Map<string, any>;
}): SchedulerPayload {
  const assetMap = new Map<string, any>();
  (input.approvedAssets || []).forEach((asset) => {
    const key = `${asset.day}-${asset.platform}`;
    assetMap.set(key, asset);
  });
  const jobs = input.platformExecutionPlan.days.map((day, index) => ({
    platform: day.platform,
    scheduledAt: `${day.date} ${day.suggestedTime}`,
    contentPlaceholderId: day.placeholder
      ? `placeholder-${day.platform}-${input.platformExecutionPlan.weekNumber}-${index}`
      : null,
    contentAssetId: assetMap.get(`${day.date}-${day.platform}`)?.asset_id ?? null,
    caption: assetMap.get(`${day.date}-${day.platform}`)?.latest_content?.caption ?? null,
    mediaPlaceholder: day.placeholder,
    formattedContent:
      input.assetVariants?.get(`${day.date}-${day.platform}`)?.formatted_content ?? null,
    hashtags: input.assetMetadata?.get(`${day.date}-${day.platform}`)?.hashtags ?? [],
    keywords: input.assetMetadata?.get(`${day.date}-${day.platform}`)?.keywords ?? [],
    altText: input.assetMetadata?.get(`${day.date}-${day.platform}`)?.alt_text ?? null,
    metaTags: input.assetMetadata?.get(`${day.date}-${day.platform}`)?.meta_tags ?? [],
    cta: input.assetMetadata?.get(`${day.date}-${day.platform}`)?.cta ?? null,
    timeWindow: day.suggestedTime,
    complianceStatus: input.complianceReports?.get(`${day.date}-${day.platform}`)?.status ?? null,
    omnivyra: {
      blueprint: (input.platformExecutionPlan as any)?.omnivyra ?? null,
      promotion: input.assetMetadata?.get(`${day.date}-${day.platform}`)?.omnivyra ?? null,
      compliance: input.complianceReports?.get(`${day.date}-${day.platform}`)?.omnivyra ?? null,
    },
    status: 'pending' as const,
    weekNumber: input.platformExecutionPlan.weekNumber,
    day: day.date,
  }));
  return {
    jobs: input.approvedAssets
      ? jobs.filter((job) => Boolean(job.contentAssetId))
      : jobs,
  };
}
