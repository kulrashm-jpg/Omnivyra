import { supabase } from '../db/supabaseClient';
import { generateCampaignPlan } from './aiGateway';
import { assessVirality } from './viralityAdvisorService';
import { buildCampaignSnapshotWithHash, canonicalJsonStringify } from './viralitySnapshotBuilder';
import { buildDecideRequest, requestDecision, DecisionResult } from './omnivyreClient';
import { parseAiPlanToWeeks, parseAiRefinedDay, parseAiPlatformCustomization } from './campaignPlanParser';
import { getPlatformStrategies } from './externalApiService';
import { saveStructuredCampaignPlan, saveStructuredCampaignPlanDayUpdate, savePlatformCustomizedContent } from '../db/campaignPlanStore';
import { getLatestCampaignVersionByCampaignId } from '../db/campaignVersionStore';
import { getLatestSnapshotsPerPlatform } from '../db/platformMetricsSnapshotStore';
import { getProfile } from './companyProfileService';
import { getPrimaryCampaignType, BACKWARD_COMPAT_DEFAULTS } from './campaignContextConfig';
import { computeExpectedBaseline, classifyBaseline } from './baselineClassificationService';

export type CampaignAiMode = 'generate_plan' | 'refine_day' | 'platform_customize';

export interface RecommendationContext {
  target_regions?: string[] | null;
  context_payload?: Record<string, unknown> | null;
  source_opportunity_id?: string | null;
}

export interface ConversationMessage {
  type: 'user' | 'ai';
  message: string;
}

export interface CampaignAiPlanInput {
  campaignId: string;
  mode: CampaignAiMode;
  message: string;
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
  conversationHistory?: ConversationMessage[];
  recommendationContext?: RecommendationContext | null;
}

export interface CampaignAiPlanResult {
  mode: CampaignAiMode;
  snapshot_hash: string;
  omnivyre_decision: DecisionResult;
  plan?: {
    weeks: Array<{
      week: number;
      theme: string;
      daily: Array<{
        day: string;
        objective: string;
        content: string;
        platforms: Record<string, string>;
        hashtags?: string[];
        seo_keywords?: string[];
        meta_title?: string;
        meta_description?: string;
        hook?: string;
        cta?: string;
        best_time?: string;
        effort_score?: number;
        success_projection?: number;
      }>;
    }>;
  };
  day?: {
    week: number;
    day: string;
    objective: string;
    content: string;
    platforms: Record<string, string>;
    hashtags?: string[];
    seo_keywords?: string[];
    meta_title?: string;
    meta_description?: string;
    hook?: string;
    cta?: string;
    best_time?: string;
    effort_score?: number;
    success_projection?: number;
  };
  platform_content?: {
    day: string;
    platforms: Record<string, string>;
  };
  conversationalResponse?: string;
  raw_plan_text: string;
}

const GATHER_ORDER = [
  { key: 'target_audience', question: 'Who is your primary target audience? (e.g., professionals, entrepreneurs, parents, educators)' },
  { key: 'platforms', question: 'Which platforms will you focus on? (e.g., LinkedIn, Instagram, Twitter, YouTube, Facebook, TikTok)' },
  { key: 'key_messages', question: 'What are your key messages or pain points to address in this campaign?' },
  { key: 'success_metrics', question: 'What success metrics do you want to track? (e.g., engagement rate, reach, conversions, leads)' },
];

/** Campaign type → preferred platform (normalized) for dominant platform selection */
const PRIMARY_TYPE_PLATFORM_PREFERENCE: Record<string, string[]> = {
  lead_generation: ['linkedin'],
  authority_positioning: ['linkedin'],
  network_expansion: ['linkedin', 'facebook'],
  engagement_growth: ['instagram', 'tiktok'],
  product_promotion: ['instagram', 'linkedin'],
  brand_awareness: [], // broad; use first available or highest
};

export interface BaselineContext {
  stage: string;
  scope: string;
  expectedBaseline: number;
  actualFollowers: number;
  ratio: number;
  status: 'underdeveloped' | 'aligned' | 'strong';
  primaryPlatform: string;
}

export type BaselineContextResult = BaselineContext | { unavailable: true };

