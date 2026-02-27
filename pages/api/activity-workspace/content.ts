import { NextApiRequest, NextApiResponse } from 'next';
import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
} from '@/backend/services/contentGenerationPipeline';
import { generateCampaignPlan } from '@/backend/services/aiGateway';

type WorkspaceAction = 'generate_master' | 'generate_variants' | 'refine_variant';

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
    const action = String((req.body as any)?.action || '').trim() as WorkspaceAction;
    const activity = asObject((req.body as any)?.activity) || {};
    const schedules = Array.isArray((req.body as any)?.schedules) ? (req.body as any).schedules : [];
    const dailyExecutionItemRaw = asObject((req.body as any)?.dailyExecutionItem) || {};

    if (!action || !['generate_master', 'generate_variants', 'refine_variant'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const activePlatformTargets = schedules
      .map((s: any) => {
        const platform = String(s?.platform || '').trim().toLowerCase();
        const contentType = String(s?.contentType || '').trim().toLowerCase();
        if (!platform) return null;
        return {
          platform,
          content_type: contentType || String(activity.contentType || '').trim().toLowerCase() || 'post',
        };
      })
      .filter(Boolean);

    const item: any = {
      execution_id: String((dailyExecutionItemRaw as any)?.execution_id || activity.id || '').trim() || `workspace-${Date.now()}`,
      platform: String((dailyExecutionItemRaw as any)?.platform || activity.platform || '').trim().toLowerCase() || 'linkedin',
      content_type: String((dailyExecutionItemRaw as any)?.content_type || activity.contentType || '').trim().toLowerCase() || 'post',
      topic: String((dailyExecutionItemRaw as any)?.topic || activity.topic || activity.title || '').trim(),
      title: String((dailyExecutionItemRaw as any)?.title || activity.title || '').trim(),
      content: String((dailyExecutionItemRaw as any)?.content || activity.description || '').trim(),
      intent: asObject((dailyExecutionItemRaw as any)?.intent) || undefined,
      writer_content_brief: asObject((dailyExecutionItemRaw as any)?.writer_content_brief) || undefined,
      narrative_role: String((dailyExecutionItemRaw as any)?.narrative_role || '').trim() || undefined,
      progression_step: Number.isFinite(Number((dailyExecutionItemRaw as any)?.progression_step))
        ? Number((dailyExecutionItemRaw as any).progression_step)
        : undefined,
      global_progression_index: Number.isFinite(Number((dailyExecutionItemRaw as any)?.global_progression_index))
        ? Number((dailyExecutionItemRaw as any).global_progression_index)
        : undefined,
      master_content: asObject((dailyExecutionItemRaw as any)?.master_content) || undefined,
      platform_variants: Array.isArray((dailyExecutionItemRaw as any)?.platform_variants)
        ? (dailyExecutionItemRaw as any).platform_variants
        : undefined,
      active_platform_targets: activePlatformTargets.length > 0 ? activePlatformTargets : undefined,
      media_assets: Array.isArray((dailyExecutionItemRaw as any)?.media_assets) ? (dailyExecutionItemRaw as any).media_assets : undefined,
      media_status:
        (dailyExecutionItemRaw as any)?.media_status === 'ready' || (dailyExecutionItemRaw as any)?.media_status === 'missing'
          ? (dailyExecutionItemRaw as any).media_status
          : undefined,
    };

    if (action === 'generate_master') {
      const master = await generateMasterContentFromIntent(item);
      return res.status(200).json({
        success: true,
        master_content: master,
      });
    }

    if (action === 'refine_variant') {
      const schedule = asObject((req.body as any)?.schedule) || {};
      const platform = String(schedule?.platform || activity.platform || item.platform || '').trim().toLowerCase();
      const contentType = String(schedule?.contentType || activity.contentType || item.content_type || '').trim().toLowerCase() || 'post';
      const prompt = String((req.body as any)?.refinement_prompt || '').trim();
      const currentContent = String((req.body as any)?.current_content || '').trim();

      if (!platform) {
        return res.status(400).json({ error: 'Platform is required for refinement' });
      }
      if (!prompt) {
        return res.status(400).json({ error: 'Refinement prompt is required' });
      }
      if (!currentContent) {
        return res.status(400).json({ error: 'Current content is required for refinement' });
      }

      const aiResult = await generateCampaignPlan({
        companyId: null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content:
              'You are a senior social content editor. Apply user refinement instructions while preserving factual meaning and platform fit. Return only refined content plain text.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              platform,
              content_type: contentType,
              refinement_instruction: prompt,
              current_content: currentContent,
              objective: item?.intent?.objective ?? null,
              audience: item?.intent?.target_audience ?? null,
              cta: item?.intent?.cta_type ?? null,
            }),
          },
        ],
      });

      const refined = String(aiResult?.output || '').trim();
      if (!refined) {
        return res.status(500).json({ error: 'AI refinement returned empty output' });
      }

      return res.status(200).json({
        success: true,
        refined_content: refined,
      });
    }

    if (!item.master_content || String((item.master_content as any)?.generation_status || '').toLowerCase() !== 'generated') {
      return res.status(400).json({
        error: 'MASTER_CONTENT_REQUIRED',
        message: 'Generate master content before platform variants.',
      });
    }

    const variants = await buildPlatformVariantsFromMaster(item);
    return res.status(200).json({
      success: true,
      platform_variants: variants,
    });
  } catch (error) {
    console.error('activity-workspace content API error:', error);
    return res.status(500).json({ error: 'Failed to process activity content request' });
  }
}

