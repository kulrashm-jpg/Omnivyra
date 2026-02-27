/**
 * AI Content Distribution Planner: generates day-wise content distribution from a weekly campaign plan.
 * Uses the full distribution logic: topic format (short 6–8 words + full), campaign mode (QUICK_LAUNCH vs STRATEGIC),
 * platform rules, holiday/culture, content fatigue prevention, cascade strategy, and energy curve.
 */

import { generateDailyDistributionPlan as callDistributionLLM } from './aiGateway';
import type { CampaignBlueprintWeek } from '../types/CampaignBlueprint';

export type CampaignMode = 'QUICK_LAUNCH' | 'STRATEGIC';

/** Staggered = same topic spread across different days. Same day = all content for a topic on one day. */
export type DistributionMode = 'staggered' | 'same_day_per_topic';

export interface DailyDistributionSlot {
  day_index: number;
  day_name: string;
  short_topic: string;
  full_topic: string;
  content_type: string;
  platform: string;
  reasoning: string;
  festival_consideration?: string;
}

export interface GenerateDailyDistributionInput {
  companyId?: string | null;
  campaignId: string;
  weekNumber: number;
  weekBlueprint: CampaignBlueprintWeek;
  campaignName?: string;
  campaignStartDate?: string;
  targetRegion?: string | null;
  campaignMode?: CampaignMode;
  contentTypesAvailable?: string[];
  /** Staggered = spread by slot across days. Same day = one topic → one day, all content types that day. */
  distributionMode?: DistributionMode;
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const SYSTEM_PROMPT = `You are an AI Content Distribution Planner.

Your task is to generate an intelligent DAILY CONTENT DISTRIBUTION PLAN from a weekly campaign plan.

## CRITICAL: ONE SLOT PER CONTENT PIECE — SPREAD ACROSS THE WEEK

* You MUST output multiple slots: at least one slot per weekly topic (or per topic+platform/content_type combination). Do NOT output a single slot for the entire week.
* Each slot MUST have a different day_index where possible. NEVER assign all slots to Monday (day_index 1). Spread across Monday=1 through Sunday=7.
* Use at least 5 different days when you have 5+ slots; for fewer slots still spread (e.g. 3 topics → Mon, Wed, Fri).
* Think: "visibility across the whole week" and "platform best days" — not "bunch everything on one day."

---

## 1. INPUT CONTEXT

You will receive (as JSON):
* Weekly campaign goal / theme
* Weekly topics (list)
* Content themes
* Content types available (video, post, reel, carousel, poll, article, etc.)
* Target region or country (use for holiday/festival detection)
* Campaign mode: QUICK_LAUNCH or STRATEGIC
* Campaign name, week number, campaign start date (for date-aware planning)

## 2. CORE OUTPUT OBJECTIVE

Generate a day-wise content distribution plan. For each slot decide:
* Short topic (max 6–8 words)
* Full topic description (expandable)
* Content type
* Social media platform
* Posting day (day_index 1–7; MUST be spread across the week)
* Distribution reasoning
* Festival/holiday consideration if target region has one that day

The plan must feel realistic, strategic, and aligned with human content behaviour.

## 3. TOPIC FORMAT RULE

Every daily activity MUST include (displayed on daily card):
* Short Topic → 6–8 words (calendar view)
* Full Topic → expandable detailed description

Example:
Short Topic: Frustration from Missing Actionable Plans
Full Topic: Why teams experience frustration when they fail to create actionable plans and how structured processes improve execution.

## 4. CAMPAIGN MODE LOGIC

### A. QUICK_LAUNCH MODE
* One message/s can be distributed on multiple platforms on the SAME DAY.
* Focus on reach and speed.
* Minimal staggering — but still spread across several days in the week, not just one day.

### B. STRATEGIC MODE (Default) — TREND + PLATFORM DISTRIBUTION RULES

* Stagger content across the week.
* Avoid posting same content type repeatedly.
* Respect platform behaviour and audience mindset.
* Spread high-effort content intelligently.

** TREND + PLATFORM DISTRIBUTION RULES (apply when assigning day_index):
* LinkedIn → Professional insights, case studies, thought leadership (Tue–Thu preferred; day_index 2, 3, 4)
* YouTube → Long-form video and educational content (Thu–Sat preferred; 4, 5, 6)
* Instagram/Facebook → Reels, engagement, storytelling (Wed–Sun strong; 3, 4, 5, 6, 7)
* X/Twitter → Short insights, micro-thoughts (can be frequent; spread across week)
* Blog/Website → Deep educational content (early or mid-week; 1, 2, 3)

## 5. HOLIDAY / FESTIVAL / REGIONAL CULTURE (VERY IMPORTANT)

Before assigning daily content, detect:
* National holidays, regional holidays, cultural festivals, observance days relevant to target region.

Apply:
* Reduce heavy educational content on major festivals.
* Prefer emotional, celebratory, or community-focused content on festivals.
* Avoid strong sales CTAs during sensitive cultural or religious occasions.
* If a festival aligns with campaign theme → integrate it naturally.
* If holiday reduces engagement → schedule lighter or scheduled content.
* Cultural sensitivity: respect local tone and sentiment; avoid culturally inappropriate themes.

If a holiday affects a day, set festival_consideration for that slot.

## 6. CONTENT FATIGUE PREVENTION

Do NOT:
* Post same content type more than 2 days in a row.
* Overload a single platform continuously.
* Schedule multiple heavy assets back-to-back.

## 7. CONTENT CASCADE STRATEGY (REUSE INTELLIGENTLY)

When possible, reuse content across platforms strategically across different days, e.g.:
* Day 1 (Mon) → YouTube video
* Day 2 (Tue) → LinkedIn summary post
* Day 3 (Wed) → Short reel clip
* Day 4 (Thu) → Quote graphic or poll

Spread across the week; do not put all on one day.

## 8. CAMPAIGN ENERGY CURVE

* Awareness phase → higher reach + frequent posting (spread across days)
* Education phase → deeper content, moderate frequency
* Conversion phase → CTA-focused content
* Cool-down phase → lighter engagement content

## 9. OUTPUT FORMAT (STRICT JSON)

Respond with a single JSON object only (no markdown, no code fence):
{
  "daily_plan": [
    {
      "day_index": 2,
      "day_name": "Tuesday",
      "short_topic": "6-8 word summary",
      "full_topic": "Full expandable description.",
      "content_type": "post",
      "platform": "linkedin",
      "reasoning": "Brief distribution reasoning.",
      "festival_consideration": "If any, else omit or null."
    }
  ]
}

Rules:
* day_index 1 (Monday) through 7 (Sunday). Use the full range; do NOT use only day_index 1.
* Output as many slots as there are logical content pieces (at least one per weekly topic). Each slot MUST have a different day_index where possible.
* Each slot: short_topic 6–8 words; full_topic longer; content_type; platform; reasoning; optional festival_consideration.

## 10. SMART BEHAVIOUR

* Think like a senior content strategist, not a scheduler.
* Make distribution feel organic and human.
* If a holiday exists, explain in festival_consideration why content was adjusted.
* Balance visibility, engagement, and audience energy.
* Output should be ready to plug into a calendar system.`;

function buildUserPrompt(input: GenerateDailyDistributionInput): string {
  const week = input.weekBlueprint;
  const topics =
    (Array.isArray(week.topics)
      ? (week.topics as any[]).map((t: any) => t?.topicTitle ?? t).filter(Boolean)
      : []) as string[] ||
    (week.topics_to_cover ?? []).filter((t): t is string => typeof t === 'string') ||
    [];
  const theme = week.phase_label || week.primary_objective || `Week ${input.weekNumber}`;
  const contentTypes =
    (input.contentTypesAvailable?.length ?? 0) > 0
      ? input.contentTypesAvailable
      : (week.content_type_mix ?? ['post', 'video', 'article', 'reel', 'carousel', 'poll']);
  const region = input.targetRegion ?? 'Not specified';
  const mode = input.campaignMode ?? 'STRATEGIC';

  const topicList = topics.length ? topics : [`Week ${input.weekNumber} theme`];
  const minSlots = Math.max(3, topicList.length, 5);

  return JSON.stringify(
    {
      weekly_campaign_goal: theme,
      weekly_topics: topicList,
      content_themes: theme,
      content_types_available: Array.isArray(contentTypes) ? contentTypes : [contentTypes],
      target_region: region,
      campaign_mode: mode,
      campaign_name: input.campaignName ?? '',
      week_number: input.weekNumber,
      campaign_start_date: input.campaignStartDate ?? null,
      minimum_slots: minSlots,
      distribution_instruction:
        `Generate at least ${minSlots} slots (one per topic or topic+platform/type combo). Assign each slot to a DIFFERENT day_index (1=Mon … 7=Sun). Do NOT assign all slots to Monday (day_index 1). Spread across the week using platform rules: LinkedIn Tue–Thu, YouTube Thu–Sat, Instagram/Facebook Wed–Sun, Blog early/mid-week. Consider target_region holidays/festivals.`,
    },
    null,
    2
  );
}

function parseDayNameToIndex(dayName: string): number {
  const d = DAY_NAMES.indexOf(dayName);
  return d >= 0 ? d + 1 : 1;
}

/**
 * Generates a daily content distribution plan for the given week using the AI Content Distribution Planner.
 * Returns an array of daily slots (one or more per day) that can be mapped to DailyPlanItem for persistence.
 */
export async function generateDailyDistributionPlan(
  input: GenerateDailyDistributionInput
): Promise<DailyDistributionSlot[]> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await callDistributionLLM({
    companyId: input.companyId ?? null,
    model,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(input) },
    ],
  });

  let raw = response?.output;
  // Handle string output (e.g. gateway passed through raw content)
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    try {
      raw = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      throw new Error('Daily distribution plan response was not valid JSON');
    }
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Daily distribution plan response was not an object');
  }

  const dailyPlan =
    Array.isArray((raw as any).daily_plan) ? (raw as any).daily_plan
    : Array.isArray((raw as any).slots) ? (raw as any).slots
    : Array.isArray((raw as any).plan) ? (raw as any).plan
    : Array.isArray((raw as any).items) ? (raw as any).items
    : Array.isArray(raw) ? raw
    : null;
  if (!Array.isArray(dailyPlan) || dailyPlan.length === 0) {
    throw new Error('Daily distribution plan returned no daily_plan array');
  }

  let slots: DailyDistributionSlot[] = dailyPlan.map((item: any) => ({
    day_index: Math.min(7, Math.max(1, Number(item.day_index) || parseDayNameToIndex(String(item.day_name ?? item.day ?? 'Monday')))),
    day_name: DAY_NAMES[(Number(item.day_index) || 1) - 1] ?? String(item.day_name ?? item.day ?? 'Monday'),
    short_topic: String(item.short_topic ?? item.shortTopic ?? '').trim() || String(item.full_topic ?? item.fullTopic ?? '').trim().slice(0, 80),
    full_topic: String(item.full_topic ?? item.fullTopic ?? item.short_topic ?? item.shortTopic ?? '').trim(),
    content_type: String(item.content_type ?? item.contentType ?? 'post').toLowerCase().trim(),
    platform: String(item.platform ?? 'linkedin').toLowerCase().replace(/^twitter$/i, 'x').trim(),
    reasoning: String(item.reasoning ?? '').trim(),
    festival_consideration: item.festival_consideration != null ? String(item.festival_consideration).trim() : undefined,
  }));

  const week = input.weekBlueprint;
  const topicList: string[] =
    (Array.isArray(week.topics)
      ? (week.topics as any[]).map((t: any) => String(t?.topicTitle ?? t ?? '').trim()).filter(Boolean)
      : []) as string[] ||
    (Array.isArray(week.topics_to_cover) ? week.topics_to_cover.filter((t): t is string => typeof t === 'string') : []) ||
    [];

  if (slots.length === 1 && topicList.length > 1) {
    const template = slots[0]!;
    slots = topicList.map((topic, i) => ({
      ...template,
      short_topic: topic.split(/\s+/).slice(0, 8).join(' ').trim() || template.short_topic,
      full_topic: template.full_topic ? `${topic}. ${template.full_topic}` : topic,
      day_index: 1,
      day_name: 'Monday',
    }));
  }

  let appliedForceSpread = false;
  const allSameDay = slots.length > 0 && new Set(slots.map((s) => s.day_index)).size === 1;
  if (slots.length > 1 && allSameDay) {
    slots = slots.map((slot, i) => {
      const dayIndex = (i % 7) + 1;
      return { ...slot, day_index: dayIndex, day_name: DAY_NAMES[dayIndex - 1]! };
    });
    appliedForceSpread = true;
  }

  const mode: DistributionMode = input.distributionMode === 'same_day_per_topic' ? 'same_day_per_topic' : 'staggered';

  if (slots.length > 1 && !appliedForceSpread) {
    if (mode === 'same_day_per_topic') {
      // Group by topic; assign one day per topic, but SPREAD those days across the week (e.g. 2 topics → Mon & Fri, not Mon & Tue)
      const topicToSlots = new Map<string, DailyDistributionSlot[]>();
      slots.forEach((slot, idx) => {
        const raw = (slot.short_topic || slot.full_topic || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const key = raw || `slot-${idx}`;
        const arr = topicToSlots.get(key) ?? [];
        arr.push(slot);
        topicToSlots.set(key, arr);
      });
      const orderedTopics = Array.from(topicToSlots.keys());
      const numTopics = orderedTopics.length;
      // Spread topic-days across the week: 1 topic→Wed(4), 2→Mon&Fri(1,5), 3→Mon,Wed,Fri(1,3,5), etc.
      const spreadDayIndices: number[] = [];
      for (let i = 0; i < numTopics; i++) {
        const dayIndex =
          numTopics <= 1
            ? 4
            : Math.min(7, Math.max(1, 1 + Math.round((i / (numTopics - 1)) * 6)));
        spreadDayIndices.push(dayIndex);
      }
      const out: DailyDistributionSlot[] = [];
      orderedTopics.forEach((topicKey, topicIdx) => {
        const dayIndex = spreadDayIndices[topicIdx] ?? (topicIdx % 7) + 1;
        const dayName = DAY_NAMES[dayIndex - 1]!;
        const group = topicToSlots.get(topicKey) ?? [];
        for (const slot of group) {
          out.push({ ...slot, day_index: dayIndex, day_name: dayName });
        }
      });
      slots = out;
    } else {
      // Staggered: same topic can appear on different days (round-robin by slot)
      slots = slots.map((slot, i) => {
        const dayIndex = (i % 7) + 1;
        return { ...slot, day_index: dayIndex, day_name: DAY_NAMES[dayIndex - 1]! };
      });
    }
  }

  return slots;
}