async function resolveBaselineContext(input: {
  companyId: string;
  companyStage: string | null;
  marketScope: string | null;
  baselineOverride: Record<string, unknown> | null;
  primaryType: string;
  platformStrategies: { name: string }[];
}): Promise<BaselineContextResult> {
  const stage = input.companyStage ?? 'early_stage';
  const scope = input.marketScope ?? 'niche';
  const expectedBaseline = computeExpectedBaseline(stage, scope);

  if (input.baselineOverride && typeof input.baselineOverride === 'object') {
    const override = input.baselineOverride as { platform?: string; followers?: number };
    const actualFollowers = Math.max(0, Number(override.followers) ?? 0);
    const platform = String(override.platform || 'unknown');
    const classification = classifyBaseline(actualFollowers, expectedBaseline);
    return {
      stage,
      scope,
      expectedBaseline,
      actualFollowers,
      ratio: classification.ratio,
      status: classification.status,
      primaryPlatform: platform,
    };
  }

  const snapshots = await getLatestSnapshotsPerPlatform(input.companyId);
  if (snapshots.length === 0) {
    return { unavailable: true };
  }

  const pref = PRIMARY_TYPE_PLATFORM_PREFERENCE[input.primaryType] ?? [];
  const byPlatform = new Map(snapshots.map((s) => [s.platform.toLowerCase(), s]));
  const alias = (p: string) => (p === 'x' ? 'twitter' : p);
  const strategyNames = (input.platformStrategies || []).map((p) => {
    const n = String(p.name || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/^\s+|\s+$/g, '');
    return alias(n);
  });

  let chosen: { platform: string; followers: number } | null = null;
  for (const p of pref) {
    const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
    if (snap) {
      chosen = { platform: snap.platform, followers: snap.followers };
      break;
    }
  }
  if (!chosen) {
    for (const p of strategyNames) {
      const snap = byPlatform.get(p) ?? byPlatform.get(p.replace(' ', ''));
      if (snap) {
        chosen = { platform: snap.platform, followers: snap.followers };
        break;
      }
    }
  }
  if (!chosen) {
    const highest = snapshots.reduce((a, b) => (a.followers >= b.followers ? a : b));
    chosen = { platform: highest.platform, followers: highest.followers };
  }

  const classification = classifyBaseline(chosen.followers, expectedBaseline);
  return {
    stage,
    scope,
    expectedBaseline,
    actualFollowers: chosen.followers,
    ratio: classification.ratio,
    status: classification.status,
    primaryPlatform: chosen.platform,
  };
}

