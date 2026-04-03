
/**
 * POST /api/activity-workspace/creator-asset
 * Saves creator-uploaded asset (video, image, carousel) for a creator activity.
 * Stores in daily_content_plans.creator_asset and sets content_status = READY_FOR_PROMOTION.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { enforceCompanyAccess } from '@/backend/services/userContextService';
import { updateActivity, insertActivity } from '@/backend/services/executionPlannerService';
import {
  isContentArchitectSession,
  checkContentArchitectAccess,
} from '@/backend/services/contentArchitectService';
import { inferExecutionMode } from '@/backend/services/executionModeInference';

export type CreatorAssetInput = {
  type: 'video' | 'image' | 'carousel';
  url?: string;
  files?: string[];
  thumbnail?: string;
  /** Description/transcript/theme for repurposing; used as master content source */
  description?: string;
  transcript?: string;
  theme?: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    if (!creatorAssetRaw || !['video', 'image', 'carousel'].includes(String(creatorAssetRaw.type ?? ''))) {
      return res.status(400).json({
        error: 'Invalid creator_asset: must have type (video | image | carousel)',
      });
    }

    const creatorAsset: CreatorAssetInput = {
      type: creatorAssetRaw.type as 'video' | 'image' | 'carousel',
      url: typeof creatorAssetRaw.url === 'string' ? creatorAssetRaw.url : undefined,
      files: Array.isArray(creatorAssetRaw.files) ? creatorAssetRaw.files as string[] : undefined,
      thumbnail: typeof creatorAssetRaw.thumbnail === 'string' ? creatorAssetRaw.thumbnail : undefined,
      description: typeof creatorAssetRaw.description === 'string' ? creatorAssetRaw.description : undefined,
      transcript: typeof creatorAssetRaw.transcript === 'string' ? creatorAssetRaw.transcript : undefined,
      theme: typeof creatorAssetRaw.theme === 'string' ? creatorAssetRaw.theme : undefined,
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
      .select('id, execution_id, content_type')
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
    }

    const updatePayload: Record<string, unknown> = {
      creator_asset: creatorAsset,
      content_status: 'READY_FOR_PROMOTION',
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      await updateActivity(String(existing.id), updatePayload, 'board');
      return res.status(200).json({
        success: true,
        creator_asset: creatorAsset,
        content_status: 'READY_FOR_PROMOTION',
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
      content_type: 'video',
      title: 'Creator content',
      content: '',
      execution_id: executionId,
      creator_asset: creatorAsset,
      content_status: 'READY_FOR_PROMOTION',
      status: 'planned',
      ...(refinement?.id && { source_refinement_id: refinement.id }),
    };

    const { id: dailyPlanId } = await insertActivity(insertPayload as any, 'board');

    return res.status(200).json({
      success: true,
      creator_asset: creatorAsset,
      content_status: 'READY_FOR_PROMOTION',
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
