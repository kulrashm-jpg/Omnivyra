/**
 * Daily plan AI generator — context-aware, LLM-backed.
 * Uses campaign strategy + blueprint week data to produce meaningful daily plans.
 * Falls back to deterministic generation when LLM is unavailable.
 */

import { runCompletionWithOperation } from './aiGateway';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export type DailyPlanContext = {
  weekNumber: number;
  dayOfWeek: string;
  weeklyPlan?: { theme?: string; keyMessaging?: string; callToAction?: string };
  campaignStrategy?: { objective?: string; targetAudience?: string; keyPlatforms?: string[] };
};

export type DailyPlanOutput = {
  platform: string;
  contentType: string;
  title: string;
  content: string;
  description?: string;
  optimalTime?: string;
  optimalPostingTime?: string;
  hashtags?: string[];
  targetMetrics?: Record<string, number>;
  mediaRequirements?: { type: string; dimensions: string; aspectRatio: string };
  callToAction?: string;
};

/** Rich context passed from generateFromAI to the LLM generator */
export type WeeklyGenerationContext = {
  campaignId: string;
  companyId?: string;
  campaignName: string;
  campaignDescription?: string;
  campaignObjective?: string;
  targetAudience?: string;
  brandVoice?: string;
  weekNumber: number;
  weekTheme: string;
  weekPhaseLabel?: string;
  weekPrimaryObjective?: string;
  weekContextCapsule?: {
    primaryPainPoint?: string;
    desiredTransformation?: string;
    psychologicalGoal?: string;
    toneGuidance?: string;
    audienceProfile?: string;
    weeklyIntent?: string;
  };
  topics?: Array<{
    topicTitle: string;
    writingIntent?: string;
    whoAreWeWritingFor?: string;
    whatProblemAreWeAddressing?: string;
    whatShouldReaderLearn?: string;
    desiredAction?: string;
    narrativeStyle?: string;
    recommendedContentTypes?: string[];
    platformPriority?: string[];
  }>;
  topicsToCover?: string[];
  platforms: string[];
  contentTypeMix: string[];
  ctaType?: string;
  /** When provided, generate exactly these slots instead of a generic 7-day plan. */
  frequencySlots?: Array<{ dayOfWeek: string; platform: string; contentType: string }>;
};

type DayPlan = {
  dayOfWeek: string;
  platform: string;
  contentType: string;
  title: string;
  dailyObjective: string;
  writingIntent: string;
  whoAreWeWritingFor: string;
  whatProblemAreWeAddressing: string;
  whatShouldReaderLearn: string;
  desiredAction: string;
  narrativeStyle: string;
  creatorInstruction?: string;
  hashtags?: string[];
  optimalTime?: string;
  topic_part?: number;
  topic_total?: number;
};

function buildSystemPrompt(): string {
  return `You are a campaign content strategist creating detailed daily execution plans.
You generate structured, actionable daily content plans that follow the campaign strategy exactly.
Each daily plan must be specific to the topic, audience, platform, and week objectives.
Return ONLY valid JSON — no markdown, no prose, no code fences.`;
}

