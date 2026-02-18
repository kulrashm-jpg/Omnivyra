import { supabase } from '../db/supabaseClient';
import { generateCampaignPlan } from './aiGateway';
import { computeCampaignPlanningQAState } from '../chatGovernance';
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

export interface OptimizationContext {
  roiScore: number;
  headlines: string[];
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
  /** Stage 35: ROI + optimization headlines for AI context injection */
  optimizationContext?: OptimizationContext | null;
  /** When refining an existing plan, pass the current plan so AI can apply changes */
  currentPlan?: { weeks: any[] };
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
  { key: 'available_content', question: 'Do you have any existing content for this campaign? (e.g., how many videos, blog posts, or carousel posts you already have that fit the topic)' },
  { key: 'available_content_allocation', question: 'CONTINGENT: Only ask if they said they have content. For each piece (e.g., "I have this video and this blog")—which category/objective should it serve: brand awareness, network expansion, lead generation, authority positioning, engagement growth, or product promotion? And which specific week(s) in your plan should it fill? This assigns each piece to a placeholder for that week.', contingentOn: 'available_content' },
  { key: 'tentative_start', question: 'When do you want to start the campaign? Please provide a date in YY-MM-DD format (e.g., 25-03-01).' },
  { key: 'campaign_types', question: 'Which campaign types matter most for you? Pick one or more: brand awareness, network expansion, lead generation, authority positioning, engagement growth, product promotion. Which is primary?' },
  { key: 'content_capacity', question: 'How much content can you produce per week, and how will you create it? For each format—blogs, videos, carousels, single posts, stories—how many per week? And is creation manual, AI-assisted, or full AI?' },
  { key: 'campaign_duration', question: 'How many weeks should the campaign run? (e.g., 6, 12, or 24 weeks)' },
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
  optimizationContext?: { roiScore: number; headlines: string[] } | null;
  prefilledPlanning?: Record<string, unknown> | null;
  qaState?: { answeredKeys: string[]; userConfirmed: boolean; nextQuestion: { key: string; question: string } | null };
  currentPlan?: { weeks: any[] };
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
  if (input.optimizationContext && input.optimizationContext.headlines?.length) {
    userPayload.optimization_signals =
      `Campaign ROI Score: ${input.optimizationContext.roiScore} | Optimization Signals: ${input.optimizationContext.headlines.join('; ')}`;
  } else if (input.optimizationContext) {
    userPayload.optimization_signals = `Campaign ROI Score: ${input.optimizationContext.roiScore}`;
  }
  if (input.prefilledPlanning && Object.keys(input.prefilledPlanning).length > 0) {
    userPayload.prefilled_planning = input.prefilledPlanning;
  }

  const prefilledBlock =
    input.prefilledPlanning && Object.keys(input.prefilledPlanning).length > 0
      ? `
ALREADY KNOWN (from campaign setup — do NOT re-ask these):
${Object.entries(input.prefilledPlanning)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

Start from the first required question that is NOT listed above. If most are filled, ask only the missing ones.`
      : '';

