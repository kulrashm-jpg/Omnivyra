/**
 * POST /api/planner/generate-workspace-content
 * Generates platform-specific content variants for the Activity Workspace Drawer.
 * Lightweight — works in preview/planner mode without a saved campaign.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { getProfile } from '../../../backend/services/companyProfileService';
import { buildCompanyContext } from '../../../backend/services/companyContextService';
import { runCompletionWithOperation } from '../../../backend/services/aiGateway';

const PLATFORM_FORMAT: Record<string, { limit: string; tone: string; format: string }> = {
  linkedin:  { limit: '3000 chars',     tone: 'Professional, insight-led',      format: 'Hook → Value → CTA with line breaks' },
  instagram: { limit: '2200 chars',     tone: 'Visual, aspirational',            format: 'Short caption + 5-10 hashtags' },
  twitter:   { limit: '280 chars',      tone: 'Punchy, conversational',          format: 'Single tweet or start of thread' },
  x:         { limit: '280 chars',      tone: 'Punchy, conversational',          format: 'Single tweet or start of thread' },
  facebook:  { limit: '63206 chars',    tone: 'Community, friendly',             format: 'Story + engagement question at end' },
  youtube:   { limit: '5000 chars',     tone: 'Educational, narrative',          format: 'Script outline or video description' },
  tiktok:    { limit: '2200 chars',     tone: 'Casual, trend-aware',             format: 'Hook in first line + story arc' },
  pinterest: { limit: '500 chars',      tone: 'Inspirational, keyword-rich',     format: 'Idea pin description' },
  reddit:    { limit: 'No hard limit',  tone: 'Authentic, community-first',      format: 'Post title + body + discussion question' },
};

function getPlatformSpec(platform: string) {
  return PLATFORM_FORMAT[platform.toLowerCase()] ?? {
    limit: 'Platform-appropriate',
    tone: 'Professional',
    format: 'Standard post',
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { companyId, topic, platforms, contentTypes, theme, objective, week } = req.body || {};

    if (!companyId || typeof companyId !== 'string') {
      return res.status(400).json({ error: 'companyId is required' });
    }
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'topic is required' });
    }
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms array is required' });
    }

    const access = await enforceCompanyAccess({ req, res, companyId: companyId.trim(), requireCampaignId: false });
    if (!access) return;

    // Load company profile for brand context
    const profile = await getProfile(companyId.trim(), { autoRefine: false, languageRefine: false });
    let brandContext = '';
    if (profile) {
      const ctx = buildCompanyContext(profile);
      const parts: string[] = [];
      if (ctx.company_name) parts.push(`Company: ${ctx.company_name}`);
      if (ctx.industry) parts.push(`Industry: ${ctx.industry}`);
      if (ctx.value_proposition) parts.push(`Value proposition: ${ctx.value_proposition}`);
      if (ctx.tone_of_voice) parts.push(`Tone of voice: ${ctx.tone_of_voice}`);
      if (ctx.target_audience) parts.push(`Target audience: ${ctx.target_audience}`);
      brandContext = parts.join('\n');
    }

    // Build platform-specific instructions
    const platformSpecs = (platforms as string[]).map((p) => {
      const spec = getPlatformSpec(p);
      const ct = (contentTypes as Record<string, string> | undefined)?.[p] ?? 'post';
      return `- ${p} (${ct}): Tone: ${spec.tone} | Limit: ${spec.limit} | Format: ${spec.format}`;
    }).join('\n');

    const contextLines: string[] = [];
    if (theme) contextLines.push(`Weekly theme: ${theme}`);
    if (objective) contextLines.push(`Objective: ${objective}`);
    if (week) contextLines.push(`Campaign week: ${week}`);

    const systemPrompt = `You are an expert social media content writer. Generate platform-specific content variants for a single topic.
Return ONLY a valid JSON object where keys are platform names (lowercase) and values are the ready-to-publish content strings.
Do not include any explanation outside the JSON.`;

    const userPrompt = `${brandContext ? `Brand context:\n${brandContext}\n\n` : ''}${contextLines.length > 0 ? contextLines.join('\n') + '\n\n' : ''}Core topic / angle:\n${topic.trim()}

Generate content for each platform below, adapting tone, length, and format to platform best practices:
${platformSpecs}

Return JSON like: { "linkedin": "...", "instagram": "..." }`;

    const result = await runCompletionWithOperation({
      companyId,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      operation: 'generatePlatformVariants',
    });

    let variants: Record<string, string> = {};
    try {
      const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? {});
      const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, ''));
      // Normalize keys to lowercase
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') variants[k.toLowerCase()] = v;
      }
    } catch {
      return res.status(500).json({ error: 'AI returned malformed JSON' });
    }

    return res.status(200).json({ variants });
  } catch (err: unknown) {
    console.error('[planner/generate-workspace-content]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to generate content' });
  }
}

export default handler;
