import { NextApiRequest, NextApiResponse } from 'next';
import {
  buildPlatformVariantsFromMaster,
  generateMasterContentFromIntent,
  optimizeDiscoverabilityForPlatform,
} from '@/backend/services/contentGenerationPipeline';
import { generateCampaignPlan } from '@/backend/services/aiGateway';
import { refineLanguageOutput } from '@/backend/services/languageRefinementService';

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
        // Store hashtags in discoverability_meta only — do NOT append to generated_content.
        // The preview layer renders hashtags from discoverability_meta.hashtags separately.
        const improved_variant = {
          ...variant,
          discoverability_meta: discoverabilityMeta,
          generated_content: currentContent,
        };
        return res.status(200).json({ success: true, improved_variant });
      }

      if (!['IMPROVE_CTA', 'IMPROVE_HOOK'].includes(improvementType)) {
        return res.status(400).json({ error: 'Unsupported improvement type' });
      }

      // Build a plain-text prompt — avoids JSON parsing confusion in the model
      const lines = currentContent.split('\n');
      const firstLine = lines[0] ?? '';
      const restLines = lines.slice(1).join('\n');
      const lastSentenceIdx = currentContent.search(/[.!?][^.!?]*$/);
      const beforeLastSentence = lastSentenceIdx > 0 ? currentContent.slice(0, lastSentenceIdx + 1).trimEnd() : '';
      const lastSentence = lastSentenceIdx > 0 ? currentContent.slice(lastSentenceIdx + 1).trim() : currentContent.trim();

      const systemPrompt =
        improvementType === 'IMPROVE_HOOK'
          ? [
              'You are a social content editor. Your ONLY job: rewrite the FIRST LINE of the content to be punchier and under 100 characters.',
              'STRICT RULES:',
              '1. Output the COMPLETE content — first line replaced, every other line UNCHANGED.',
              '2. Do NOT touch any line after the first.',
              '3. Do NOT add anything at the end.',
              '4. Return plain text only — no labels, no commentary.',
            ].join('\n')
          : [
              'You are a social content editor. Your ONLY job: rewrite the LAST SENTENCE (or last 1-2 sentences) of the content to be a stronger, more specific call-to-action.',
              'STRICT RULES:',
              '1. Output the COMPLETE content — everything before the last sentence UNCHANGED, last sentence replaced with a better CTA.',
              '2. Do NOT append a new line at the bottom — the new CTA replaces the existing ending in-place.',
              '3. Do NOT touch anything before the last sentence.',
              '4. Return plain text only — no labels, no commentary.',
            ].join('\n');

      const userPrompt =
        improvementType === 'IMPROVE_HOOK'
          ? [
              `Platform: ${platform} | Type: ${contentType}`,
              '',
              '## FIRST LINE (rewrite this):',
              firstLine,
              '',
              '## REST OF CONTENT (keep exactly as-is):',
              restLines,
              '',
              'Output the complete revised content now:',
            ].join('\n')
          : [
              `Platform: ${platform} | Type: ${contentType}`,
              '',
              '## CONTENT BEFORE LAST SENTENCE (keep exactly as-is):',
              beforeLastSentence || currentContent,
              '',
              '## LAST SENTENCE (replace with a stronger CTA):',
              lastSentence || '(no ending sentence found — add a CTA at the end)',
              '',
              'Output the complete revised content now:',
            ].join('\n');

      const aiResult = await generateCampaignPlan({
        companyId: null,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt },
        ],
      });
      let revised = String(aiResult?.output || '').trim();
      if (!revised) {
        return res.status(500).json({ error: 'Improvement returned empty output' });
      }
      const refinedImprove = await refineLanguageOutput({
        content: revised,
        card_type: 'platform_variant',
        platform,
      });
      revised = (refinedImprove.refined as string) || revised;
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

      let refined = String(aiResult?.output || '').trim();
      if (!refined) {
        return res.status(500).json({ error: 'AI refinement returned empty output' });
      }
      const refinedOutput = await refineLanguageOutput({
        content: refined,
        card_type: 'repurpose_card',
        platform,
      });
      refined = (refinedOutput.refined as string) || refined;

      return res.status(200).json({
        success: true,
        refined_content: refined,
      });
    }

    const creatorAsset = asObject((dailyExecutionItemRaw as any)?.creator_asset);
    const hasCreatorAsset = creatorAsset && (
      String(creatorAsset.url ?? '').trim() || (Array.isArray(creatorAsset.files) && creatorAsset.files.length > 0)
    );
    const creatorMasterText = hasCreatorAsset
      ? (String(creatorAsset.description ?? '').trim() || String(creatorAsset.transcript ?? '').trim() || String(creatorAsset.theme ?? '').trim() || String(item.topic ?? item.title ?? '').trim())
      : '';

    if (!item.master_content && !creatorMasterText) {
      return res.status(400).json({
        error: 'MASTER_CONTENT_REQUIRED',
        message: 'Generate master content or upload creator asset (with description/transcript/theme) before platform variants.',
      });
    }

    const itemWithMaster = creatorMasterText
      ? {
          ...item,
          master_content: {
            id: `creator-${item.execution_id}`,
            generated_at: new Date().toISOString(),
            content: creatorMasterText,
            generation_status: 'generated' as const,
            generation_source: 'creator' as const,
            content_type_mode: 'text' as const,
          },
        }
      : item;

    const variants = await buildPlatformVariantsFromMaster(itemWithMaster);
    return res.status(200).json({
      success: true,
      platform_variants: variants,
    });
  } catch (error) {
    console.error('activity-workspace content API error:', error);
    return res.status(500).json({ error: 'Failed to process activity content request' });
  }
}