function buildUserPrompt(ctx: WeeklyGenerationContext): string {
  const topicsSection = ctx.topics && ctx.topics.length > 0
    ? ctx.topics.map((t, i) => {
        const parts = [`Topic ${i + 1}: ${t.topicTitle}`];
        if (t.writingIntent) parts.push(`Writing intent: ${t.writingIntent}`);
        if (t.whoAreWeWritingFor) parts.push(`Audience: ${t.whoAreWeWritingFor}`);
        if (t.whatProblemAreWeAddressing) parts.push(`Pain point: ${t.whatProblemAreWeAddressing}`);
        if (t.whatShouldReaderLearn) parts.push(`Reader takeaway: ${t.whatShouldReaderLearn}`);
        if (t.desiredAction) parts.push(`CTA: ${t.desiredAction}`);
        if (t.narrativeStyle) parts.push(`Style: ${t.narrativeStyle}`);
        if (t.recommendedContentTypes?.length) parts.push(`Preferred formats: ${t.recommendedContentTypes.join(', ')}`);
        if (t.platformPriority?.length) parts.push(`Preferred platforms: ${t.platformPriority.join(', ')}`);
        return parts.join('\n  ');
      }).join('\n\n')
    : ctx.topicsToCover?.length
      ? ctx.topicsToCover.map((t, i) => `Topic ${i + 1}: ${t}`).join('\n')
      : `Generate relevant topics based on the week theme: ${ctx.weekTheme}`;

  const capsule = ctx.weekContextCapsule;
  const capsuleSection = capsule ? `
Week Context:
- Pain point: ${capsule.primaryPainPoint ?? ''}
- Desired transformation: ${capsule.desiredTransformation ?? ''}
- Psychological goal: ${capsule.psychologicalGoal ?? ''}
- Tone guidance: ${capsule.toneGuidance ?? ''}
- Audience profile: ${capsule.audienceProfile ?? ''}
- Weekly intent: ${capsule.weeklyIntent ?? ''}` : '';

  if (ctx.frequencySlots && ctx.frequencySlots.length > 0) {
    const slotLines = ctx.frequencySlots.map(
      (s, i) => `Slot ${i + 1}: ${s.dayOfWeek} — ${s.platform} ${s.contentType}`
    ).join('\n');

    return `Generate content for these specific planned slots for campaign week ${ctx.weekNumber}.

CAMPAIGN:
- Name: ${ctx.campaignName}
${ctx.campaignDescription ? `- Description: ${ctx.campaignDescription}` : ''}
${ctx.campaignObjective ? `- Objective: ${ctx.campaignObjective}` : ''}
${ctx.targetAudience ? `- Target audience: ${ctx.targetAudience}` : ''}
${ctx.brandVoice ? `- Brand voice: ${ctx.brandVoice}` : ''}

WEEK ${ctx.weekNumber}:
- Theme: ${ctx.weekTheme}
${ctx.weekPhaseLabel ? `- Phase: ${ctx.weekPhaseLabel}` : ''}
${ctx.weekPrimaryObjective ? `- Primary objective: ${ctx.weekPrimaryObjective}` : ''}
${capsuleSection}

SCHEDULED SLOTS (generate content for EXACTLY these ${ctx.frequencySlots.length} slots):
${slotLines}

TOPICS TO DISTRIBUTE ACROSS SLOTS:
${topicsSection}

INSTRUCTIONS:
- Generate EXACTLY ${ctx.frequencySlots.length} items — one per slot above, in the same order
- The dayOfWeek, platform, and contentType in each response item MUST exactly match the slot
- Distribute topics intelligently across slots (avoid same topic on consecutive slots)
- Each item must be specific, actionable, and tied directly to the campaign context
- content_type MUST be one of: video, reel, short, carousel, article, newsletter, thread, post, story
- If content requires creator involvement (filming, recording), populate "creatorInstruction"; otherwise leave empty string
- "hashtags" should be 3-5 campaign-specific hashtags

Return a JSON object with this exact structure:
{
  "days": [
    {
      "dayOfWeek": "<exact dayOfWeek from slot>",
      "platform": "<exact platform from slot>",
      "contentType": "<exact contentType from slot>",
      "title": "<specific topic title>",
      "dailyObjective": "<what this post achieves>",
      "writingIntent": "<what the content should convey>",
      "whoAreWeWritingFor": "<specific audience segment>",
      "whatProblemAreWeAddressing": "<specific pain point>",
      "whatShouldReaderLearn": "<key takeaway>",
      "desiredAction": "<specific CTA>",
      "narrativeStyle": "<tone and style>",
      "creatorInstruction": "<instruction for creator, or empty string>",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "optimalTime": "09:00"
    }
  ]
}`;
  }

  return `Generate a 7-day daily execution plan for this campaign week.

CAMPAIGN:
- Name: ${ctx.campaignName}
${ctx.campaignDescription ? `- Description: ${ctx.campaignDescription}` : ''}
${ctx.campaignObjective ? `- Objective: ${ctx.campaignObjective}` : ''}
${ctx.targetAudience ? `- Target audience: ${ctx.targetAudience}` : ''}
${ctx.brandVoice ? `- Brand voice: ${ctx.brandVoice}` : ''}

WEEK ${ctx.weekNumber}:
- Theme: ${ctx.weekTheme}
${ctx.weekPhaseLabel ? `- Phase: ${ctx.weekPhaseLabel}` : ''}
${ctx.weekPrimaryObjective ? `- Primary objective: ${ctx.weekPrimaryObjective}` : ''}
${capsuleSection}
- Available platforms: ${ctx.platforms.join(', ')}
- Content type mix: ${ctx.contentTypeMix.join(', ')}
${ctx.ctaType ? `- CTA type: ${ctx.ctaType}` : ''}

TOPICS TO DISTRIBUTE ACROSS 7 DAYS:
${topicsSection}

INSTRUCTIONS:
- Assign one plan per day: Monday through Sunday
- Distribute topics across days (don't repeat the same topic on consecutive days unless you have fewer than 7 topics)
- Choose platform from the available list and content type from the content type mix
- content_type MUST be a real specific format: for text-based use "post", "article", "thread", "newsletter", "story"; for media-based use "video", "reel", "short", "carousel"
- Match content type to topic and platform: educational deep-dives → "article"; quick insight → "post"; visual step-by-step → "carousel"; talking-head/tutorial → "video"; multi-tweet → "thread"
- Each plan must be specific, actionable, and tied directly to the campaign context
- If a topic requires creator involvement (filming, recording) set "creatorInstruction" with production direction; otherwise leave empty string
- "hashtags" should be 3-5 relevant campaign-specific hashtags (no generic ones like #content or #marketing)

Return a JSON object with this exact structure:
{
  "days": [
    {
      "dayOfWeek": "Monday",
      "platform": "<platform from available list>",
      "contentType": "<type from content mix>",
      "title": "<specific topic title>",
      "dailyObjective": "<what this post achieves today>",
      "writingIntent": "<what the content should convey>",
      "whoAreWeWritingFor": "<specific audience segment>",
      "whatProblemAreWeAddressing": "<specific pain point>",
      "whatShouldReaderLearn": "<key takeaway>",
      "desiredAction": "<specific CTA>",
      "narrativeStyle": "<tone and style>",
      "creatorInstruction": "<instruction for creator, or empty string>",
      "hashtags": ["#tag1", "#tag2", "#tag3"],
      "optimalTime": "09:00"
    }
    ... (all 7 days)
  ]
}`;
}

