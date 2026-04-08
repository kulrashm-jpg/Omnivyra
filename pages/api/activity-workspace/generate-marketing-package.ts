import { NextApiRequest, NextApiResponse } from 'next';
import { runCompletionWithOperation } from '@/backend/services/aiGateway';
import { supabase } from '@/backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { getSupabaseUserFromRequest } = await import('@/backend/services/supabaseAuthService');
  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const {
      theme = '',
      summary = '',
      objective = '',
      target_audience = '',
      content_type = 'video',
      platforms = [] as string[],
      existing_hashtags = [] as string[],
    } = req.body as Record<string, unknown> & {
      theme?: string;
      summary?: string;
      objective?: string;
      target_audience?: string;
      content_type?: string;
      platforms?: string[];
      existing_hashtags?: string[];
    };

    const platformList = (Array.isArray(platforms) ? platforms : []).join(', ') || 'LinkedIn, Instagram';
    const hashtagHint = existing_hashtags.length > 0 ? `\nExisting hashtag suggestions: ${existing_hashtags.join(', ')}` : '';

    const prompt = `You are a social media marketing expert. Generate a complete marketing package for the following content.

Content Type: ${content_type}
Theme: ${theme}
${objective ? `Objective: ${objective}` : ''}
${summary ? `Brief: ${summary}` : ''}
${target_audience ? `Target Audience: ${target_audience}` : ''}
Target Platforms: ${platformList}${hashtagHint}

Return a JSON object with EXACTLY these fields:
{
  "title": "compelling SEO-optimised content title (60-70 chars max)",
  "summary": "2-3 sentence content summary for platform bio/description fields",
  "meta_description": "150-160 char meta description for web/SEO use",
  "seo_keywords": ["keyword1", "keyword2", ...],
  "hashtags": ["#hashtag1", "#hashtag2", ...],
  "cta": "clear call-to-action phrase (max 10 words)",
  "platform_hashtags": {
    "linkedin": ["#tag1", "#tag2"],
    "instagram": ["#tag1", "#tag2"],
    "tiktok": ["#tag1", "#tag2"],
    "x": ["#tag1", "#tag2"],
    "youtube": ["#tag1", "#tag2"],
    "facebook": ["#tag1", "#tag2"],
    "pinterest": ["#tag1", "#tag2"]
  }
}

Rules:
- seo_keywords: 5-10 specific, searchable keywords (no # prefix)
- hashtags: 8-15 universal hashtags (with # prefix), mix of niche and broad
- platform_hashtags: 5-8 platform-optimised hashtags per platform (only include platforms in: ${platformList})
- meta_description: written for Google/web, not social
- All text must be relevant to the theme and content type
Return ONLY the JSON object, no markdown, no commentary.`;

    const result = await runCompletionWithOperation({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      operation: 'generate_marketing_package',
      temperature: 0.4,
      messages: [
        { role: 'system', content: 'You are a social media marketing expert. Always respond with valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    });
    const raw = String(result?.output || '').trim();

    let parsed: Record<string, unknown>;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      return res.status(500).json({ error: 'AI returned invalid JSON', raw });
    }

    return res.status(200).json({ success: true, marketing: parsed });
  } catch (err) {
    console.error('[generate-marketing-package]', err);
    return res.status(500).json({ error: 'Failed to generate marketing package' });
  }
}
