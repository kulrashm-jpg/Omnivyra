import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * POST /api/activity-workspace/creator-asset
 * Saves creator-uploaded asset (video, image, carousel) for a creator activity.
 * Stores in daily_content_plans.creator_asset and sets content_status = creator_ready.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { updateActivity, insertActivity } from '@/backend/services/executionPlannerService';
import {
  isContentArchitectSession,
  checkContentArchitectAccess,
} from '@/backend/services/contentArchitectService';
import { inferExecutionMode } from '@/backend/services/executionModeInference';
import { deriveCreatorAssetTypeFromIntent } from '@/backend/services/creatorTemplateRegistryService';
import { normalizeCreatorPlatform } from '@/backend/services/creatorCapabilityMap';
import { validateAssetReadiness } from '@/backend/services/creatorAssetValidationService';

export type CreatorAssetInput = {
  type: 'video' | 'image' | 'carousel' | 'post_with_asset' | 'thread_with_asset';
  url?: string;
  files?: string[];
  thumbnail?: string;
  /** Description/transcript/theme for repurposing; used as master content source */
  description?: string;
  transcript?: string;
  theme?: string;
  metadata?: Record<string, unknown>;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateCreatorAssetOverride(input: {
  creatorAsset: CreatorAssetInput;
  planContentType: string;
  planPlatform?: string | null;
}): Promise<string | null> | string | null {
  const expectedAssetType = deriveCreatorAssetTypeFromIntent({
    contentType: input.planContentType,
    targetPlatforms: input.planPlatform ? [input.planPlatform] : [],
  });
  if (expectedAssetType !== input.creatorAsset.type) {
    return `Creator asset type mismatch: expected ${expectedAssetType}, received ${input.creatorAsset.type}`;
  }
  const normalizedPlatform = input.planPlatform ? normalizeCreatorPlatform(input.planPlatform) : null;
  if (input.planPlatform && !normalizedPlatform) {
    return `Unsupported creator platform for override: ${input.planPlatform}`;
  }
  const fileCount = Array.isArray(input.creatorAsset.files) ? input.creatorAsset.files.filter(Boolean).length : 0;
  if (!input.creatorAsset.url && fileCount === 0) {
    return 'Creator asset override must include url or files';
  }
  if (input.creatorAsset.type === 'carousel' && fileCount === 0) {
    return 'Carousel override must include slide asset files';
  }
  const qualityProbe = {
    asset_type: input.creatorAsset.type,
    asset_payload: input.creatorAsset.type === 'image'
      ? {
          visual_descriptor: { headline: '', visual_description: '' },
          media_bundle: {
            url: input.creatorAsset.url,
            files: input.creatorAsset.files,
            metadata: input.creatorAsset.metadata ?? {},
          },
        }
      : input.creatorAsset.type === 'carousel'
        ? {
            slides: (input.creatorAsset.files || []).map((file, index) => ({ slide_number: index + 1, source_url: file })),
            media_bundle: {
              url: input.creatorAsset.url,
              files: input.creatorAsset.files,
              metadata: input.creatorAsset.metadata ?? {},
            },
          }
      : input.creatorAsset.type === 'post_with_asset' || input.creatorAsset.type === 'thread_with_asset'
        ? {
            asset_bundle: {
              url: input.creatorAsset.url,
              files: input.creatorAsset.files,
              metadata: input.creatorAsset.metadata ?? {},
            },
            caption_blueprint: {
              hook: '',
              body: input.creatorAsset.description ?? input.creatorAsset.transcript ?? input.creatorAsset.theme ?? '',
              cta: '',
            },
          }
        : {
            scenes: [{}],
            duration_seconds: input.creatorAsset.metadata?.duration_seconds,
            media_bundle: {
              url: input.creatorAsset.url,
              files: input.creatorAsset.files,
              metadata: input.creatorAsset.metadata ?? {},
            },
          },
  } as any;
  if (input.planPlatform) {
    return validateAssetReadiness({
      output: qualityProbe,
      platform: input.planPlatform,
    }).then((result) => result.ready ? null : result.failure_reason);
  }
  return null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const executionId = String((req.body as any)?.execution_id ?? '').trim();
    const campaignId = String((req.body as any)?.campaign_id ?? '').trim();
    const creatorAssetRaw = asObject((req.body as any)?.creator_asset);
    const weekNumber = Number((req.body as any)?.week_number);
    const day = String((req.body as any)?.day ?? '').trim();

    if (!executionId || !campaignId) {
      return res.status(400).json({
        error: 'Missing execution_id or campaign_id',
      });
    }

    if (!creatorAssetRaw || !['video', 'image', 'carousel', 'post_with_asset', 'thread_with_asset'].includes(String(creatorAssetRaw.type ?? ''))) {
      return res.status(400).json({
        error: 'Invalid creator_asset: must have type (video | image | carousel | post_with_asset | thread_with_asset)',
      });
    }

    const creatorAsset: CreatorAssetInput = {
      type: creatorAssetRaw.type as 'video' | 'image' | 'carousel' | 'post_with_asset' | 'thread_with_asset',
      url: typeof creatorAssetRaw.url === 'string' ? creatorAssetRaw.url : undefined,
      files: Array.isArray(creatorAssetRaw.files) ? creatorAssetRaw.files as string[] : undefined,
      thumbnail: typeof creatorAssetRaw.thumbnail === 'string' ? creatorAssetRaw.thumbnail : undefined,
      description: typeof creatorAssetRaw.description === 'string' ? creatorAssetRaw.description : undefined,
      transcript: typeof creatorAssetRaw.transcript === 'string' ? creatorAssetRaw.transcript : undefined,
      theme: typeof creatorAssetRaw.theme === 'string' ? creatorAssetRaw.theme : undefined,
      metadata: asObject(creatorAssetRaw.metadata) ?? undefined,
    };

    let companyId: string | null = null;
    const { data: ver } = await supabase
      .from('campaign_versions')
      .select('company_id')
      .eq('campaign_id', campaignId)
      .limit(1)
      .maybeSingle();
    if (ver?.company_id) companyId = ver.company_id as string;
    else {
      const { data: camp } = await supabase
        .from('campaigns')
        .select('company_id')
        .eq('id', campaignId)
        .maybeSingle();
      if (camp?.company_id) companyId = camp.company_id as string;
    }

    if (isContentArchitectSession(req)) {
      const archAccess = checkContentArchitectAccess(req, res, companyId ?? undefined);
      if (archAccess === null) return;
    } else {
      const access = await enforceCompanyAccess({
        req,
        res,
        companyId,
        campaignId,
        requireCampaignId: true,
      });
      if (!access) return;
    }

    const validWeek = Number.isFinite(weekNumber) && weekNumber > 0 ? weekNumber : 1;
    const validDay = day || 'Monday';

    const { data: existing } = await supabase
      .from('daily_content_plans')
      .select('id, execution_id, content_type, platform, content')
      .eq('campaign_id', campaignId)
      .eq('week_number', validWeek)
      .eq('day_of_week', validDay)
      .eq('execution_id', executionId)
      .maybeSingle();

    // STEP 7: Reject asset upload for AI_AUTOMATED activities (infer from content_type)
    if (existing) {
      const contentType = String((existing as any)?.content_type ?? '').trim().toLowerCase() || 'post';
      const mode = inferExecutionMode(contentType);
      if (mode === 'AI_AUTOMATED') {
        return res.status(400).json({
          error: 'Creator asset upload is only allowed for CREATOR_REQUIRED activities. This activity is AI_AUTOMATED.',
        });
      }
      const overrideValidationError = await validateCreatorAssetOverride({
        creatorAsset,
        planContentType: contentType,
        planPlatform: typeof (existing as any)?.platform === 'string' ? String((existing as any).platform) : null,
      });
      if (overrideValidationError) {
        return res.status(400).json({
          error: overrideValidationError,
        });
      }
    }

    const existingEnvelope =
      typeof (existing as any)?.content === 'string'
        ? (() => {
            try { return JSON.parse(String((existing as any).content || '{}')); } catch { return {}; }
          })()
        : ((existing as any)?.content && typeof (existing as any).content === 'object' ? (existing as any).content : {});

    const mergedEnvelope = {
      ...(existingEnvelope || {}),
      intent_type: 'creator',
      asset_type: creatorAsset.type,
      asset_instruction: {
        ...((((existingEnvelope as any)?.asset_instruction && typeof (existingEnvelope as any).asset_instruction === 'object')
          ? (existingEnvelope as any).asset_instruction
          : {})),
        blueprint: (((existingEnvelope as any)?.asset_instruction?.blueprint && typeof (existingEnvelope as any).asset_instruction.blueprint === 'object')
          ? (existingEnvelope as any).asset_instruction.blueprint
          : {}),
        structure: (((existingEnvelope as any)?.asset_instruction?.structure && typeof (existingEnvelope as any).asset_instruction.structure === 'object')
          ? (existingEnvelope as any).asset_instruction.structure
          : {}),
        template_id: (((existingEnvelope as any)?.asset_instruction?.template_id && typeof (existingEnvelope as any).asset_instruction.template_id === 'string')
          ? (existingEnvelope as any).asset_instruction.template_id
          : null),
      },
      asset_payload: {
        ...(((existingEnvelope as any)?.asset_payload && typeof (existingEnvelope as any).asset_payload === 'object')
          ? (existingEnvelope as any).asset_payload
          : {}),
        override_asset: creatorAsset,
      },
      packaging: {
        caption: String((existingEnvelope as any)?.packaging?.caption || ''),
        hashtags: Array.isArray((existingEnvelope as any)?.packaging?.hashtags) ? (existingEnvelope as any).packaging.hashtags : [],
        meta_description: String((existingEnvelope as any)?.packaging?.meta_description || ''),
        keywords: Array.isArray((existingEnvelope as any)?.packaging?.keywords) ? (existingEnvelope as any).packaging.keywords : [],
        cta: String((existingEnvelope as any)?.packaging?.cta || ''),
        platform_variants:
          ((existingEnvelope as any)?.packaging?.platform_variants && typeof (existingEnvelope as any).packaging.platform_variants === 'object')
            ? (existingEnvelope as any).packaging.platform_variants
            : {},
      },
      metadata: {
        ...((((existingEnvelope as any)?.metadata && typeof (existingEnvelope as any).metadata === 'object')
          ? (existingEnvelope as any).metadata
          : {})),
        asset_override: true,
      },
    };

    const { data: latestCampaignVersion } = await supabase
      .from('campaign_versions')
      .select('version')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const currentPlanVersion = Math.max(1, Number((latestCampaignVersion as any)?.version || 1));

    const updatePayload: Record<string, unknown> = {
      creator_asset: creatorAsset,
      content: JSON.stringify(mergedEnvelope),
      intent_type: 'creator',
      asset_type: creatorAsset.type,
      plan_version: currentPlanVersion,
      content_status: 'creator_ready',
      failure_type: null,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await updateActivity(String(existing.id), updatePayload, 'board');
      return res.status(200).json({
        success: true,
        creator_asset: creatorAsset,
        content_status: 'creator_ready',
        daily_plan_id: existing.id,
      });
    }

    const { data: refinement } = await supabase
      .from('weekly_content_refinements')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('week_number', validWeek)
      .maybeSingle();

    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() + (validWeek - 1) * 7);
    const dayIndex = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].indexOf(validDay);
    const activityDate = new Date(weekStart);
    activityDate.setDate(weekStart.getDate() + dayIndex);

    const insertPayload = {
      campaign_id: campaignId,
      week_number: validWeek,
      day_of_week: validDay,
      date: activityDate.toISOString().split('T')[0],
      platform: 'linkedin',
      content_type: creatorAsset.type,
      title: 'Creator content',
      content: JSON.stringify({
        intent_type: 'creator',
        asset_type: creatorAsset.type,
        asset_instruction: {
          blueprint: {},
          structure: {},
          template_id: null,
        },
        asset_payload: {
          override_asset: creatorAsset,
        },
        packaging: {
          caption: '',
          hashtags: [],
          meta_description: '',
          keywords: [],
          cta: '',
          platform_variants: {},
        },
        metadata: {
          asset_override: true,
        },
      }),
      intent_type: 'creator',
      asset_type: creatorAsset.type,
      plan_version: currentPlanVersion,
      execution_id: executionId,
      creator_asset: creatorAsset,
      content_status: 'creator_ready',
      failure_type: null,
      failure_reason: null,
      status: 'planned',
      ...(refinement?.id && { source_refinement_id: refinement.id }),
    };

    const { id: dailyPlanId } = await insertActivity(insertPayload as any, 'board');

    return res.status(200).json({
      success: true,
      creator_asset: creatorAsset,
      content_status: 'creator_ready',
      daily_plan_id: dailyPlanId ?? null,
    });
  } catch (err) {
    console.error('creator-asset API error:', err);
    return res.status(500).json({
      error: 'Failed to process creator asset request',
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

