import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { processContent, PLATFORM_CHAR_LIMITS } from '@/backend/services/unifiedContentProcessor';
import { optimizeDiscoverabilityForPlatform } from '@/backend/services/contentGeneration/discoverabilityHelpers';
import { runCompletionWithOperation } from '@/backend/services/aiGateway';

function buildPlatformRewritePrompt(platform: string, contentType: string, targetLimit: number | null) {
  const platformLabel = platform === 'x' ? 'X' : platform.charAt(0).toUpperCase() + platform.slice(1);
  const platformGuide: Record<string, string[]> = {
    x: [
      'Lead with one sharp point or contrarian insight.',
      'Use short punchy lines.',
      'Make it feel native to fast-moving social conversation.',
      'End cleanly without trailing filler or ellipses.',
    ],
    instagram: [
      'Open with a strong scroll-stopping hook.',
      'Use short emotional or story-driven blocks.',
      'Write like a caption, not a LinkedIn post.',
      'Keep the close action-oriented and audience-friendly.',
    ],
    facebook: [
      'Use a warm, conversational tone.',
      'Make the post easy to skim for a broad audience.',
      'Favor clarity and relatability over thought-leadership jargon.',
      'Close with a natural engagement prompt or next step.',
    ],
    tiktok: [
      'Open with curiosity immediately.',
      'Use rapid, compact phrasing built for short attention spans.',
      'Make it sound like creator-native social copy.',
      'End with a low-friction CTA.',
    ],
    pinterest: [
      'Lead with the searchable topic or outcome.',
      'Focus on utility, inspiration, and the specific benefit.',
      'Make it feel like pin copy, not a post caption.',
      'Keep it concise and keyword-friendly.',
    ],
    reddit: [
      'Remove polished brand-marketing phrasing.',
      'Make it sound grounded, useful, and community-native.',
      'Avoid salesy CTA language.',
      'Close with an authentic discussion angle when appropriate.',
    ],
    linkedin: [
      'Keep a strong opening hook.',
      'Use short professional paragraphs.',
      'Preserve a credible, insight-led tone.',
      'End with a clear CTA or takeaway.',
    ],
  };

  const rules = platformGuide[platform] || [
    'Rewrite it to feel native to the target platform.',
    'Keep the meaning intact but change pacing, tone, and structure for the channel.',
  ];

  return [
    `You are a senior ${platformLabel} social copywriter.`,
    `Repurpose the source ${contentType} into a native ${platformLabel} ${contentType}.`,
    'Do not summarize mechanically and do not simply shorten the original.',
    'Rewrite it so it feels created for that platform from the start.',
    ...rules,
    targetLimit ? `Keep the rewritten body within ${targetLimit} characters before hashtags.` : 'Keep the rewritten body concise and platform-appropriate.',
    'Preserve the core business meaning and strongest insight.',
    'Return plain text only.',
  ].join('\n');
}

async function rewriteForPlatform({
  content,
  platform,
  contentType,
}: {
  content: string;
  platform: string;
  contentType: string;
}) {
  const charLimit = PLATFORM_CHAR_LIMITS[platform] ?? 280;
  const targetLimit = charLimit ? Math.max(Math.min(charLimit - 20, charLimit), Math.min(220, charLimit)) : null;
  const result = await runCompletionWithOperation({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    operation: 'regenerateContent',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: buildPlatformRewritePrompt(platform, contentType, targetLimit),
      },
      {
        role: 'user',
        content,
      },
    ],
  });

  return String(result?.output || '').trim();
}

function requiresTrueRewrite(platform: string) {
  return ['x', 'twitter', 'instagram', 'facebook', 'tiktok', 'pinterest', 'reddit'].includes(platform);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const platform = String((req.body as any)?.platform || '').trim().toLowerCase();
    const content = String((req.body as any)?.content || '').trim();
    const contentType = String((req.body as any)?.contentType || 'post').trim().toLowerCase();

    if (!platform) {
      return res.status(400).json({ error: 'platform is required' });
    }
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }

    let workingContent = content;
    let rewriteApplied = false;
    try {
      const rewritten = await rewriteForPlatform({
        content,
        platform,
        contentType,
      });
      if (rewritten) {
        workingContent = rewritten;
        rewriteApplied = true;
      }
    } catch {
      workingContent = content;
    }

    if (requiresTrueRewrite(platform) && !rewriteApplied) {
      return res.status(502).json({
        error: `Platform-native rewrite for ${platform === 'x' ? 'X' : platform} did not complete.`,
      });
    }

    const processed = await processContent({
      content: workingContent,
      platform,
      content_type: contentType,
      card_type: 'platform_variant',
      enforce_char_limit: true,
    });

    let discoverabilityMeta: Record<string, unknown> | null = null;
    try {
      discoverabilityMeta = await optimizeDiscoverabilityForPlatform(processed.content, platform, contentType);
    } catch {
      discoverabilityMeta = null;
    }

    return res.status(200).json({
      success: true,
      variant: {
        platform,
        content_type: contentType,
        generated_content: processed.content,
        generation_status: 'generated',
        adaptation_trace: {
          adaptation_style: 'platform_specific',
          adaptation_reason: `Applied quick platform formatting rules for ${platform}.`,
          processing_trace: processed.processing_trace,
        },
        discoverability_meta: discoverabilityMeta,
      },
    });
  } catch (routeError) {
    return res.status(500).json({
      error: routeError instanceof Error ? routeError.message : 'Failed to adapt content quickly',
    });
  }
}
