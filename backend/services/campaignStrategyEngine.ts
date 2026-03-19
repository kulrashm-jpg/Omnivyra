/**
 * Campaign Strategy Engine — Layer 2 (Single GPT Call)
 *
 * Makes EXACTLY ONE GPT call per campaign and returns a rich structured strategy
 * object. Everything downstream (calendar, posts, variants) is derived from this
 * without additional AI calls.
 *
 * Design principles:
 *  - One call, maximum output: the prompt asks for all strategic signals in one shot
 *  - Full cache integration: exact + semantic + hot-key + versioned cache_version
 *  - Cost routing: jobCostEstimator gates the call before it hits OpenAI
 *  - Graceful degradation: always returns a valid strategy (falls back to rule-based)
 *
 * Output schema (CampaignStrategy):
 *  {
 *    positioning, audience, themes[], content_angles[],
 *    tone_guidelines, cta_patterns[], platform_hints{},
 *    confidence
 *  }
 */

import { runCompletionWithOperation } from './aiGateway';
import type { IdeaSpine, StrategyContext } from '../types/campaignPlanning';
import type { AccountContext } from '../types/accountContext';
import type { MappedWeeklySkeleton } from './strategyMapper';

// ── Output schema ─────────────────────────────────────────────────────────────

export interface CampaignStrategy {
  /** High-level strategic positioning for the campaign */
  positioning: string;
  /** Refined audience description (more specific than input) */
  audience: string;
  /** 4–8 weekly themes that carry the campaign narrative */
  themes: string[];
  /** Content angles to rotate (how-to, list, case-study, announcement, question, mistake) */
  content_angles: string[];
  /** Tone and voice guidelines for all content */
  tone_guidelines: string;
  /** CTA patterns to rotate across posts */
  cta_patterns: string[];
  /** Per-platform adaptation hints */
  platform_hints: Record<string, string>;
  /** 0–1 confidence in strategy quality (drives optional refinement layer) */
  confidence: number;
}

// ── Fallback strategy (zero GPT) ─────────────────────────────────────────────

