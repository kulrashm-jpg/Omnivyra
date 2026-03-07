/**
 * AI Content Distribution Planner: generates day-wise content distribution from a weekly campaign plan.
 * Uses the full distribution logic: topic format (short 6–8 words + full), campaign mode (QUICK_LAUNCH vs STRATEGIC),
 * platform rules, holiday/culture, content fatigue prevention, cascade strategy, and energy curve.
 */

import { generateDailyDistributionPlan as callDistributionLLM } from './aiGateway';
import { refineLanguageOutput } from './languageRefinementService';
import type { CampaignContext } from './contextCompressionService';
import {
  getDailyDistributionSystemPrompt,
  PROMPT_REGISTRY,
  generatePromptFingerprint,
  type DailyDistributionPromptContext,
} from '../prompts';
import { normalizeSlotsToCount } from './weeklySlotNormalization';
import { allocatePlatforms } from './platformAllocationEngine';
import { expandRepurposeGraph } from './repurposeGraphEngine';
import { assignPostingTimes } from './schedulingEngine';
import { applyBoltOptimizations } from './boltOptimizationService';
import { getStrategyMemory } from './campaignStrategyMemoryService';
import { validateDailySlots } from './aiOutputValidationService';
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
  /** Assigned by Scheduling Intelligence Engine (HH:MM) */
  time?: string;
  /** When true, strategic anchor content amplifies more aggressively. Inferred from content_type if absent. */
  is_anchor_content?: boolean;
}

export interface GenerateDailyDistributionInput {
  companyId?: string | null;
  campaignId: string;
  weekNumber: number;
  weekBlueprint: CampaignBlueprintWeek;
  /** For bolt pipeline observability: correlate AI calls to bolt_execution_runs. */
  bolt_run_id?: string | null;
  campaignName?: string;
  campaignStartDate?: string;
  targetRegion?: string | null;
  campaignMode?: CampaignMode;
  contentTypesAvailable?: string[];
  /** Staggered = spread by slot across days. Same day = one topic → one day, all content types that day. */
  distributionMode?: DistributionMode;
  /** When set, only use these platforms (from company profile social_links). */
  eligiblePlatforms?: string[];
  /** Historical performance insights to bias platform/content distribution. */
  companyPerformanceInsights?: {
    high_performing_platforms?: Array<{ value: string; avgEngagement: number; signalCount: number }>;
    high_performing_content_types?: Array<{ value: string; avgEngagement: number; signalCount: number }>;
    low_performing_patterns?: Array<{ platform?: string; content_type?: string; theme?: string; reason: string }>;
  };
  /** BOLT Post Density: exact slot count. When set, AI generates this many slots; output is normalized to match. */
  postsPerWeek?: number;
  /** Compressed context for LLM reuse; when provided, replaces full companyPerformanceInsights in prompt. */
  compressedContext?: CampaignContext;
  /** When true (BOLT), restrict to text content only; exclude video, carousel, reel from repurpose targets. */
  boltTextOnly?: boolean;
}

/** Default content-type distribution: Posts 50–60%, Blogs 20–25%, Short articles 10–15%, Stories remainder. */
export const DEFAULT_CONTENT_TYPE_RATIOS: Record<string, { min: number; max: number }> = {
  post: { min: 50, max: 60 },
  blog: { min: 20, max: 25 },
  article: { min: 10, max: 15 },
  story: { min: 5, max: 15 },
};

/** Learning layer: adjust content-type ratios based on historical performance. Bias toward high performers. */
function getAdjustedContentTypeRatios(
  base: Record<string, { min: number; max: number }>,
  highPerformers?: Array<{ value: string; avgEngagement: number; signalCount: number }>
): Record<string, { min: number; max: number }> {
  if (!highPerformers?.length) return { ...base };
  const adjusted: Record<string, { min: number; max: number }> = {};
  for (const [k, v] of Object.entries(base)) adjusted[k] = { ...v };
  const typeMap: Record<string, string> = { video: 'post', reel: 'story', carousel: 'post', poll: 'post' };
  for (const p of highPerformers.slice(0, 3)) {
    const t = p.value.toLowerCase();
    const key = t in base ? t : typeMap[t] ?? t;
    if (key in adjusted) {
      const curr = adjusted[key];
      adjusted[key] = {
        min: Math.min(70, curr.min + 5),
        max: Math.min(80, curr.max + 10),
      };
    }
  }
  return adjusted;
}

