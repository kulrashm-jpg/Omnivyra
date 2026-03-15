/**
 * Idea Refinement Service
 * Refines free-form campaign ideas using existing AI gateway.
 * Reuses generateCampaignPlan model configuration (gpt-4o-mini, temperature 0).
 * Normalizes AI suggestions into canonical campaign angle categories.
 */

import { runCompletionWithOperation } from './aiGateway';

export interface IdeaRefinementInput {
  idea_text: string;
  company_profile?: Record<string, unknown> | null;
  recommendation_context?: Record<string, unknown> | null;
  opportunity_context?: Record<string, unknown> | null;
}

export interface IdeaRefinementResult {
  refined_title: string;
  refined_description: string;
  normalized_angles: string[];
}

/** Canonical campaign angle categories. Model MUST produce only these. */
export const CANONICAL_ANGLES = [
  'EDUCATION',
  'THOUGHT_LEADERSHIP',
  'PROBLEM_AWARENESS',
  'INDUSTRY_TREND',
  'PRODUCT_POSITIONING',
  'CASE_STUDY',
  'COMMUNITY_ENGAGEMENT',
] as const;

const CANONICAL_SET = new Set<string>(CANONICAL_ANGLES as unknown as string[]);

function buildCompanyContext(profile: Record<string, unknown> | null | undefined): string {
  if (!profile || typeof profile !== 'object') return '';
  const parts: string[] = [];
  if (profile.name) parts.push(`Company: ${String(profile.name)}`);
  if (profile.industry) parts.push(`Industry: ${String(profile.industry)}`);
  if (profile.target_audience) parts.push(`Target audience: ${String(profile.target_audience)}`);
  if (profile.content_themes) parts.push(`Content themes: ${String(profile.content_themes)}`);
  if (profile.key_messages) parts.push(`Key messages: ${String(profile.key_messages)}`);
  if (profile.brand_positioning) parts.push(`Brand positioning: ${String(profile.brand_positioning)}`);
  const campaignPurpose = profile.campaign_purpose_intent;
  if (campaignPurpose && typeof campaignPurpose === 'object') {
    const cp = campaignPurpose as Record<string, unknown>;
    if (cp.primary_objective) parts.push(`Primary objective: ${String(cp.primary_objective)}`);
    if (cp.campaign_intent) parts.push(`Campaign intent: ${String(cp.campaign_intent)}`);
  }
  return parts.length > 0 ? `Company context:\n${parts.join('\n')}` : '';
}

function buildSourceContext(
  label: string,
  ctx: Record<string, unknown> | null | undefined
): string {
  if (!ctx || typeof ctx !== 'object') return '';
  const parts: string[] = [];
  if (ctx.polished_title) parts.push(`Topic: ${String(ctx.polished_title)}`);
  if (ctx.title) parts.push(`Title: ${String(ctx.title)}`);
  if (ctx.summary) parts.push(`Summary: ${String(ctx.summary)}`);
  if (ctx.trend_topic) parts.push(`Trend: ${String(ctx.trend_topic)}`);
  return parts.length > 0 ? `${label}:\n${parts.join('\n')}` : '';
}

/**
 * Refine a campaign idea using AI.
 */
export async function refineCampaignIdea(input: IdeaRefinementInput): Promise<IdeaRefinementResult> {
  const ideaText = String(input.idea_text || '').trim();
  const fallbackAngle = 'PROBLEM_AWARENESS';
  if (!ideaText) {
    return {
      refined_title: '',
      refined_description: '',
      normalized_angles: [fallbackAngle],
    };
  }

  const companyContext = buildCompanyContext(input.company_profile ?? undefined);
  const recContext = buildSourceContext('Recommendation context', input.recommendation_context ?? undefined);
  const oppContext = buildSourceContext('Opportunity context', input.opportunity_context ?? undefined);
  const industryBlock = companyContext || recContext || oppContext
    ? `\n\n${[companyContext, recContext, oppContext].filter(Boolean).join('\n\n')}`
    : '';

  const systemPrompt = `You are a campaign strategist. Refine the user's raw campaign idea into a clear, actionable title and description. Suggest 3–5 campaign direction angles.

CRITICAL: You MUST output angles using ONLY these exact strings—no variations, no aliases:
EDUCATION, THOUGHT_LEADERSHIP, PROBLEM_AWARENESS, INDUSTRY_TREND, PRODUCT_POSITIONING, CASE_STUDY, COMMUNITY_ENGAGEMENT

Return JSON only with this exact shape:
{"refined_title": "string", "refined_description": "string", "suggested_angles": ["EDUCATION", "THOUGHT_LEADERSHIP", "PRODUCT_POSITIONING", ...]}`;

  const userPrompt = `Refine this campaign idea: ${ideaText}${industryBlock}`;

  const result = await runCompletionWithOperation({
    companyId: null,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    operation: 'refineCampaignIdea',
  });

  let parsed: Record<string, unknown>;
  try {
    const raw = (result.output || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    return {
      refined_title: ideaText.slice(0, 80),
      refined_description: ideaText,
      normalized_angles: [fallbackAngle],
    };
  }

  const refinedTitle = typeof parsed.refined_title === 'string' ? parsed.refined_title.trim() : ideaText.slice(0, 80);
  const refinedDescription = typeof parsed.refined_description === 'string' ? parsed.refined_description.trim() : ideaText;
  const rawAngles = Array.isArray(parsed.suggested_angles)
    ? parsed.suggested_angles.map((a) => String(a ?? '').trim()).filter(Boolean)
    : [];
  const filtered = rawAngles.length > 0 ? [...new Set(rawAngles.filter((a) => CANONICAL_SET.has(a)))] : [];
  const normalizedAngles = filtered.length > 0 ? filtered : [fallbackAngle];

  return {
    refined_title: refinedTitle || ideaText.slice(0, 80),
    refined_description: refinedDescription || ideaText,
    normalized_angles: normalizedAngles,
  };
}
