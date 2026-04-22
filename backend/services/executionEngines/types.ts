import type { CreatorAssetType, CreatorTemplateRecord } from '../creatorTemplateRegistryService';

export type CanonicalCreatorOutput = {
  intent_type: 'creator';
  asset_type: CreatorAssetType;
  asset_instruction: {
    blueprint: Record<string, unknown>;
    structure: Record<string, unknown>;
    visual_style?: string;
    template_id?: string | null;
  };
  asset_payload: Record<string, unknown>;
  packaging: {
    caption: string;
    hashtags: string[];
    meta_description: string;
    keywords: string[];
    cta: string;
    platform_variants: Record<string, {
      caption: string;
      hashtags: string[];
      cta?: string;
      meta_description?: string;
      keywords?: string[];
    }>;
  };
  generation_prompt?: string;
  metadata: Record<string, unknown>;
};

export type CreatorGenerationContext = {
  campaignId: string;
  companyId?: string | null;
  userId?: string | null;
  topic: string;
  contentType: string;
  targetPlatforms: string[];
  audience?: string;
  objective?: string;
  summary?: string;
  creatorCard?: Record<string, unknown> | null;
  enrichedIntent?: Record<string, unknown> | null;
  template?: CreatorTemplateRecord;
  templateId?: string | null;
  existingContent?: Record<string, unknown> | null;
};

export type CreatorScheduledRow = {
  dailyPlanId: string;
  userId: string;
  platform: string;
  contentType: string;
  topic: string;
  scheduledForIso: string;
  socialAccountId: string;
  dbPlatform: string;
  dbContentType: string;
  status: 'draft' | 'scheduled';
  templateId?: string | null;
};

export type CreatorScheduleResult = {
  scheduledPostId: string | null;
  status: 'failed' | 'created' | 'verified' | 'published';
  publish_source: 'platform_ack' | 'manual' | 'unknown';
  platform_id: string | null;
  verified: boolean;
  published: boolean;
  failure_reason?: string | null;
  idempotency_key?: string | null;
};

export interface CreatorExecutionEngine {
  generateFromIntent(
    intent: CreatorGenerationContext,
    context?: { companyId?: string | null },
    config?: { assetOverride?: Record<string, unknown> | null }
  ): Promise<CanonicalCreatorOutput>;
  adaptForPlatform(
    output: CanonicalCreatorOutput,
    platform: string
  ): Promise<CanonicalCreatorOutput>;
  schedule(
    output: CanonicalCreatorOutput,
    row: CreatorScheduledRow
  ): Promise<CreatorScheduleResult>;
}