/**
 * Derive platform time overrides from company performance insights.
 * When engagement is highest for a platform (e.g. linkedin 10–12), override to optimal time.
 * Uses top high-performing platform with 11:00 prime-time placeholder when time-of-day signals unavailable.
 */
function buildPlatformTimeOverrides(
  insights?: GenerateDailyDistributionInput['companyPerformanceInsights']
): Record<string, string> {
  const top = insights?.high_performing_platforms?.[0]?.value;
  if (!top) return {};
  const platform = top.toLowerCase().replace(/^twitter$/, 'x');
  return { [platform]: '11:00' };
}

/** Platform capacity limits to prevent overposting. */
export const PLATFORM_CAPACITY_LIMITS: Record<
  string,
  { per_day?: number; per_week?: number }
> = {
  linkedin: { per_day: 1 },
  instagram: { per_day: 2 },
  facebook: { per_day: 2 },
  youtube: { per_week: 2 },
  x: { per_day: 3 },
  tiktok: { per_day: 2 },
  reddit: { per_day: 1 },
};

function applyPlatformCapacityLimits(slots: DailyDistributionSlot[]): DailyDistributionSlot[] {
  const limits = PLATFORM_CAPACITY_LIMITS;
  const byPlatformDay = new Map<string, DailyDistributionSlot[]>();
  const byPlatform = new Map<string, DailyDistributionSlot[]>();

  for (const slot of slots) {
    const p = slot.platform?.toLowerCase().replace(/^twitter$/i, 'x') ?? 'linkedin';
    const key = `${p}|${slot.day_index}`;
    const arr = byPlatformDay.get(key) ?? [];
    arr.push(slot);
    byPlatformDay.set(key, arr);

    const arrP = byPlatform.get(p) ?? [];
    arrP.push(slot);
    byPlatform.set(p, arrP);
  }

  const keep = new Set<DailyDistributionSlot>();
  for (const [key, list] of byPlatformDay) {
    const [platform] = key.split('|');
    const limit = limits[platform]?.per_day;
    if (typeof limit === 'number' && limit > 0) {
      list.slice(0, limit).forEach((s) => keep.add(s));
    } else {
      list.forEach((s) => keep.add(s));
    }
  }

  for (const [platform, list] of byPlatform) {
    const limit = limits[platform]?.per_week;
    if (typeof limit === 'number' && limit > 0) {
      const kept = list.filter((s) => keep.has(s));
      if (kept.length > limit) {
        kept.slice(limit).forEach((s) => keep.delete(s));
      }
    }
  }

  return slots.filter((s) => keep.has(s));
}

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

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
  const postsPerWeek = input.postsPerWeek != null
    ? Math.max(2, Math.min(7, Math.floor(input.postsPerWeek)))
    : null;
  const minSlots = postsPerWeek ?? Math.max(3, topicList.length, 5);

  const eligiblePlatforms = Array.isArray(input.eligiblePlatforms) && input.eligiblePlatforms.length > 0
    ? input.eligiblePlatforms.map((p) => p.toLowerCase().replace(/^twitter$/i, 'x'))
    : null;

  const compressedCtx = input.compressedContext;
  const perf = input.companyPerformanceInsights;
  const companyPerformanceInsights =
    !compressedCtx &&
    perf &&
    (perf.high_performing_platforms?.length ||
      perf.high_performing_content_types?.length ||
      perf.low_performing_patterns?.length)
      ? {
          high_performing_platforms: perf.high_performing_platforms ?? [],
          high_performing_content_types: perf.high_performing_content_types ?? [],
          low_performing_patterns: perf.low_performing_patterns ?? [],
        }
      : null;

  const performanceMixSuffix = compressedCtx
    ? (compressedCtx.top_content_types?.length || compressedCtx.top_platforms?.length)
      ? ` Content-type guidance: favor ${(compressedCtx.top_content_types ?? []).slice(0, 3).join(', ') || 'post, video, article'}. Top platforms: ${(compressedCtx.top_platforms ?? []).slice(0, 3).join(', ') || 'linkedin, x'}.`
      : ''
    : companyPerformanceInsights
      ? (() => {
          const topTypes = (companyPerformanceInsights.high_performing_content_types ?? []).slice(0, 3);
          const parts: string[] = [];
          if (topTypes.length)
            parts.push(`Content-type guidance: favor ${topTypes.map((t) => t.value).join(', ')}.`);
          const low = (companyPerformanceInsights.low_performing_patterns ?? []).slice(0, 2);
          if (low.length)
            parts.push(`Reduce (do not eliminate): ${low.map((l) => l.content_type || l.platform || l.theme).filter(Boolean).join(', ')}.`);
          return parts.length ? ` ${parts.join(' ')}` : '';
        })()
      : '';
  const eligiblePlatformsForContext = eligiblePlatforms
    ? { eligible_platforms: eligiblePlatforms }
    : {};
  const highPerformingTypes = compressedCtx?.top_content_types?.length
    ? compressedCtx.top_content_types.slice(0, 3).map((v) => ({ value: v, avgEngagement: 0, signalCount: 0 }))
    : companyPerformanceInsights?.high_performing_content_types;
  const contentTypeRatios = getAdjustedContentTypeRatios(
    DEFAULT_CONTENT_TYPE_RATIOS,
    highPerformingTypes
  );
  const distributionInstruction = postsPerWeek != null
    ? `CRITICAL: The weekly plan must contain exactly ${postsPerWeek} slots. Generate exactly ${postsPerWeek} content slots. Assign each slot to a DIFFERENT day_index (1=Mon … 7=Sun). Do NOT assign all slots to Monday (day_index 1). Spread across the week. Consider target_region holidays/festivals.${performanceMixSuffix}`
    : `Generate at least ${minSlots} slots (one per topic or topic+content_type combo). Assign each slot to a DIFFERENT day_index (1=Mon … 7=Sun). Do NOT assign all slots to Monday (day_index 1). Spread across the week. Consider target_region holidays/festivals.${performanceMixSuffix}`;

  if (compressedCtx) {
    const ctx: DailyDistributionPromptContext = {
      ...compressedCtx,
      weekly_topics: topicList,
      week_number: input.weekNumber,
      theme,
      content_types_available: Array.isArray(contentTypes) ? contentTypes : [contentTypes],
      target_region: region,
      campaign_mode: mode,
      campaign_name: input.campaignName ?? '',
      campaign_start_date: input.campaignStartDate ?? null,
      minimum_slots: minSlots,
      distribution_instruction: distributionInstruction,
      content_type_ratios: contentTypeRatios,
      ...(eligiblePlatforms ? { eligible_platforms: eligiblePlatforms } : {}),
      ...(postsPerWeek != null ? { exact_slots: postsPerWeek } : {}),
    };
    const entry = PROMPT_REGISTRY.daily_distribution;
    const prompt = entry.build(ctx);
    const fingerprint = generatePromptFingerprint(prompt);
    console.info('Prompt executed', { prompt: entry.metadata.name, version: entry.metadata.version, fingerprint });
    return prompt;
  }

  const payload: Record<string, unknown> = {
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
    ...eligiblePlatformsForContext,
    distribution_instruction: distributionInstruction,
    content_type_ratios: contentTypeRatios,
  };
  if (companyPerformanceInsights) {
    payload.company_performance_insights = companyPerformanceInsights;
  }
  if (postsPerWeek != null) payload.exact_slots = postsPerWeek;

  return JSON.stringify(payload, null, 2);
}