/** Detect repeated topics across days and assign part numbers (1/3, 2/3, 3/3). */
function assignTopicThreading(days: DayPlan[]): DayPlan[] {
  const counts = new Map<string, number>();
  for (const d of days) {
    const key = d.title.trim().toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const current = new Map<string, number>();
  return days.map((d) => {
    const key = d.title.trim().toLowerCase();
    const total = counts.get(key) ?? 1;
    if (total < 2) return d;
    const part = (current.get(key) ?? 0) + 1;
    current.set(key, part);
    return { ...d, topic_part: part, topic_total: total };
  });
}

/**
 * Generate 7 daily plans using LLM with full campaign + week context.
 * Falls back to deterministic generation if LLM fails.
 */
export async function generateDailyPlansWithAI(ctx: WeeklyGenerationContext): Promise<DayPlan[]> {
  try {
    const result = await runCompletionWithOperation({
      companyId: ctx.companyId ?? null,
      campaignId: ctx.campaignId,
      model: 'gpt-4o-mini',
      temperature: 0.7,
      response_format: { type: 'json_object' },
      operation: 'generateDailyPlan',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(ctx) },
      ],
    });

    let parsed: { days?: DayPlan[] };
    try {
      parsed = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
    } catch {
      parsed = {};
    }

    const days: DayPlan[] = Array.isArray(parsed?.days) ? parsed.days : [];

    // Slot-based mode: return exactly the AI-generated slots (don't pad to 7 days)
    if (ctx.frequencySlots && ctx.frequencySlots.length > 0) {
      const validDays = days.filter((d) => d?.dayOfWeek && d?.title);
      // Fallback: if AI returned fewer slots than expected, fill remaining from blueprint
      const result: DayPlan[] = ctx.frequencySlots.map((slot, i) => {
        const scheduledTime = (slot as any).optimalTime as string | undefined;
        const aiDay = validDays[i] ?? validDays.find((d) => d.dayOfWeek === slot.dayOfWeek);
        if (aiDay) {
          return { ...aiDay, dayOfWeek: slot.dayOfWeek, platform: slot.platform, contentType: slot.contentType, ...(scheduledTime ? { optimalTime: scheduledTime } : {}) };
        }
        const fallback = buildFallbackDay(slot.dayOfWeek, { ...ctx, platforms: [slot.platform], contentTypeMix: [slot.contentType] });
        return scheduledTime ? { ...fallback, optimalTime: scheduledTime } : fallback;
      });
      return assignTopicThreading(result);
    }

    // 7-day mode: ensure all days are covered
    const dayMap = new Map(days.map((d) => [d.dayOfWeek, d]));
    const sevenDays = DAYS_ORDER.map((dayOfWeek) =>
      dayMap.get(dayOfWeek) ?? buildFallbackDay(dayOfWeek, ctx)
    );
    return assignTopicThreading(sevenDays);
  } catch (err) {
    console.warn('[dailyPlanAiGenerator] LLM generation failed, using deterministic fallback:', err instanceof Error ? err.message : String(err));
    if (ctx.frequencySlots && ctx.frequencySlots.length > 0) {
      return assignTopicThreading(
        ctx.frequencySlots.map((slot) => {
          const scheduledTime = (slot as any).optimalTime as string | undefined;
          const fallback = buildFallbackDay(slot.dayOfWeek, { ...ctx, platforms: [slot.platform], contentTypeMix: [slot.contentType] });
          return scheduledTime ? { ...fallback, optimalTime: scheduledTime } : fallback;
        })
      );
    }
    return assignTopicThreading(DAYS_ORDER.map((dayOfWeek) => buildFallbackDay(dayOfWeek, ctx)));
  }
}