function buildFallbackStrategy(
  spine: IdeaSpine,
  ctx: StrategyContext,
  mapped: MappedWeeklySkeleton | null,
): CampaignStrategy {
  const goal = ctx.campaign_goal || 'brand awareness';
  const audience = ctx.target_audience || 'professionals';
  const platforms = ctx.platforms ?? [];

  // Pull themes from already-deterministic mapped skeleton if available
  const themes = mapped?.weekly_strategies?.slice(0, 8).map(w => w.theme) ?? [
    `Introducing ${goal} to ${audience}`,
    `Building trust with ${audience}`,
    `Demonstrating value through ${goal}`,
    `Converting ${audience} to action`,
  ];

  const platformHints: Record<string, string> = {};
  for (const p of platforms) {
    if (p === 'linkedin')   platformHints.linkedin = 'Professional tone, 1200–1800 chars, insight-led hooks';
    if (p === 'x')          platformHints.x = 'Sharp, punchy, ≤280 chars, one clear insight per tweet';
    if (p === 'instagram')  platformHints.instagram = 'Visual-first, relatable caption, 5–10 hashtags';
    if (p === 'facebook')   platformHints.facebook = 'Community tone, conversational, 400–800 chars';
  }

  return {
    positioning: `${spine.refined_title || spine.title || goal} — positioned as an authoritative resource for ${audience}`,
    audience,
    themes,
    content_angles: ['how-to', 'list', 'case-study', 'mistake', 'question'],
    tone_guidelines: 'Authoritative yet approachable. Lead with insight. End with a clear takeaway.',
    cta_patterns: [
      'Save this for later.',
      'Share with someone who needs this.',
      'What\'s your experience? Comment below.',
      'Follow for more insights.',
    ],
    platform_hints: platformHints,
    confidence: 0.55, // low confidence → triggers optional refinement for premium users
  };
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildStrategyPrompt(
  spine: IdeaSpine,
  ctx: StrategyContext,
  accountContext: AccountContext | null,
  mapped: MappedWeeklySkeleton | null,
): string {
  const maturity = accountContext?.maturityStage ?? 'GROWING';
  const platforms = ctx.platforms?.join(', ') || 'linkedin';
  const weeklyThemes = mapped?.weekly_strategies
    ?.slice(0, Math.min(8, ctx.duration_weeks))
    .map((w, i) => `Week ${w.week} [${w.funnel_stage}]: ${w.theme}`)
    .join('\n') || 'Not yet mapped';

  return `You are a senior content strategist building a ${ctx.duration_weeks}-week social media campaign.

CAMPAIGN BRIEF:
- Title: ${spine.refined_title || spine.title || 'Untitled'}
- Description: ${spine.refined_description || spine.description || 'Not provided'}
- Angle: ${spine.selected_angle || 'Not specified'}
- Goal: ${ctx.campaign_goal || 'Brand awareness'}
- Target audience: ${ctx.target_audience || 'Professionals'}
- Platforms: ${platforms}
- Posting frequency: ${JSON.stringify(ctx.posting_frequency)}
- Campaign duration: ${ctx.duration_weeks} weeks
- Account maturity: ${maturity}

ALREADY MAPPED WEEKLY THEMES (do not change these, extend/enrich them):
${weeklyThemes}

Return a single JSON object with this exact schema:
{
  "positioning": "string — high-level strategic positioning (1-2 sentences)",
  "audience": "string — refined audience description with psychographic detail",
  "themes": ["string", ...] — exactly ${Math.min(ctx.duration_weeks, 8)} themes matching the weekly plan above,
  "content_angles": ["string", ...] — 5-7 content angles to rotate (use: how-to, list, case-study, announcement, question, mistake, trend),
  "tone_guidelines": "string — tone and voice guidelines (2-3 sentences)",
  "cta_patterns": ["string", ...] — 4-6 CTA phrases to rotate across posts,
  "platform_hints": {
    ${ctx.platforms?.map(p => `"${p}": "string — adaptation guidance for ${p}"`).join(',\n    ') || '"linkedin": "..."'}
  },
  "confidence": number between 0 and 1
}

Rules:
- themes[] must have exactly ${Math.min(ctx.duration_weeks, 8)} items
- content_angles[] must include at least: how-to, list, case-study
- cta_patterns[] must be copy-ready phrases (not descriptions)
- platform_hints must cover all platforms: ${platforms}
- confidence: 0.9+ if goal/audience are specific; lower if vague
- Return ONLY the JSON object, no other text`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a campaign strategy using ONE GPT call.
 * Results are cached by (companyId + campaign fingerprint + updated_at).
 *
 * @param companyId      - Organization ID
 * @param campaignId     - Campaign ID (for logging)
 * @param spine          - Campaign idea / title / angle
 * @param ctx            - Strategy parameters (duration, platforms, frequency)
 * @param accountContext - Account maturity and platform metrics
 * @param mapped         - Already-deterministic weekly skeleton + themes
 * @param cacheVersion   - campaign.updated_at (busts stale strategy cache)
 * @returns CampaignStrategy — falls back to rule-based if GPT fails
 */
export async function generateCampaignStrategy(
  companyId: string,
  campaignId: string | null,
  spine: IdeaSpine,
  ctx: StrategyContext,
  accountContext: AccountContext | null,
  mapped: MappedWeeklySkeleton | null,
  cacheVersion?: string | null,
): Promise<CampaignStrategy> {
  const systemPrompt = buildStrategyPrompt(spine, ctx, accountContext, mapped);

  // Compact user payload — only the variable parts (not the full context which is in system)
  const userPayload = JSON.stringify({
    goal: ctx.campaign_goal,
    audience: ctx.target_audience,
    aspects: ctx.selected_aspects,
    offerings: ctx.selected_offerings,
  });

  let raw = '';
  try {
    const result = await runCompletionWithOperation({
      companyId,
      campaignId,
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.2,   // slight creativity, mostly deterministic
      response_format: { type: 'json_object' },
      operation: 'generateCampaignPlan',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPayload },
      ],
      cache_version: cacheVersion ?? null,
    });
    raw = typeof result?.output === 'string' ? result.output : '';
  } catch (err) {
    console.warn('[campaign-strategy] GPT call failed, using fallback:', (err as Error).message);
    return buildFallbackStrategy(spine, ctx, mapped);
  }

  // Parse
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: Partial<CampaignStrategy> = {};
  try {
    parsed = JSON.parse(trimmed || '{}');
  } catch {
    console.warn('[campaign-strategy] JSON parse failed, using fallback');
    return buildFallbackStrategy(spine, ctx, mapped);
  }

  // Validate + hydrate missing fields from fallback
  const fallback = buildFallbackStrategy(spine, ctx, mapped);
  const strategy: CampaignStrategy = {
    positioning:     typeof parsed.positioning === 'string' && parsed.positioning ? parsed.positioning : fallback.positioning,
    audience:        typeof parsed.audience === 'string' && parsed.audience       ? parsed.audience     : fallback.audience,
    themes:          Array.isArray(parsed.themes) && parsed.themes.length > 0     ? parsed.themes       : fallback.themes,
    content_angles:  Array.isArray(parsed.content_angles) && parsed.content_angles.length > 0 ? parsed.content_angles : fallback.content_angles,
    tone_guidelines: typeof parsed.tone_guidelines === 'string' && parsed.tone_guidelines ? parsed.tone_guidelines : fallback.tone_guidelines,
    cta_patterns:    Array.isArray(parsed.cta_patterns) && parsed.cta_patterns.length > 0   ? parsed.cta_patterns   : fallback.cta_patterns,
    platform_hints:  parsed.platform_hints && typeof parsed.platform_hints === 'object'      ? (parsed.platform_hints as Record<string, string>) : fallback.platform_hints,
    confidence:      typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.75,
  };

  return strategy;
}