function parseDayNameToIndex(dayName: string): number {
  const d = DAY_NAMES.indexOf(dayName);
  return d >= 0 ? d + 1 : 1;
}

const BATCH_WEEK_SIZE = 4;

function buildBatchUserPrompt(inputs: GenerateDailyDistributionInput[]): string {
  const weeks = inputs.map((input) => {
    const prompt = JSON.parse(buildUserPrompt(input));
    return { week_number: input.weekNumber, ...prompt };
  });
  return JSON.stringify({
    mode: 'batch',
    weeks,
    output_format: Object.fromEntries(
      inputs.map((i) => [`week_${i.weekNumber}`, { daily_plan: '<array of slots for this week>' }])
    ),
  }, null, 2);
}

function parseSlotsFromRawPlan(raw: unknown): DailyDistributionSlot[] {
  const dailyPlan =
    Array.isArray((raw as any)?.daily_plan) ? (raw as any).daily_plan
    : Array.isArray((raw as any)?.slots) ? (raw as any).slots
    : Array.isArray((raw as any)?.plan) ? (raw as any).plan
    : Array.isArray((raw as any)?.items) ? (raw as any).items
    : Array.isArray(raw) ? raw
    : null;
  if (!Array.isArray(dailyPlan) || dailyPlan.length === 0) return [];
  return dailyPlan.map((item: any) => ({
    day_index: Math.min(7, Math.max(1, Number(item.day_index) || parseDayNameToIndex(String(item.day_name ?? item.day ?? 'Monday')))),
    day_name: DAY_NAMES[(Number(item.day_index) || 1) - 1] ?? String(item.day_name ?? item.day ?? 'Monday'),
    short_topic: String(item.short_topic ?? item.shortTopic ?? '').trim() || String(item.full_topic ?? item.fullTopic ?? '').trim().slice(0, 80),
    full_topic: String(item.full_topic ?? item.fullTopic ?? item.short_topic ?? item.shortTopic ?? '').trim(),
    content_type: String(item.content_type ?? item.contentType ?? 'post').toLowerCase().trim(),
    platform: String(item.platform ?? '').trim() ? String(item.platform).toLowerCase().replace(/^twitter$/i, 'x').trim() : '',
    reasoning: String(item.reasoning ?? '').trim(),
    festival_consideration: item.festival_consideration != null ? String(item.festival_consideration).trim() : undefined,
  }));
}