  const refinePlanBlock = input.currentPlan?.weeks?.length
    ? `
REFINE PLAN MODE: The user is reviewing their campaign plan and wants to make changes via natural language. Here is the current plan:
${JSON.stringify(input.currentPlan.weeks, null, 2)}

The user's request: "${input.message}"

Apply their changes. Accept natural-language edits like:
- "Week 1 Facebook topic should be 'Professional neglecting personal lives'" → set topic for that platform
- "Week 3 LinkedIn: 2 posts and 1 article" → update platform_content_breakdown for linkedin
- "Change Week 5 theme to X" or "Add topic Y to Week 5"
- "Week 2 Instagram: 1 reel, 2 stories" → explicit platform+content breakdown
- "Same post on Facebook and LinkedIn" → include that item in BOTH platform arrays (platforms: ["facebook","linkedin"]) so it displays under both

DAILY PLAN GENERATION: When the user asks to "Generate the daily plan for Week X" or "AI daily" for a week, populate that week's \`daily\` array with 5–7 days (Mon–Fri or include weekend as appropriate). For each day include:
- \`day\`: "Monday", "Tuesday", etc.
- \`objective\`: short objective for the day
- \`content\`: overarching content focus
- \`platforms\`: Record<string, string> — for each platform in the week's platform_allocation, format the value as:
  "Type: [LinkedIn Post | Facebook Post | Blog Article | etc.]\\nTitle: [catchy title]\\nSummary: [1–2 sentence summary of the content]"
- \`best_time\`: suggested best time to post (e.g. "9:00 AM")
- Suggest the best day of the week for each platform when relevant (e.g. "LinkedIn: Tuesday; Facebook: Wednesday")
- Use the week's topics_to_cover and platform_content_breakdown to inform content. Output a concise summary per platform per day (e.g. "LinkedIn Post: title, summary; Facebook: title, summary").

Keep the same structure (weeks array with theme, phase_label, primary_objective, platform_allocation, content_type_mix, platform_content_breakdown, platform_topics, cta_type, weekly_kpi_focus, topics_to_cover, daily). When user specifies topic or content type for a platform+week, set platform_content_breakdown and/or platform_topics accordingly. Return the REVISED FULL PLAN wrapped in BEGIN_12WEEK_PLAN and END_12WEEK_PLAN. Do NOT ask questions—just output the revised plan.`
    : null;