function buildCompanyContextBlock(
  profile: any,
  buildMode: string,
  contextScope: string[] | null
): string | null {
  if (!profile) return null;
  if (buildMode === 'no_context') return null;

  const sections: string[] = [];

  if (buildMode === 'full_context') {
    sections.push('commercial_strategy', 'marketing_intelligence', 'campaign_purpose', 'brand_positioning', 'competitive_advantages', 'growth_priorities');
  } else if (buildMode === 'focused_context' && contextScope && contextScope.length > 0) {
    sections.push(...contextScope);
  } else {
    return null;
  }

  const parts: string[] = [];
  const commercialFields = ['target_customer_segment', 'ideal_customer_profile', 'pricing_model', 'sales_motion', 'avg_deal_size', 'sales_cycle', 'key_metrics'];
  const marketingFields = ['marketing_channels', 'content_strategy', 'campaign_focus', 'key_messages', 'brand_positioning', 'competitive_advantages', 'growth_priorities'];

  if (sections.includes('commercial_strategy')) {
    const commercial = commercialFields
      .map((f) => (profile[f] ? `${f}: ${profile[f]}` : null))
      .filter(Boolean);
    if (commercial.length) parts.push(`Commercial Strategy:\n${commercial.join('\n')}`);
  }
  if (sections.includes('marketing_intelligence')) {
    const marketing = marketingFields
      .map((f) => (profile[f] ? `${f}: ${profile[f]}` : null))
      .filter(Boolean);
    if (marketing.length) parts.push(`Marketing Intelligence:\n${marketing.join('\n')}`);
  }
  if (sections.includes('campaign_purpose') && profile.campaign_purpose_intent) {
    parts.push(`Campaign Purpose:\n${JSON.stringify(profile.campaign_purpose_intent)}`);
  }
  if (sections.includes('brand_positioning') && profile.brand_positioning) {
    parts.push(`Brand Positioning: ${profile.brand_positioning}`);
  }
  if (sections.includes('competitive_advantages') && profile.competitive_advantages) {
    parts.push(`Competitive Advantages: ${profile.competitive_advantages}`);
  }
  if (sections.includes('growth_priorities') && profile.growth_priorities) {
    parts.push(`Growth Priorities: ${profile.growth_priorities}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function buildPromptContext(input: {
  message: string;
  mode: CampaignAiMode;
  durationWeeks?: number;
  targetDay?: string;
  platforms?: string[];
  snapshotHash: string;
  snapshot: any;
  diagnostics: any;
  omnivyreDecision?: DecisionResult;
  platformStrategies: any;
  conversationHistory?: Array<{ type: string; message: string }>;
  recommendationContext?: { target_regions?: string[] | null; context_payload?: Record<string, unknown> | null } | null;
  companyContext?: string | null;
  campaignIntentSummary?: {
    types: string[];
    weights: Record<string, number>;
    primary_type: string;
  } | null;
  baselineContext?: BaselineContextResult;
}): { system: string; user: string; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> } {
  const diagnosticsWithBaseline = { ...input.diagnostics };
  if (input.baselineContext && !('unavailable' in input.baselineContext)) {
    (diagnosticsWithBaseline as any).baseline = {
      expectedBaseline: input.baselineContext.expectedBaseline,
      actualFollowers: input.baselineContext.actualFollowers,
      ratio: input.baselineContext.ratio,
      status: input.baselineContext.status,
    };
  }

  const durationWeeks = input.durationWeeks ?? 12;

  const userPayload: Record<string, unknown> = {
    mode: input.mode,
    snapshot_hash: input.snapshotHash,
    message: input.message,
    durationWeeks,
    targetDay: input.targetDay,
    platforms: input.platforms,
    snapshot: input.snapshot,
    diagnostics: diagnosticsWithBaseline,
    omnivyre_decision: input.omnivyreDecision || null,
    platform_strategies: input.platformStrategies,
    recommendation_context: input.recommendationContext || null,
  };
  if (input.companyContext) {
    userPayload.company_context = input.companyContext;
  }
  if (input.campaignIntentSummary) {
    userPayload.campaign_intent_summary = input.campaignIntentSummary;
  }

  const modeHint =
    input.mode === 'platform_customize'
      ? '\nFocus only on the target day and provide platform-specific variants for the requested platforms.\n'
      : input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0
      ? `
ONE-BY-ONE QUESTIONING MODE (generate_plan with conversation):

You are building a ${durationWeeks}-week campaign plan through conversation. You MUST gather details first, then generate the plan ONLY when the user explicitly asks for it or when you have all required info.

REQUIRED INFO TO GATHER (in order, one question at a time):
1. target_audience — Who is your primary target audience?
2. platforms — Which platforms will you focus on?
3. key_messages — What are your key messages or pain points to address?
4. success_metrics — What success metrics do you want to track?

CRITICAL RULES:
- After EACH user answer, reply with ONLY the next question. Be conversational and warm. Do NOT generate the plan yet.
- ONLY output BEGIN_12WEEK_PLAN ... END_12WEEK_PLAN when BOTH are true:
  (a) The user has answered ALL 4 questions above, AND
  (b) The user explicitly says to create/generate the plan (e.g. "create my plan", "generate plan", "I'm ready", "that's all", "go ahead", "create campaign", "build the plan").
- If the user has not answered all 4 questions, NEVER generate the plan — ask the next question instead.
- If the user answered all 4 but has NOT said to create the plan, ask: "I have everything I need. Would you like me to create your ${durationWeeks}-week plan now?"
- Use the recommendation context (target_regions, context_payload) and all previous answers to inform the plan when you eventually generate it.
`
      : '\n';

  const CAMPAIGN_TYPE_BEHAVIORAL_GUIDELINES = `
CAMPAIGN TYPE BEHAVIORAL GUIDELINES

When allocating strategic emphasis, use the following operational interpretations:

brand_awareness:
  Focus: Reach expansion, visibility, repetition.
  CTA Style: Soft (follow, subscribe, share).
  Phase Logic: Strong top-of-funnel early; minimal hard conversion push.
  Content Mix: Educational, storytelling, value-first.
  Platform Emphasis: Broad distribution across all available channels.

lead_generation:
  Focus: Direct response, measurable conversion.
  CTA Style: Direct (book session, sign up, download).
  Phase Logic: Conversion push introduced by Week 2-3.
  Content Mix: Problem-solution framing, proof, testimonials, gated value.
  Platform Emphasis: Platforms with conversion mechanisms (e.g., LinkedIn, landing pages).

authority_positioning:
  Focus: Thought leadership and expertise elevation.
  CTA Style: Light, credibility-based.
  Phase Logic: Framework-driven content; credibility build before any direct selling.
  Content Mix: Opinion pieces, deep dives, proprietary frameworks.
  Platform Emphasis: Professional networks (e.g., LinkedIn, long-form blog).

network_expansion:
  Focus: Relationship building and engagement triggers.
  CTA Style: Engagement prompts (comment, connect, DM).
  Phase Logic: Interaction-first weeks; growth through conversation.
  Content Mix: Polls, questions, discussion starters, community themes.
  Platform Emphasis: Network-driven platforms (LinkedIn, Facebook).

engagement_growth:
  Focus: Interaction depth and audience participation.
  CTA Style: React, comment, vote, respond.
  Phase Logic: Weekly engagement spikes built into structure.
  Content Mix: Interactive content, response-driven threads.
  Platform Emphasis: Platforms with high engagement loops.

product_promotion:
  Focus: Offer visibility and urgency.
  CTA Style: Direct promotional push.
  Phase Logic: Strong mid-to-late campaign offer amplification.
  Content Mix: Benefits, demos, testimonials, comparison posts.
  Platform Emphasis: Conversion-supportive platforms.
`;

  const WEIGHT_ALLOCATION_RULE = `
WEIGHT ALLOCATION RULE:

The highest-weight campaign type must dominate phase sequencing and CTA intensity.
Secondary types should influence supporting content mix but must not override primary structural direction.
`;

  const PHASE_TYPE_INFLUENCE_RULE = `
PHASE-TYPE INFLUENCE RULE:

When a campaign type exceeds 50% weight, structure the overall phase arc around that type's natural behavioral flow.

Examples:
- Lead-heavy → introduce conversion by Week 2-3.
- Authority-heavy → spend first 4 weeks building credibility.
- Network-heavy → begin with engagement activation.

No math. Just structural dominance.
`;

  const PLATFORM_EMPHASIS_HINT = `
PLATFORM EMPHASIS:

Platform prioritization must align with the dominant campaign type's behavioral focus.
`;

  const WEEKLY_BLUEPRINT_OUTPUT_CONTRACT = `
WEEKLY BLUEPRINT OUTPUT CONTRACT (MANDATORY FORMAT)

Generate exactly ${durationWeeks} weeks. This campaign duration is fixed. Do not generate more or fewer weeks.
Each week must follow the structure below.
A week is NOT a theme. A week is an executable content production blueprint.

Phase pacing must scale proportionally to duration. Short campaigns must compress authority and conversion arcs. Long campaigns may expand.

For each week, provide:

1. Week Number
   Example: Week 1

2. Phase Label
   Must be exactly one of:
   - Audience Activation
   - Trust Building
   - Authority Build
   - Engagement Activation
   - Conversion Ramp
   - Conversion Acceleration
   - Conversion Optimization
   - Retention & Reinforcement

   Phase label must reflect weighted campaign intent and baseline conditioning.

3. Primary Strategic Objective (1–2 sentences maximum)
   Clear, outcome-oriented statement. No storytelling.

4. Platform Allocation (with explicit frequency per platform)
   Format exactly like:
   - LinkedIn: X posts
   - Facebook: X posts
   - Instagram: X posts
   - YouTube: X videos
   - Blog: X articles

   Rules: Use only relevant platforms. Provide numeric counts. No vague phrases like "multiple posts". Must reflect campaign type weighting. Must align with baseline context.

5. Content Type Mix
   Explicit breakdown of content types. Example format:
   - 1 authority post
   - 1 educational post
   - 1 testimonial post
   - 1 engagement poll
   - 1 short-form video
   - 1 long-form article

   Rules: Must match platform allocation. Must be realistic. Must reflect campaign weighting.

6. CTA Type for the Week
   Must be exactly one of: None | Soft CTA | Engagement CTA | Authority CTA | Direct Conversion CTA

   Rules: Must align with baseline conditioning. Must align with weighted campaign type.

7. Total Weekly Content Count
   Must equal sum of all platform allocation.

8. Weekly KPI Focus
   Choose exactly one: Reach growth | Engagement rate | Follower growth | Leads generated | Bookings

   Must reflect dominant campaign type and baseline context.

BEHAVIORAL ENFORCEMENT RULES

Baseline Enforcement:
- If baseline_status = underdeveloped:
  - Week 1 Phase Label MUST be: Audience Activation OR Trust Building
  - Week 1 CTA Type MUST NOT be Direct Conversion CTA
  - Week 1 KPI Focus MUST be: Reach growth OR Follower growth
- If baseline_status = strong AND dominant type includes lead_generation:
  - Week 1 Phase Label MUST be: Conversion Acceleration (NOT Audience Activation or Trust Building)
  - Week 1 CTA Type MUST be: Direct Conversion CTA
  - Week 1 KPI Focus MUST be: Leads generated OR Bookings
  - Week 1 must NOT be awareness-only

Baseline conditioning modulates pacing and CTA intensity. It does NOT override weighted doctrine.

Weighted Doctrine Enforcement:
- The highest-weight campaign type drives phase sequencing.
- Secondary types influence content mix only.
- Platform allocation must reflect dominant objective.

Format Enforcement:
- No narrative paragraphs.
- No theme-only weeks.
- All 8 sections required per week.
- All weeks must follow identical structure.
`;

  const BASELINE_REALITY_CONTEXT_UNAVAILABLE = `
BASELINE REALITY CONTEXT

Baseline data unavailable. Assume aligned baseline.
`;

  const buildBaselineRealityBlock = (b: BaselineContext): string => `
BASELINE REALITY CONTEXT

Company Stage: ${b.stage}
Market Scope: ${b.scope}
Expected Baseline Lower Bound: ${b.expectedBaseline}
Actual Followers (Primary Platform): ${b.actualFollowers}
Baseline Ratio: ${b.ratio.toFixed(3)}
Baseline Status: ${b.status}

Instruction:
${b.status === 'underdeveloped'
  ? `- Strengthen awareness and audience-building first. Do NOT go hard conversion in Week 1.
- Delay aggressive conversion intensity — but maintain structural alignment with lead objective. Do not abandon lead intent; pace the conversion push to Week 2-3 or later.
- Explicitly include an awareness/activation phase before the conversion ramp.`
  : b.status === 'aligned'
  ? `- Follow weighted objective doctrine normally.`
  : `- Accelerate conversion pacing; introduce direct CTA in Week 1-2.
- Less awareness ramp-up; strong CTA pacing from the start.`}

Do NOT override weighted doctrine. Baseline conditioning only modulates pacing, phase arc, and CTA timing — not the dominant campaign type.
`;

  let baselineBlock = '';
  if (input.baselineContext && !('unavailable' in input.baselineContext)) {
    baselineBlock = buildBaselineRealityBlock(input.baselineContext);
  } else if (input.baselineContext && 'unavailable' in input.baselineContext) {
    baselineBlock = BASELINE_REALITY_CONTEXT_UNAVAILABLE;
  }

  let weightedInstruction = '';
  if (input.campaignIntentSummary && input.campaignIntentSummary.types.length > 0) {
    const lines = input.campaignIntentSummary.types.map(
      (t) => `- ${t.replace(/_/g, ' ')}: ${input.campaignIntentSummary!.weights[t] ?? 0}%`
    );
    weightedInstruction =
      '\n\nWEIGHTED CAMPAIGN OBJECTIVES:\n' +
      'The campaign has the following weighted objectives:\n' +
      lines.join('\n') +
      '\n' +
      CAMPAIGN_TYPE_BEHAVIORAL_GUIDELINES +
      WEIGHT_ALLOCATION_RULE +
      PHASE_TYPE_INFLUENCE_RULE +
      PLATFORM_EMPHASIS_HINT +
      '\n';
  }

  const weeklyBlueprintBlock =
    input.mode === 'generate_plan'
      ? '\n\n' + WEEKLY_BLUEPRINT_OUTPUT_CONTRACT + '\n'
      : '';

  const baseUser =
    'You are a campaign planning assistant.\n' +
    'You MUST only use platforms and content types provided in platform_strategies.\n' +
    'Do not invent platforms or content formats.\n' +
    (input.companyContext ? '\nUse the provided company_context to align the plan with company strategy.\n' : '') +
    (input.mode === 'generate_plan' && !input.conversationHistory?.length
      ? 'Return a detailed FREE-FORM TEXT campaign plan only.\n'
      : input.mode === 'generate_plan'
      ? 'Follow the ONE-BY-ONE QUESTIONING rules above.\n'
      : 'Return a detailed FREE-FORM TEXT campaign plan only.\n') +
    'Output structure:\n' +
    `- Overall strategy (brief, operational)\n` +
    `- Exactly ${durationWeeks} weeks, each as an executable blueprint per WEEKLY BLUEPRINT OUTPUT CONTRACT below\n` +
    '- Daily content ideas derived from each week blueprint\n' +
    '- Platform-specific customization where applicable\n' +
    'Do NOT use narrative themes, storytelling, or high-level descriptions only. Do NOT return JSON. Do NOT wrap in code blocks.\n' +
    weightedInstruction +
    weeklyBlueprintBlock +
    (baselineBlock ? '\n' + baselineBlock + '\n' : '') +
    modeHint +
    `Input JSON:\n${canonicalJsonStringify(userPayload)}`;

  const hasHistory = input.conversationHistory && input.conversationHistory.length > 0;
  if (hasHistory && input.mode === 'generate_plan') {
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = input.conversationHistory.map(
      (m) => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.message })
    );
    return {
      system: 'You are a campaign planning assistant. Ask one question at a time. Do NOT generate the plan until the user has answered all 4 questions (target audience, platforms, key messages, success metrics) AND the user explicitly asks you to create the plan.',
      user: baseUser,
      messages: [
        { role: 'system', content: `Ask one question at a time. Only generate the ${durationWeeks}-week plan when: (1) user has answered all 4 questions, AND (2) user says to create/generate the plan. For questions, reply naturally. For the plan, wrap with BEGIN_12WEEK_PLAN and END_12WEEK_PLAN.` },
        ...conversationMessages.slice(-14),
        { role: 'user', content: baseUser },
      ],
    };
  }

  return {
    system: 'You are a campaign planning assistant.',
    user: baseUser,
    messages: [
      { role: 'system', content: 'You are a campaign planning assistant.' },
      { role: 'user', content: baseUser },
    ],
  };
}

const DEFAULT_PLATFORM_STRATEGIES = [
  { platform_type: 'social', supported_content_types: ['post', 'story', 'video'], name: 'LinkedIn' },
  { platform_type: 'social', supported_content_types: ['post', 'story', 'reel'], name: 'Instagram' },
  { platform_type: 'social', supported_content_types: ['post', 'thread'], name: 'X (Twitter)' },
  { platform_type: 'social', supported_content_types: ['video', 'short'], name: 'YouTube' },
  { platform_type: 'social', supported_content_types: ['post', 'video'], name: 'Facebook' },
  { platform_type: 'social', supported_content_types: ['video', 'post'], name: 'TikTok' },
];

async function runWithContext(
  input: CampaignAiPlanInput,
  ctx: {
    snapshot: any;
    snapshot_hash: string;
    diagnostics: any;
    omnivyreDecision: DecisionResult;
    platformStrategies: any[];
    companyContext?: string | null;
    campaignIntentSummary?: {
      types: string[];
      weights: Record<string, number>;
      primary_type: string;
    } | null;
    baselineContext?: BaselineContextResult;
  }
): Promise<CampaignAiPlanResult> {
  const prompt = buildPromptContext({
    message: input.message,
    mode: input.mode,
    durationWeeks: input.durationWeeks,
    targetDay: input.targetDay,
    platforms: input.platforms,
    snapshotHash: ctx.snapshot_hash,
    snapshot: ctx.snapshot,
    diagnostics: ctx.diagnostics,
    omnivyreDecision: ctx.omnivyreDecision,
    platformStrategies: ctx.platformStrategies,
    conversationHistory: input.conversationHistory,
    recommendationContext: input.recommendationContext,
    companyContext: ctx.companyContext ?? null,
    campaignIntentSummary: ctx.campaignIntentSummary ?? null,
    baselineContext: ctx.baselineContext,
  });

  const completion = await generateCampaignPlan({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: 0,
    messages: prompt.messages,
  });

  const raw = completion.output?.trim() || '';

  if (input.mode === 'generate_plan' && input.conversationHistory?.length && raw && !raw.includes('BEGIN_12WEEK_PLAN')) {
    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      conversationalResponse: raw,
      raw_plan_text: raw,
    };
  }

  const planMatch = raw.match(/BEGIN_12WEEK_PLAN([\s\S]*?)END_12WEEK_PLAN/);
  const planText = planMatch ? planMatch[1].trim() : raw;
  if (input.mode === 'refine_day') {
    const dayPlan = await parseAiRefinedDay(raw);

    await saveStructuredCampaignPlanDayUpdate({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      dayPlan,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: raw,
    });

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      day: dayPlan,
      raw_plan_text: raw,
    };
  }

  if (input.mode === 'platform_customize') {
    const customization = await parseAiPlatformCustomization(raw);

    await savePlatformCustomizedContent({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      day: customization.day,
      platforms: customization.platforms,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: raw,
    });

    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      platform_content: customization,
      raw_plan_text: raw,
    };
  }

  let structured;
  try {
    structured = await parseAiPlanToWeeks(planText);
  } catch (parseError) {
    console.warn('Plan parse failed, treating as conversational:', parseError);
    return {
      mode: input.mode,
      snapshot_hash: ctx.snapshot_hash,
      omnivyre_decision: ctx.omnivyreDecision,
      conversationalResponse: planText || raw,
      raw_plan_text: raw,
    };
  }

  try {
    await saveStructuredCampaignPlan({
      campaignId: input.campaignId,
      snapshot_hash: ctx.snapshot_hash,
      weeks: structured.weeks,
      omnivyre_decision: ctx.omnivyreDecision,
      raw_plan_text: planText,
    });
  } catch (saveErr) {
    console.warn('saveStructuredCampaignPlan failed, returning plan anyway:', saveErr);
  }

  return {
    mode: input.mode,
    snapshot_hash: ctx.snapshot_hash,
    omnivyre_decision: ctx.omnivyreDecision,
    plan: structured,
    raw_plan_text: raw,
  };
}

const LIGHTWEIGHT_SNAPSHOT_HASH = 'conversational-fallback';

function createLightweightContext(
  campaignId: string,
  companyContext: string | null,
  campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string }
): {
  snapshot: any;
  snapshot_hash: string;
  diagnostics: any;
  omnivyreDecision: DecisionResult;
  platformStrategies: any[];
  companyContext: string | null;
  campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
} {
  return {
    snapshot: {
      campaign: { id: campaignId, status: null, timeframe: null, start_date: null, end_date: null, objective: null, goal_objectives: [] },
      weekly_plans: [],
      daily_plans: [],
      scheduled_posts: [],
      media_assets: [],
      platform_coverage: { platforms: [], daily_plan_counts: {}, scheduled_post_counts: {}, weekly_gaps: {} },
      asset_availability: { daily_plans_total: 0, daily_plans_with_content: 0, daily_plans_with_media_requirements: 0, daily_plans_with_media_attached: 0, media_assets_total: 0 },
    },
    snapshot_hash: LIGHTWEIGHT_SNAPSHOT_HASH,
    diagnostics: { overall_summary: 'Building campaign from conversation.' },
    omnivyreDecision: { status: 'ok', recommendation: 'proceed' },
    platformStrategies: DEFAULT_PLATFORM_STRATEGIES,
    companyContext,
    campaignIntentSummary,
  };
}

export async function runCampaignAiPlan(
  input: CampaignAiPlanInput
): Promise<CampaignAiPlanResult> {
  const isConversational = input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0;

  let resolvedDurationWeeks = input.durationWeeks;
  if (resolvedDurationWeeks == null) {
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('duration_weeks')
      .eq('id', input.campaignId)
      .maybeSingle();
    resolvedDurationWeeks = campaign?.duration_weeks ?? 12;
  }

  const inputWithDuration = { ...input, durationWeeks: resolvedDurationWeeks };

  const versionRow = await getLatestCampaignVersionByCampaignId(input.campaignId);
  const buildMode = versionRow?.build_mode ?? BACKWARD_COMPAT_DEFAULTS.build_mode;
  const contextScope = versionRow?.context_scope ?? null;
  const campaignTypes = versionRow?.campaign_types ?? BACKWARD_COMPAT_DEFAULTS.campaign_types;
  const campaignWeights = versionRow?.campaign_weights ?? BACKWARD_COMPAT_DEFAULTS.campaign_weights;
  const primaryType = getPrimaryCampaignType(campaignWeights);
  const campaignIntentSummary = {
    types: campaignTypes,
    weights: campaignWeights,
    primary_type: primaryType,
  };

  let companyContext: string | null = null;
  if (versionRow?.company_id && (buildMode === 'full_context' || buildMode === 'focused_context')) {
    try {
      const profile = await getProfile(versionRow.company_id, { autoRefine: false });
      companyContext = buildCompanyContextBlock(profile, buildMode, contextScope);
    } catch (e) {
      console.warn('Failed to load company profile for context injection:', e);
    }
  }

  const tryFullPipeline = async (): Promise<{
    snapshot: any;
    snapshot_hash: string;
    diagnostics: any;
    omnivyreDecision: DecisionResult;
    platformStrategies: any[];
    companyContext: string | null;
    campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
  }> => {
    const { snapshot } = await buildCampaignSnapshotWithHash(input.campaignId);
    const viralityAssessment = await assessVirality(input.campaignId);
    let platformStrategies: any[] = [];
    try {
      platformStrategies = await getPlatformStrategies();
    } catch (e) {
      console.warn('getPlatformStrategies failed, using defaults:', e);
      platformStrategies = DEFAULT_PLATFORM_STRATEGIES;
    }

    let omnivyreDecision: DecisionResult = { status: 'ok', recommendation: 'proceed' };
    try {
      const decidePayload = buildDecideRequest({
        campaign_id: input.campaignId,
        snapshot_hash: viralityAssessment.snapshot_hash,
        model_version: viralityAssessment.model_version,
        snapshot,
        diagnostics: viralityAssessment.diagnostics,
        comparisons: viralityAssessment.comparisons,
        overall_summary: viralityAssessment.overall_summary,
      });
      omnivyreDecision = await requestDecision(decidePayload);
    } catch (e) {
      console.warn('Omnivyre requestDecision failed, continuing without:', e);
    }

    return {
      snapshot,
      snapshot_hash: viralityAssessment.snapshot_hash,
      diagnostics: viralityAssessment,
      omnivyreDecision,
      platformStrategies: platformStrategies.length > 0 ? platformStrategies : DEFAULT_PLATFORM_STRATEGIES,
      companyContext,
      campaignIntentSummary,
    };
  };

  let ctx: {
    snapshot: any;
    snapshot_hash: string;
    diagnostics: any;
    omnivyreDecision: DecisionResult;
    platformStrategies: any[];
    companyContext: string | null;
    campaignIntentSummary: { types: string[]; weights: Record<string, number>; primary_type: string };
    baselineContext?: BaselineContextResult;
  };

  try {
    ctx = await tryFullPipeline();
  } catch (err) {
    console.warn('Campaign AI full pipeline failed, using lightweight path:', err);
    if (isConversational) {
      ctx = createLightweightContext(input.campaignId, companyContext, campaignIntentSummary);
    } else {
      throw err;
    }
  }

  let baselineContext: BaselineContextResult = { unavailable: true };
  if (versionRow?.company_id) {
    try {
      baselineContext = await resolveBaselineContext({
        companyId: versionRow.company_id,
        companyStage: versionRow.company_stage ?? null,
        marketScope: versionRow.market_scope ?? null,
        baselineOverride: versionRow.baseline_override ?? null,
        primaryType: campaignIntentSummary.primary_type,
        platformStrategies: ctx.platformStrategies || [],
      });
    } catch (e) {
      console.warn('Baseline context resolution failed, using unavailable:', e);
    }
  }
  ctx.baselineContext = baselineContext;

  const result = await runWithContext(inputWithDuration, ctx);

  if (result.omnivyre_decision && baselineContext && !('unavailable' in baselineContext)) {
    result.omnivyre_decision = {
      ...result.omnivyre_decision,
      raw: {
        ...(typeof result.omnivyre_decision.raw === 'object' && result.omnivyre_decision.raw
          ? result.omnivyre_decision.raw
          : {}),
        baseline: {
          expectedBaseline: baselineContext.expectedBaseline,
          actualFollowers: baselineContext.actualFollowers,
          ratio: baselineContext.ratio,
          status: baselineContext.status,
        },
      },
    };
  }

  return result;
}