async function runBatchDistribution(
  batch: GenerateDailyDistributionInput[],
  batchSystem: string
): Promise<Map<number, DailyDistributionSlot[]>> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const boltRunId = batch[0]?.bolt_run_id ?? null;
  const response = await callDistributionLLM({
    companyId: batch[0]?.companyId ?? null,
    campaignId: batch[0]?.campaignId ?? null,
    model,
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: batchSystem },
      { role: 'user', content: buildBatchUserPrompt(batch) },
    ],
    ...(boltRunId ? { bolt_run_id: boltRunId } : {}),
  });
  let raw = response?.output;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    raw = JSON.parse(trimmed || '{}') as Record<string, unknown>;
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('Batch response was not an object');
  }
  const result = new Map<number, DailyDistributionSlot[]>();
  for (const input of batch) {
    const wn = input.weekNumber;
    const key = `week_${wn}`;
    const weekRaw = (raw as Record<string, unknown>)[key] ?? (raw as Record<string, unknown>)[String(wn)];
    let slots = parseSlotsFromRawPlan(weekRaw);
    if (slots.length === 0) {
      slots = await generateDailyDistributionPlan(input);
    } else {
      slots = await processSlotsForWeek(slots, input);
    }
    result.set(wn, slots);
  }
  return result;
}

/**
 * Generates daily distribution plans for multiple weeks in one LLM call.
 * Retry: batch once → split into two smaller batches → per-week fallback.
 */
