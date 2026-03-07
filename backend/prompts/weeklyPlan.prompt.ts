/**
 * Weekly Plan prompt builder.
 * Produces the campaign-context block injected into the full weekly plan prompt.
 * Ensures weekly planning is theme-anchored, objective-driven, and historically informed.
 */

import type { CampaignContext } from '../services/contextCompressionService';
import { compilePrompt, buildCampaignContextBlock } from './promptCompiler';

export const WEEKLY_PLAN_PROMPT_VERSION = 2;

function buildStrategicThemeMappingBlock(context: CampaignContext): string {
  const themes = context.strategic_themes ?? context.themes;
  const duration = context.campaign_duration_weeks ?? 12;
  if (!themes?.length) return '';

  return `
STRATEGIC THEME MAPPING (REQUIRED)
Before generating the weekly plan, assign each campaign week to a strategic theme from this progression:
${themes.map((t, i) => `  - ${t}`).join('\n')}

Example progression for ${duration} weeks:
${themes.slice(0, 4).map((t, i) => `  Week ${i + 1} → ${t}`).join('\n')}
${duration > themes.length
  ? `  If campaign_duration (${duration}) > theme_count (${themes.length}), cycle or deepen the themes logically (e.g. Week 5 → ${themes[0]} (deepen), Week 6 → ${themes[1] ?? themes[0]} (deepen)).`
  : ''}

You MUST map weeks to themes before generating content. Do not generate random topics; anchor each week to its assigned theme.`;
}

