import { NextApiRequest, NextApiResponse } from 'next';
import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  optimizeDiscoverabilityForPlatform,
} from '@/backend/services/contentGenerationPipeline';
import { generateCampaignPlan } from '@/backend/services/aiGateway';

type WorkspaceAction = 'generate_master' | 'generate_variants' | 'refine_variant' | 'improve_variant';
type ImprovementType = 'IMPROVE_CTA' | 'IMPROVE_HOOK' | 'ADD_DISCOVERABILITY';

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
    const extra_instruction = typeof (req.body as any)?.extra_instruction === 'string' ? String((req.body as any).extra_instruction).trim() || undefined : undefined;

    if (!action || !['generate_master', 'generate_variants', 'refine_variant', 'improve_variant'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    if (action === 'improve_variant') {
      const improvementType = String((req.body as any)?.improvementType || '').trim() as ImprovementType;
      const variantRaw = asObject((req.body as any)?.variant);
      const platform = String((req.body as any)?.platform || (variantRaw as any)?.platform || '').trim().toLowerCase();
      const executionId = String((req.body as any)?.executionId || (req.body as any)?.execution_id || (dailyExecutionItemRaw as any)?.execution_id || '').trim();
      if (!variantRaw || !platform || !['IMPROVE_CTA', 'IMPROVE_HOOK', 'ADD_DISCOVERABILITY'].includes(improvementType)) {
        return res.status(400).json({ error: 'improve_variant requires improvementType, platform, and variant' });
      }
      const variant = { ...variantRaw } as any;
      const currentContent = String(variant?.generated_content || variant?.content || '').trim();
      if (!currentContent) {
        return res.status(400).json({ error: 'Variant has no content to improve' });
      }
      const contentType = String(variant?.content_type || 'post').trim().toLowerCase();

      if (improvementType === 'ADD_DISCOVERABILITY') {
        const discoverabilityMeta = await optimizeDiscoverabilityForPlatform(currentContent, platform, contentType);
        const hashtagLine = Array.isArray(discoverabilityMeta?.hashtags) && discoverabilityMeta.hashtags.length > 0
          ? '\n\n' + (discoverabilityMeta.hashtags as string[]).join(' ')
          : '';
        const improved_variant = {
          ...variant,
          discoverability_meta: discoverabilityMeta,
          generated_content: currentContent + hashtagLine,
        };
        return res.status(200).json({ success: true, improved_variant });
      }

      const instructions: Record<ImprovementType, string> = {
        IMPROVE_CTA: 'Add a clear call-to-action at the end (e.g. Learn more, Sign up, Try now, Book a demo). Keep the rest of the content unchanged. Return only the revised content.',
        IMPROVE_HOOK: 'Make the first line or opening sentence shorter and punchier (under 100 characters). Keep the rest of the content unchanged. Return only the revised content.',
        ADD_DISCOVERABILITY: '',
      };
      const instruction = instructions[improvementType];
      if (!instruction) {
        return res.status(400).json({ error: 'Unsupported improvement type' });
      }
      const aiResult = await generateCampaignPlan({
        companyId: null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You are a senior social content editor. Apply only the requested change. Return only the revised content plain text, no explanation.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              platform,
              content_type: contentType,
              instruction,
              current_content: currentContent,
              intent: (dailyExecutionItemRaw as any)?.intent ?? null,
            }),
          },
        ],
      });
      const revised = String(aiResult?.output || '').trim();
      if (!revised) {
        return res.status(500).json({ error: 'Improvement returned empty output' });
      }
      const improved_variant = {
        ...variant,
        generated_content: revised,
      };
      return res.status(200).json({ success: true, improved_variant });
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
      ...(extra_instruction ? { extra_instruction } : {}),
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