export async function generateDailyDistributionPlanBatch(
  inputs: GenerateDailyDistributionInput[]
): Promise<Map<number, DailyDistributionSlot[]>> {
  if (DAILY_DISTRIBUTION_DISABLED) {
    throw new Error(
      'Daily distribution is disabled. Schedule must come from weekly plan (execution_items with day_index).'
    );
  }
  if (inputs.length === 0) return new Map();
  if (inputs.length === 1) {
    const slots = await generateDailyDistributionPlan(inputs[0]!);
    return new Map([[inputs[0]!.weekNumber, slots]]);
  }
  const batch = inputs.slice(0, BATCH_WEEK_SIZE);
  const baseSystem = getDailyDistributionSystemPrompt();
  const batchSystem = `${baseSystem}\n\n## BATCH MODE: You will receive multiple weeks. Respond with ONE JSON object: { "week_1": { "daily_plan": [...] }, "week_2": { "daily_plan": [...] }, ... }. Use week_N keys matching the week_number in each input.`;

  const tryBatch = async (b: GenerateDailyDistributionInput[]): Promise<Map<number, DailyDistributionSlot[]>> => {
    return runBatchDistribution(b, b.length === 1 ? baseSystem : batchSystem);
  };

  try {
    return await tryBatch(batch);
  } catch (err1) {
    console.warn('[dailyContentDistributionPlanService][batch-retry]', { error: String(err1) });
    try {
      return await tryBatch(batch);
    } catch (err2) {
      console.warn('[dailyContentDistributionPlanService][batch-split]', { error: String(err2) });
      if (batch.length <= 2) {
        const result = new Map<number, DailyDistributionSlot[]>();
        for (const input of batch) {
          const slots = await generateDailyDistributionPlan(input);
          result.set(input.weekNumber, slots);
        }
        return result;
      }
      const mid = Math.ceil(batch.length / 2);
      const firstHalf = batch.slice(0, mid);
      const secondHalf = batch.slice(mid);
      try {
        const result = new Map<number, DailyDistributionSlot[]>();
        if (firstHalf.length > 0) {
          const r1 = firstHalf.length === 1
            ? new Map([[firstHalf[0]!.weekNumber, await generateDailyDistributionPlan(firstHalf[0]!)]])
            : await tryBatch(firstHalf);
          r1.forEach((v, k) => result.set(k, v));
        }
        if (secondHalf.length > 0) {
          const r2 = secondHalf.length === 1
            ? new Map([[secondHalf[0]!.weekNumber, await generateDailyDistributionPlan(secondHalf[0]!)]])
            : await tryBatch(secondHalf);
          r2.forEach((v, k) => result.set(k, v));
        }
        return result;
      } catch (err3) {
        console.warn('[dailyContentDistributionPlanService][batch-fallback]', { error: String(err3) });
        const result = new Map<number, DailyDistributionSlot[]>();
        for (const input of batch) {
          const slots = await generateDailyDistributionPlan(input);
          result.set(input.weekNumber, slots);
        }
        return result;
      }
    }
  }
}