function buildStrategyLearningBlock(context: CampaignContext): string {
  const slp = context.strategy_learning_profile;
  if (!slp) return '';

  const lines: string[] = [];
  if (slp.high_performing_formats?.length) {
    lines.push(`- High-performing formats: ${slp.high_performing_formats.join(', ')}`);
  }
  if (slp.high_performing_topics?.length) {
    lines.push(`- High-performing topics: ${slp.high_performing_topics.join(', ')}`);
  }
  if (slp.weak_formats?.length) {
    lines.push(`- Weak formats (use sparingly): ${slp.weak_formats.join(', ')}`);
  }
  if (slp.historical_engagement_patterns && Object.keys(slp.historical_engagement_patterns).length > 0) {
    const sorted = Object.entries(slp.historical_engagement_patterns)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${(v * 100).toFixed(0)}%`)
      .join(', ');
    lines.push(`- Platform engagement: ${sorted}`);
  }
  if (lines.length === 0) return '';

  return `
STRATEGY LEARNING PROFILE (use as optimization guidance; do NOT override strategic theme progression)
${lines.join('\n')}

Use historical performance signals to inform format selection and platform emphasis within each week's theme. The strategic theme progression takes precedence.`;
}

function buildPlatformGuidanceBlock(): string {
  return `
PLATFORM BEHAVIOR GUIDANCE (match platform choice to content purpose)
When recommending formats for each week, choose formats that align with the strengths of the selected primary platform.

LinkedIn: Best for professional insights and thought leadership.
Typical formats:
- text posts
- document/carousel posts
- industry insights
- short native videos

Instagram: Best for visual storytelling and quick educational content.
Typical formats:
- reels
- carousels
- visual explainers
- short videos

X (Twitter): Best for commentary and real-time insights.
Typical formats:
- threads
- quick takes
- polls
- commentary posts

YouTube: Best for deep dives and long-form educational content.
Typical formats:
- tutorials
- deep-dive videos
- explainers
- interviews

Use this guidance to decide which platforms should carry primary content vs. support amplification for each week.`;
}

function buildCampaignNarrativeGuidanceBlock(context: CampaignContext): string {
  const duration = context.campaign_duration_weeks ?? 12;
  const goal = context.campaign_goal?.trim();
  const audience = context.target_audience?.trim();
  const depth = context.content_depth?.trim();

  const adaptLines: string[] = [];
  if (goal) adaptLines.push(`• campaign_goal: ${goal}`);
  if (audience) adaptLines.push(`• target_audience: ${audience}`);
  if (depth) adaptLines.push(`• content_depth: ${depth}`);
  if (duration) adaptLines.push(`• campaign_duration_weeks: ${duration}`);
  const adaptBlock = adaptLines.length > 0
    ? `\nAdapt the progression based on:\n${adaptLines.join('\n')}`
    : '';

  const durationNote =
    duration === 1
      ? `For this 1-week campaign, combine awareness and conversion in a single focused week.`
      : duration <= 4
        ? `For this ${duration}-week campaign, compress the stages proportionally (e.g. Week 1: Awareness, Week 2: Insight, Week 3: Authority, Week 4: Engagement/Conversion).`
        : duration <= 8
        ? `For this ${duration}-week campaign, allocate roughly 2 weeks per stage, expanding or overlapping as needed.`
        : `For this ${duration}-week campaign, you may expand stages with 2–3 weeks each, or add sub-stages within Authority and Engagement.`;

  return `
CAMPAIGN NARRATIVE PROGRESSION GUIDANCE (REQUIRED)
When planning multi-week campaigns, ensure the campaign evolves strategically over time. Each week's objective should build upon the previous weeks rather than being independent.

Typical progression example:
Week 1–2: Awareness
• introduce the core problem
• highlight industry context
• frame the opportunity

Week 3–4: Insight and education
• deeper explanations
• frameworks or concepts
• thought leadership

Week 5–6: Authority and validation
• case studies
• real examples
• expert insights

Week 7–8+: Engagement and conversion
• interactive content
• actionable advice
• calls to action

Early weeks introduce ideas; middle weeks deepen understanding; later weeks encourage action.
${durationNote}
${adaptBlock}

Historical performance signals should guide optimization but should not override the strategic narrative progression.`;
}

function buildStructuredReasoningBlock(): string {
  return `
STRUCTURED REASONING (for each week, determine before writing content)
Step 1 — Platform strategy: For each campaign week, determine the platform strategy based on the campaign objective and the platforms available to the company. Decide which platform should carry the primary content and which should support amplification. Consider platform strengths (see Platform Guidance below).
Step 2 — Content plan:
- theme_for_week: the strategic theme from the progression
- weekly_objective: one sentence goal aligned to that theme
- primary_content_focus: main angle or topic for the week
- supporting_formats: content types that support the objective (draw from high-performing formats when available)`;
}

function buildOutputStructureBlock(): string {
  return `
OUTPUT STRUCTURE (each week must include strategic_theme and platform mapping)
Each week object must include:
{
  week: number,
  strategic_theme: string,
  objective: string,
  primary_platform: string,
  supporting_platforms: string[],
  content_focus: string,
  recommended_formats: string[],
  phase_label: string,
  primary_objective: string,
  platform_allocation: Record<string, number>,
  content_type_mix: string[]
}

primary_platform: The main platform for the week's content.
supporting_platforms: Platforms used for amplification or repurposing.
content_focus: Main angle or topic for the week.
recommended_formats: Content types that support the objective.
phase_label: Same as strategic_theme (required for system).
primary_objective: Same as objective (required for system).
platform_allocation: Map each platform to post count, e.g. { linkedin: 3, x: 2 }. Give primary_platform the highest count; supporting_platforms get lesser counts.
content_type_mix: Same as recommended_formats (required for system).`;
}

function buildEligiblePlatformsInstruction(context: CampaignContext): string {
  if (!context.eligible_platforms?.length) return '';
  return `\nOnly choose platforms from the eligible platforms list in the context above. Do not add platforms the company does not use.`;
}

function buildCampaignObjectiveGuidanceBlock(context: CampaignContext): string {
  const targetAudience = context.target_audience?.trim();
  const contentDepth = context.content_depth?.trim();
  const campaignGoal = context.campaign_goal?.trim();
  if (!targetAudience && !contentDepth && !campaignGoal) return '';

  const lines: string[] = [];
  if (targetAudience) lines.push(`* Target audience: ${targetAudience}`);
  if (contentDepth) lines.push(`* Content depth: ${contentDepth}`);
  if (campaignGoal) lines.push(`* Campaign goal: ${campaignGoal}`);

  return `

CAMPAIGN OBJECTIVE GUIDANCE (use these to shape weekly objectives, tone, and format choices):
${lines.join('\n')}

Use these inputs to guide: weekly objectives, tone and messaging, content format selection, and depth of explanation. Align each week's content_focus to the target audience and campaign goal. Match content_depth to format choices (e.g. shallow → quick posts, deep → articles, tutorials).`;
}

export function buildWeeklyPlanPrompt(context: CampaignContext): string {
  const baseContext = buildCampaignContextBlock(context);
  const strategicThemeBlock = buildStrategicThemeMappingBlock(context);
  const strategyLearningBlock = buildStrategyLearningBlock(context);
  const platformGuidanceBlock = buildPlatformGuidanceBlock();
  const campaignObjectiveBlock = buildCampaignObjectiveGuidanceBlock(context);
  const narrativeGuidanceBlock = buildCampaignNarrativeGuidanceBlock(context);
  const reasoningBlock = buildStructuredReasoningBlock();
  const outputBlock = buildOutputStructureBlock();
  const eligibleInstruction = buildEligiblePlatformsInstruction(context);

  const contextBlock = [
    baseContext,
    strategicThemeBlock,
    strategyLearningBlock,
    platformGuidanceBlock,
    campaignObjectiveBlock,
  ]
    .filter(Boolean)
    .join('\n');

  const task = [
    'Use the context above to guide weekly theme alignment, platform strategy, and content-type distribution. Do not override trend intelligence.',
    narrativeGuidanceBlock,
    reasoningBlock,
    outputBlock,
    'Prefer platforms and content formats that historically perform well (see Strategy Learning Profile), but maintain strategic theme progression.',
    'Ensure the weekly plan is theme-anchored, objective-driven, platform-aware, and historically informed. Not random topic generation.',
    eligibleInstruction,
  ]
    .filter(Boolean)
    .join('\n');

  return compilePrompt({
    system:
      'You are an expert marketing strategist creating a structured weekly campaign plan that follows a strategic theme progression and explicitly assigns platforms to each week.',
    context: contextBlock,
    task,
  });
}