  const modeHint =
    refinePlanBlock
      ? refinePlanBlock
      : input.mode === 'platform_customize'
      ? '\nFocus only on the target day and provide platform-specific variants for the requested platforms.\n'
      : input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0
      ? `
ONE-BY-ONE QUESTIONING MODE (generate_plan with conversation):

You are building a ${durationWeeks}-week campaign plan through conversation. You MUST gather details first, then generate the plan ONLY when the user explicitly asks for it or when you have all required info.
${prefilledBlock}
${input.qaState?.userConfirmed ? `
GOVERNANCE OVERRIDE (MANDATORY): The user has confirmed. Output BEGIN_12WEEK_PLAN immediately. Do NOT ask any more questions.` : ''}
${input.qaState?.answeredKeys?.length && !input.qaState?.userConfirmed ? `
GOVERNANCE: Do NOT re-ask these (already answered): ${input.qaState.answeredKeys.join(', ')}.` : ''}
${input.qaState?.nextQuestion && !input.qaState?.userConfirmed ? `
GOVERNANCE: Ask ONLY this next question — do not change to a different one: "${input.qaState.nextQuestion.question}"` : ''}

REQUIRED INFO TO GATHER (in order, one question at a time — skip any already in ALREADY KNOWN above):
1. target_audience — Who is your primary target audience?
2. available_content — Do they have existing content (videos, posts, blogs) for this campaign? VALID "no content" answers: "no", "none", "zero", "I don't have any", "no content", or any message that clearly means no (e.g. "professionals no" when answering after target_audience = the "no" part answers this). Accept and move to next question.
3. available_content_allocation — ONLY IF they have content: For each piece, ask category/objective and which week(s) to fill.
4. tentative_start — When do they want to start? Date in YY-MM-DD format (e.g., 25-03-01).
5. campaign_types — Which matter most: brand awareness, network expansion, lead generation, authority positioning, engagement growth, product promotion?
6. content_capacity — Per format: how many/week? Creation method: manual, AI-assisted, or full AI?
7. campaign_duration — How many weeks (e.g., 6, 12, 24)?
8. platforms — Which platforms will they focus on?
9. key_messages — Key messages or pain points? (USER MAY DEFER: see INFER-AND-PROCEED rule below)
10. success_metrics — What metrics to track? (USER MAY DEFER: see INFER-AND-PROCEED rule below)

INFER-AND-PROCEED: For key_messages and success_metrics, if the user says "you define it", "you make it", "you decide", "you need to define it", "up to you", "your choice", or similar — treat as VALID. Infer from theme, campaign type, and target audience. Do NOT re-ask. Proceed to the next question or to plan generation.

CRITICAL RULES:
- VALIDATE each answer against the question asked. If the answer does NOT fit (e.g., a date when you asked for target audience), politely re-ask the SAME question. Do NOT move on until you receive a valid answer.
- For available_content: "no", "none", "zero", "I don't have any", or messages containing/ending with "no" (e.g. "X no" when X was a prior answer) = valid "no content". Proceed to tentative_start. Do NOT re-ask.
- After EACH valid user answer, reply with ONLY the next question. Be conversational and warm. Do NOT generate the plan yet.
- CONFIRMATION OVERRIDE (MUST OBEY): If YOUR last message was "Would you like me to create your ${durationWeeks}-week plan now?" (or similar), and the user replies with "yes", "sure", "ok", "okay", "please", "yeah", "yep", "create it", "do it", "go for it" — IMMEDIATELY output BEGIN_12WEEK_PLAN. Do NOT ask any more questions. Do NOT repeat the confirmation. Do NOT ask key_messages or success_metrics after this. GENERATE THE PLAN NOW.
- ONLY output BEGIN_12WEEK_PLAN when BOTH are true: (a) user has answered required questions (or deferred key_messages/success_metrics), AND (b) user confirms. Valid confirmations: "create my plan", "generate plan", "I'm ready", "go ahead", "yes", "sure", "ok", "share 12 weeks plan", "if you don't have any questions" (meaning generate).
- If the user says "share 12 weeks plan" or "no questions" or "just create the plan" early — skip remaining questions and generate with inferred values.
- If the user answered all questions but has NOT confirmed, ask: "I have everything I need. Would you like me to create your ${durationWeeks}-week plan now?" When they reply "yes", "sure", "ok", etc., GENERATE immediately. NEVER restart from question 1.
- Use the recommendation context and all previous answers to inform the plan. Each week MUST have a concrete theme and topics to cover.
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

9. Weekly Theme (REQUIRED — must be decided before scheduling)
   A concrete, topic-specific theme for the week. NOT the phase label.
   Example: "Introduce the 3-pillar stress-reduction framework" or "Share customer success: overcoming anxiety".
   Must state what we are specifically doing from the campaign objective standpoint that week, given the campaign topic.

10. Topics to Cover This Week (REQUIRED)
   A list of 2–5 specific topics or content angles to cover in that week. Each topic should be actionable for content creation.
   Example: ["Mindfulness basics and definition", "3 breathing techniques", "Sleep hygiene connection", "Quick wins for busy professionals"]
   These topics drive the actual content—posts, videos, carousels—for the week. Must align with the weekly theme.

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
- No theme-only weeks (but weekly theme and topics to cover are required).
- All 10 sections required per week.
- All weeks must follow identical structure.
- Weekly theme must be explicit and topic-specific—do not leave blank.
- Topics to cover must list 2–5 concrete sub-topics for content creation.
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
      system: 'You are a campaign planning assistant. Ask one question at a time. When the user confirms ("yes", "sure", "ok", "create my plan"), GENERATE the plan immediately. Never restart from question 1.',
      user: baseUser,
      messages: [
        { role: 'system', content: `Ask one question at a time. CRITICAL: When your last message was "Would you like me to create your plan now?" and the user replies "yes", "sure", "ok", "okay" — OUTPUT BEGIN_12WEEK_PLAN IMMEDIATELY. For "Do you have existing content?" — accept "no", "none", "zero", or messages containing "no" (e.g. "X no" = no content). Move to next question. For key_messages/success_metrics: if user says "you define it" or "you make it", infer and proceed. Wrap the plan with BEGIN_12WEEK_PLAN and END_12WEEK_PLAN.` },
        ...conversationMessages.slice(-50),
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

function buildPrefilledPlanning(input: {
  campaign: { start_date?: string | null; duration_weeks?: number | null; description?: string | null; name?: string } | null;
  versionRow: {
    campaign_types?: string[];
    campaign_weights?: Record<string, number>;
    campaign_snapshot?: { planning_context?: { content_capacity?: Record<string, { perWeek?: number; creationMethod?: string }> }; target_regions?: string[]; context_payload?: { formats?: string[]; platforms?: string[] } };
  } | null;
}): Record<string, unknown> {
  const prefilled: Record<string, unknown> = {};
  const c = input.campaign;
  const v = input.versionRow;
  if (c?.start_date) prefilled.tentative_start = c.start_date;
  if (c?.duration_weeks != null) prefilled.campaign_duration = c.duration_weeks;
  if (v?.campaign_types?.length) {
    prefilled.campaign_types = v.campaign_types.map((t) => t.replace(/_/g, ' ')).join(', ');
  }
  if (v?.campaign_snapshot?.planning_context?.content_capacity) {
    const cap = v.campaign_snapshot.planning_context.content_capacity;
    const parts: string[] = [];
    for (const [fmt, val] of Object.entries(cap)) {
      if (val && typeof val === 'object' && 'perWeek' in val) {
        const p = val as { perWeek?: number; creationMethod?: string };
        parts.push(`${fmt}: ${p.perWeek ?? 0}/week (${p.creationMethod ?? 'manual'})`);
      }
    }
    if (parts.length) prefilled.content_capacity = parts.join('; ');
  }
  const payload = v?.campaign_snapshot?.context_payload;
  if (payload?.formats?.length) prefilled.suggested_formats = payload.formats.join(', ');
  if (payload?.platforms?.length) prefilled.platforms = payload.platforms.join(', ');
  if (v?.campaign_snapshot?.target_regions?.length) {
    prefilled.target_regions = v.campaign_snapshot.target_regions.join(', ');
  }
  if (c?.description) prefilled.theme_or_description = c.description.slice(0, 300);
  return prefilled;
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
    prefilledPlanning?: Record<string, unknown>;
    qaState?: { answeredKeys: string[]; userConfirmed: boolean; nextQuestion: { key: string; question: string } | null };
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
    optimizationContext: input.optimizationContext ?? null,
    prefilledPlanning: ctx.prefilledPlanning ?? null,
    qaState: ctx.qaState,
    currentPlan: input.currentPlan,
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
  const { data: campaignRow } = await supabase
    .from('campaigns')
    .select('duration_weeks, start_date, description, name')
    .eq('id', input.campaignId)
    .maybeSingle();
  if (resolvedDurationWeeks == null) {
    resolvedDurationWeeks = campaignRow?.duration_weeks ?? 12;
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

  const prefilledPlanning = buildPrefilledPlanning({
    campaign: campaignRow,
    versionRow,
  });

  const qaState =
    input.mode === 'generate_plan' && (input.conversationHistory?.length ?? 0) > 0
      ? computeCampaignPlanningQAState({
          gatherOrder: GATHER_ORDER.map((g) => ({
            key: g.key,
            question: g.question,
            contingentOn: (g as { contingentOn?: string }).contingentOn,
          })),
          prefilledKeys: Object.keys(prefilledPlanning || {}),
          conversationHistory: (input.conversationHistory ?? []).map((m) => ({
            type: m.type as 'user' | 'ai',
            message: m.message,
          })),
        })
      : undefined;

  const result = await runWithContext(inputWithDuration, {
    ...ctx,
    prefilledPlanning,
    qaState: qaState
      ? {
          answeredKeys: qaState.answeredKeys,
          userConfirmed: qaState.userConfirmed,
          nextQuestion: qaState.nextQuestion,
        }
      : undefined,
  });

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