async function processSlotsForWeek(
  slots: DailyDistributionSlot[],
  input: GenerateDailyDistributionInput
): Promise<DailyDistributionSlot[]> {
  const week = input.weekBlueprint;
  const topicList: string[] =
    (Array.isArray(week.topics)
      ? (week.topics as any[]).map((t: any) => String(t?.topicTitle ?? t ?? '').trim()).filter(Boolean)
      : []) as string[] ||
    (Array.isArray(week.topics_to_cover) ? week.topics_to_cover.filter((t): t is string => typeof t === 'string') : []) ||
    [];
  if (slots.length === 1 && topicList.length > 1) {
    const template = slots[0]!;
    slots = topicList.map((topic) => ({
      ...template,
      short_topic: topic.split(/\s+/).slice(0, 8).join(' ').trim() || template.short_topic,
      full_topic: template.full_topic ? `${topic}. ${template.full_topic}` : topic,
      day_index: 1,
      day_name: 'Monday',
    }));
  }
  let appliedForceSpread = false;
  const allSameDay = slots.length > 1 && new Set(slots.map((s) => s.day_index)).size === 1;
  if (slots.length > 1 && allSameDay) {
    slots = slots.map((slot, i) => ({
        ...slot,
        day_index: (i % 7) + 1,
        day_name: DAY_NAMES[i % 7] ?? 'Monday',
      }));
    appliedForceSpread = true;
  }
  const mode: DistributionMode = input.distributionMode === 'same_day_per_topic' ? 'same_day_per_topic' : 'staggered';
  if (slots.length > 1 && !appliedForceSpread) {
    if (mode === 'same_day_per_topic') {
      const topicToSlots = new Map<string, DailyDistributionSlot[]>();
      slots.forEach((slot, idx) => {
        const key = (slot.short_topic || slot.full_topic || '').toLowerCase().replace(/\s+/g, ' ').trim() || `slot-${idx}`;
        const arr = topicToSlots.get(key) ?? [];
        arr.push(slot);
        topicToSlots.set(key, arr);
      });
      const orderedTopics = Array.from(topicToSlots.keys());
      const numTopics = orderedTopics.length;
      const spreadDayIndices: number[] = [];
      for (let i = 0; i < numTopics; i++) {
        spreadDayIndices.push(
          numTopics <= 1 ? 4 : Math.min(7, Math.max(1, 1 + Math.round((i / (numTopics - 1)) * 6)))
        );
      }
      const out: DailyDistributionSlot[] = [];
      orderedTopics.forEach((topicKey, topicIdx) => {
        const dayIndex = spreadDayIndices[topicIdx] ?? (topicIdx % 7) + 1;
        const dayName = DAY_NAMES[dayIndex - 1]!;
        (topicToSlots.get(topicKey) ?? []).forEach((slot) => out.push({ ...slot, day_index: dayIndex, day_name: dayName }));
      });
      slots = out;
    } else {
      slots = slots.map((slot, i) => ({
        ...slot,
        day_index: (i % 7) + 1,
        day_name: DAY_NAMES[i % 7] ?? 'Monday',
      }));
    }
  }
  for (const slot of slots) {
    if (slot.short_topic?.trim()) {
      const r = await refineLanguageOutput({ content: slot.short_topic, card_type: 'daily_slot' });
      slot.short_topic = (r.refined as string) || slot.short_topic;
    }
    if (slot.full_topic?.trim()) {
      const r = await refineLanguageOutput({ content: slot.full_topic, card_type: 'daily_slot' });
      slot.full_topic = (r.refined as string) || slot.full_topic;
    }
  }
  const postsPerWeek = input.postsPerWeek != null ? Math.max(2, Math.min(7, Math.floor(input.postsPerWeek))) : null;
  if (postsPerWeek != null && slots.length !== postsPerWeek) {
    const primaryPlatform = input.eligiblePlatforms?.[0] ?? 'linkedin';
    const weeklyTheme =
      String((week as any)?.phase_label ?? (week as any)?.theme ?? '').trim() ||
      (topicList[0] ?? '').trim() ||
      String((week as any)?.primary_objective ?? '').trim() ||
      undefined;
    slots = normalizeSlotsToCount(slots, postsPerWeek, (dayIndex, dayName, _index, theme) => {
      const { short_topic: st, full_topic: ft } = theme
        ? { short_topic: `${theme} insight`, full_topic: `A key insight related to ${theme}` }
        : { short_topic: 'Campaign insight', full_topic: 'Insight related to the campaign theme' };
      return {
        day_index: dayIndex,
        day_name: dayName,
        short_topic: st,
        full_topic: ft,
        content_type: 'post',
        platform: primaryPlatform.toLowerCase().replace(/^twitter$/i, 'x'),
        reasoning: '',
      };
    }, weeklyTheme);
  }
  const highPerformingTypesResolved = input.compressedContext?.top_content_types?.length
    ? input.compressedContext.top_content_types
    : input.companyPerformanceInsights?.high_performing_content_types?.map((p) => p.value);
  const lowPerformingTypesResolved = input.companyPerformanceInsights?.low_performing_patterns
    ?.filter((p) => p.content_type)
    ?.map((p) => p.content_type!);
  const highPerformingPlatformsAsStrings =
    input.compressedContext?.top_platforms ??
    input.companyPerformanceInsights?.high_performing_platforms?.map((p) => p.value);
  const densityLevel =
    postsPerWeek != null
      ? postsPerWeek <= 3
        ? ('low' as const)
        : postsPerWeek <= 5
          ? ('normal' as const)
          : ('high' as const)
      : 'normal';
  slots = slots.map((slot) => {
    if (slot.is_anchor_content != null) return slot;
    const ct = (slot.content_type ?? '').trim().toLowerCase();
    return {
      ...slot,
      is_anchor_content: ct === 'blog' || ct === 'article' || ct === 'long_video',
    };
  });
  slots = expandRepurposeGraph(slots, {
    densityLevel,
    highPerformingTypes: highPerformingTypesResolved,
    lowPerformingTypes: lowPerformingTypesResolved,
    eligiblePlatforms: input.eligiblePlatforms,
    companyPerformanceInsights:
      highPerformingPlatformsAsStrings?.length
        ? { high_performing_platforms: highPerformingPlatformsAsStrings }
        : undefined,
    signals: {
      high_performing_platforms: highPerformingPlatformsAsStrings,
      high_performing_content_types: highPerformingTypesResolved,
      low_performing_patterns: lowPerformingTypesResolved,
    },
    boltTextOnly: input.boltTextOnly,
  });
  let strategyPreferredPlatforms: string[] = [];
  if (input.companyId) {
    try {
      const memory = await getStrategyMemory(input.companyId);
      strategyPreferredPlatforms = memory?.preferred_platforms ?? [];
    } catch {
      // Optional; proceed without strategy memory
    }
  }
  const mergedPlatforms = [
    ...strategyPreferredPlatforms,
    ...(input.eligiblePlatforms ?? []),
  ].filter(Boolean);
  const highPerformingPlatformsResolved = input.compressedContext?.top_platforms?.length
    ? input.compressedContext.top_platforms.map((v) => ({ value: v, avgEngagement: 0, signalCount: 0 }))
    : input.companyPerformanceInsights?.high_performing_platforms;
  const highPerformingContentTypesResolved = input.compressedContext?.top_content_types?.length
    ? input.compressedContext.top_content_types.map((v) => ({ value: v, avgEngagement: 0, signalCount: 0 }))
    : input.companyPerformanceInsights?.high_performing_content_types;
  slots = allocatePlatforms(slots, {
    companyPreferredPlatforms: mergedPlatforms.length > 0 ? mergedPlatforms : input.eligiblePlatforms,
    highPerformingPlatforms: highPerformingPlatformsResolved?.map((p) => p.value),
  });
  slots = applyBoltOptimizations(slots, {
    high_performing_platforms: highPerformingPlatformsResolved,
    high_performing_content_types: highPerformingContentTypesResolved,
    low_performing_patterns: input.companyPerformanceInsights?.low_performing_patterns,
  });
  const perfForTimeOverrides = highPerformingPlatformsResolved?.[0]
    ? { high_performing_platforms: highPerformingPlatformsResolved }
    : input.companyPerformanceInsights;
  const platformTimeOverrides = buildPlatformTimeOverrides(perfForTimeOverrides);
  slots = assignPostingTimes(slots, { platformTimeOverrides });
  slots = applyPlatformCapacityLimits(slots);
  return slots;
}