/** Deterministic fallback: uses blueprint data without LLM */
function buildFallbackDay(dayOfWeek: string, ctx: WeeklyGenerationContext): DayPlan {
  const dayIndex = DAYS_ORDER.indexOf(dayOfWeek as any);
  const platform = ctx.platforms[dayIndex % Math.max(ctx.platforms.length, 1)] ?? 'linkedin';
  const contentType = ctx.contentTypeMix[dayIndex % Math.max(ctx.contentTypeMix.length, 1)] ?? 'post';

  // Pick a topic round-robin
  const topicCount = ctx.topics?.length ?? ctx.topicsToCover?.length ?? 0;
  const topicIndex = topicCount > 0 ? dayIndex % topicCount : 0;
  const topic = ctx.topics?.[topicIndex];
  const topicTitle = topic?.topicTitle ?? ctx.topicsToCover?.[topicIndex] ?? `${ctx.weekTheme} — ${dayOfWeek}`;

  const times: Record<string, string> = {
    linkedin: '09:00', instagram: '11:00', x: '10:00', twitter: '10:00',
    facebook: '13:00', youtube: '15:00', tiktok: '18:00', pinterest: '20:00',
  };

  return {
    dayOfWeek,
    platform,
    contentType,
    title: topicTitle,
    dailyObjective: topic?.writingIntent ?? `${ctx.weekPrimaryObjective ?? ctx.weekTheme} — ${dayOfWeek} execution`,
    writingIntent: topic?.writingIntent ?? `Drive engagement around ${topicTitle}`,
    whoAreWeWritingFor: topic?.whoAreWeWritingFor ?? ctx.targetAudience ?? ctx.weekContextCapsule?.audienceProfile ?? 'Target audience',
    whatProblemAreWeAddressing: topic?.whatProblemAreWeAddressing ?? ctx.weekContextCapsule?.primaryPainPoint ?? '',
    whatShouldReaderLearn: topic?.whatShouldReaderLearn ?? `Key insight about ${topicTitle}`,
    desiredAction: topic?.desiredAction ?? ctx.ctaType ?? 'Engage with this post',
    narrativeStyle: topic?.narrativeStyle ?? ctx.weekContextCapsule?.toneGuidance ?? 'Professional and engaging',
    creatorInstruction: '',
    hashtags: [],
    optimalTime: times[platform.toLowerCase()] ?? '09:00',
  };
}

/**
 * @deprecated Use generateDailyPlansWithAI instead.
 * Kept for backward compatibility only.
 */
export function generateDailyPlanDemo(context: DailyPlanContext): DailyPlanOutput {
  const { weekNumber, dayOfWeek, weeklyPlan } = context;
  const platforms = context.campaignStrategy?.keyPlatforms ?? ['linkedin', 'instagram', 'x'];
  const dayIndex = DAYS_ORDER.indexOf(dayOfWeek as any);
  const platform = platforms[dayIndex % platforms.length] ?? 'linkedin';

  return {
    platform,
    contentType: 'post',
    title: `${dayOfWeek}: ${weeklyPlan?.theme ?? 'Content'}`,
    content: weeklyPlan?.keyMessaging ?? 'Content for today.',
    description: `${dayOfWeek} content for week ${weekNumber}`,
    optimalTime: '09:00',
    hashtags: [],
  };
}