/** Phase 1: DISABLED. Schedule (day_index) comes from weekly plan only. Daily layer does not assign day/time. */
const DAILY_DISTRIBUTION_DISABLED = true;

/**
 * Generates a daily content distribution plan for the given week using the AI Content Distribution Planner.
 * Returns an array of daily slots (one or more per day) that can be mapped to DailyPlanItem for persistence.
 * @deprecated Phase 1: Disabled. Use weekly plan execution_items with day_index instead.
 */
export async function generateDailyDistributionPlan(
  input: GenerateDailyDistributionInput
): Promise<DailyDistributionSlot[]> {
  if (DAILY_DISTRIBUTION_DISABLED) {
    throw new Error(
      'Daily distribution is disabled. Schedule must come from weekly plan (execution_items with day_index).'
    );
  }
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const dailyEntry = PROMPT_REGISTRY.daily_distribution;
  const response = await callDistributionLLM({
    companyId: input.companyId ?? null,
    campaignId: input.campaignId ?? null,
    model,
    temperature: dailyEntry.metadata.temperature ?? 0.4,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: getDailyDistributionSystemPrompt() },
      { role: 'user', content: buildUserPrompt(input) },
    ],
    ...(input.bolt_run_id ? { bolt_run_id: input.bolt_run_id } : {}),
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

  const slots = parseSlotsFromRawPlan(raw);
  if (slots.length === 0) {
    throw new Error('Daily distribution plan returned no daily_plan array');
  }
  const validatedSlots = validateDailySlots(slots);
  return processSlotsForWeek(validatedSlots, input);
}
