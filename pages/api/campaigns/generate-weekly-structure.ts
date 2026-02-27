import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

import { getUnifiedCampaignBlueprint } from '../../../backend/services/campaignBlueprintService';
import {
  enrichDailyItemWithPlatformRequirements,
  validateDailyItemAgainstPlatformRules,
} from '../../../backend/services/platformExecutionValidator';
import {
  analyzeValidationResults,
  generatePlanningFeedback,
} from '../../../backend/services/campaignExecutionFeedbackService';
import { getPlatformRules } from '../../../backend/services/platformIntelligenceService';
import {
  analyzeExecutionFeedback,
  suggestPublishingStrategy,
} from '../../../backend/services/publishingOptimizationService';
import { generatePlatformWaveSchedule } from '../../../backend/services/campaignWaveService';
import { generateDailyDistributionPlan as generateAIDailyDistribution } from '../../../backend/services/dailyContentDistributionPlanService';
import type { CampaignBlueprintWeek, WeeklyTopicWritingBrief } from '../../../backend/types/CampaignBlueprint';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

type DailyPlanItem = {
  dayIndex: number;
  weekNumber: number;
  topicTitle: string;
  topicReference: string;
  globalProgressionIndex: number;
  dailyObjective: string;
  platformTargets: string[];
  contentType: string;
  briefSummary: string;
  writerBrief?: any;
  writingIntent: string;
  whoAreWeWritingFor: string;
  whatProblemAreWeAddressing: string;
  whatShouldReaderLearn: string;
  desiredAction: string;
  narrativeStyle: string;
  contentGuidance: {
    primaryFormat: string;
    maxWordTarget: number;
    platformWithHighestLimit: string;
  };
  ctaType: string;
  kpiTarget: string;
};

type DailyObjectiveRefinement = {
  dayIndex: number;
  topicReference: string;
  dailyObjective: string;
};

function normalizePlatformKey(platform: string): string {
  const p = String(platform || '').trim().toLowerCase();
  if (p === 'twitter') return 'x';
  return p;
}

function normalizeTopicKey(topic: string): string {
  const s = String(topic || '').trim();
  const withoutIndex = s.replace(/^\(?\s*\d+\s*[\)\.\-:]\s*/g, '');
  return withoutIndex
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickContentType(contentTypeMix: string[] | undefined, index: number): string {
  const mix = Array.isArray(contentTypeMix) ? contentTypeMix : [];
  if (mix.length === 0) return 'post';
  const normalized = mix.map((s) => {
    const lower = String(s || '').toLowerCase();
    if (lower.includes('video')) return 'video';
    if (lower.includes('article') || lower.includes('blog')) return 'article';
    if (lower.includes('poll')) return 'poll';
    if (lower.includes('carousel')) return 'carousel';
    if (lower.includes('story')) return 'story';
    if (lower.includes('reel')) return 'reel';
    if (lower.includes('thread')) return 'thread';
    return 'post';
  });
  return normalized[index % normalized.length] || 'post';
}

function buildTopicReference(weekNumber: number, topicIndex: number): string {
  return `w${weekNumber}.t${topicIndex + 1}`;
}

function buildDayTopics(topicOrder: string[], topicWeights: number[]): string[][] {
  const topics = topicOrder.length ? topicOrder : ['Week topic'];
  const weights = topicWeights.length === topics.length ? topicWeights : topics.map(() => 1);
  const n = topics.length;
  const dayTopics: string[][] = Array.from({ length: 7 }, () => []);

  if (n >= 7) {
    const base = Math.floor(n / 7);
    let rem = n % 7;
    let cursor = 0;
    for (let d = 0; d < 7; d += 1) {
      const size = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      dayTopics[d] = topics.slice(cursor, cursor + size);
      cursor += size;
    }
    return dayTopics;
  }

  const daysPerTopic = topics.map(() => 1);
  let remaining = 7 - n;
  while (remaining > 0) {
    let bestIdx = 0;
    for (let i = 1; i < n; i += 1) {
      if (weights[i] > weights[bestIdx]) bestIdx = i;
    }
    daysPerTopic[bestIdx] += 1;
    remaining -= 1;
  }

  let day = 0;
  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < daysPerTopic[i]; k += 1) {
      if (day < 7) dayTopics[day].push(topics[i]);
      day += 1;
    }
  }
  for (let d = 0; d < 7; d += 1) {
    if (dayTopics[d].length === 0) dayTopics[d] = [topics[topics.length - 1]];
  }
  return dayTopics;
}

function computeTopicAssignedDays(dayTopics: string[][]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (let d = 0; d < dayTopics.length; d += 1) {
    const dayIndex = d + 1;
    for (const topic of dayTopics[d]) {
      const arr = map.get(topic) ?? [];
      arr.push(dayIndex);
      map.set(topic, arr);
    }
  }
  return map;
}

function validateDailyPlan(params: { items: DailyPlanItem[]; topicOrder: string[] }): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const { items, topicOrder } = params;

  const daySet = new Set(items.map((i) => i.dayIndex));
  for (let d = 1; d <= 7; d += 1) {
    if (!daySet.has(d)) errors.push(`Missing dayIndex ${d}`);
  }

  const topicSet = new Set(items.map((i) => i.topicTitle));
  for (const t of topicOrder) {
    if (!topicSet.has(t)) errors.push(`Missing topic "${t}" in daily items`);
  }

  const topicOrderSet = new Set(topicOrder);
  const orphans = items.filter((i) => !topicOrderSet.has(i.topicTitle));
  if (orphans.length > 0) errors.push(`Found ${orphans.length} orphan daily item(s) with unknown topicTitle`);

  return { ok: errors.length === 0, errors };
}

function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeDayDate(params: { campaignStart: string; weekNumber: number; dayIndex: number }): string {
  const start = new Date(params.campaignStart);
  const offsetDays = (params.weekNumber - 1) * 7 + (params.dayIndex - 1);
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return toIsoDateOnly(date);
}

function buildDeterministicDailyObjective(input: {
  weekIntent: string;
  topicTitle: string;
  topicDayPosition: 'start' | 'middle' | 'end';
}): string {
  const step =
    input.topicDayPosition === 'start'
      ? 'Introduce the core idea'
      : input.topicDayPosition === 'end'
        ? 'Synthesize and apply the idea'
        : 'Deepen understanding with a focused angle';
  return `${step} for "${input.topicTitle}" to advance: ${input.weekIntent}`;
}

function getDefaultPlatformTargets(week: CampaignBlueprintWeek): string[] {
  const allocation = week.platform_allocation || {};
  const sorted = Object.entries(allocation)
    .map(([p, c]) => ({ platform: normalizePlatformKey(p), count: Number(c) || 0 }))
    .sort((a, b) => b.count - a.count);
  const top = sorted[0]?.platform || 'linkedin';
  return [top];
}

function deriveContentGuidance(brief: WeeklyTopicWritingBrief | null | undefined): DailyPlanItem['contentGuidance'] {
  const g = (brief as any)?.contentTypeGuidance;
  if (g && typeof g === 'object') {
    return {
      primaryFormat: String((g as any).primaryFormat ?? 'long-form social post'),
      maxWordTarget: Number((g as any).maxWordTarget ?? 800) || 800,
      platformWithHighestLimit: String((g as any).platformWithHighestLimit ?? 'linkedin'),
    };
  }
  return { primaryFormat: 'long-form social post', maxWordTarget: 800, platformWithHighestLimit: 'linkedin' };
}

async function refineDailyObjectivesWithLLM(params: {
  companyId?: string | null;
  weekNumber: number;
  weeklyContextCapsule?: Record<string, unknown> | null;
  items: DailyPlanItem[];
}): Promise<DailyPlanItem[]> {
  // HARD RULE: daily planner is execution-only. It must never mutate weekly intent.
  // Keep this function as a no-op to preserve architecture, but do not allow any rewrite.
  return params.items;
}

function stableStringify(value: any): string {
  const seen = new WeakSet<object>();
  const walk = (v: any): any => {
    if (v == null) return v;
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

function assertDailyIntentNotMutated(params: {
  sourceIntent: any;
  dailyItem: Pick<DailyPlanItem, 'dailyObjective' | 'whoAreWeWritingFor' | 'ctaType' | 'briefSummary' | 'writerBrief'>;
  candidate: any;
  stage: string;
}) {
  const src = params.sourceIntent;
  if (!src || typeof src !== 'object') throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');

  const objective = params.dailyItem.dailyObjective;
  const target_audience = params.dailyItem.whoAreWeWritingFor;
  const cta_type = params.dailyItem.ctaType;
  const brief_summary = params.dailyItem.briefSummary;
  const writer_brief = params.dailyItem.writerBrief;

  if (objective !== src.objective) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (target_audience !== src.target_audience) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (cta_type !== src.cta_type) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (brief_summary !== src.brief_summary) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (stableStringify(writer_brief) !== stableStringify(src)) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');

  const cand = params.candidate ?? {};
  const candObjective = cand.objective ?? cand.dailyObjective ?? null;
  const candAudience = cand.target_audience ?? cand.whoAreWeWritingFor ?? null;
  const candCta = cand.cta_type ?? cand.ctaType ?? null;
  const candBrief = cand.brief_summary ?? cand.briefSummary ?? null;
  const candWriter = cand.writer_brief ?? cand.writerBrief ?? null;

  if (candObjective !== src.objective) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (candAudience !== src.target_audience) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (candCta !== src.cta_type) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (candBrief !== src.brief_summary) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
  if (stableStringify(candWriter) !== stableStringify(src)) throw new Error('DAILY_INTENT_MUTATION_NOT_ALLOWED');
}

function assertDailyExecutionIdentityNotMutated(params: {
  source_execution: { content_type: string; platform: string; topic: string };
  candidate: any;
  stage: 'daily-build' | 'writer-ready' | 'post-validate' | 'post-enrich';
}) {
  const src = params.source_execution;
  const srcContentType = String(src?.content_type ?? '');
  const srcPlatform = String(src?.platform ?? '');
  const srcTopic = String(src?.topic ?? '');
  if (!srcContentType || !srcPlatform || !srcTopic) {
    throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  }

  const cand = params.candidate ?? {};
  const candContentType = String(cand.content_type ?? cand.contentType ?? '');
  const candPlatform = String(cand.platform ?? '');
  const candTopic = String(cand.topic ?? cand.title ?? cand.topicTitle ?? '');
  if (!candContentType || !candPlatform || !candTopic) {
    throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  }

  if (candContentType !== srcContentType) throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  if (candPlatform !== srcPlatform) throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
  if (candTopic !== srcTopic) throw new Error('DAILY_EXECUTION_IDENTITY_MUTATION_NOT_ALLOWED');
}

function assertDailyGlobalProgressionNotMutated(params: {
  source_global_progression_index: number;
  candidate: any;
  stage: 'daily-build' | 'writer-ready' | 'post-validate' | 'post-enrich';
}) {
  const src = Number(params.source_global_progression_index);
  if (!Number.isFinite(src) || src < 1) {
    throw new Error('DAILY_GLOBAL_PROGRESSION_MUTATION_NOT_ALLOWED');
  }
  const cand = params.candidate ?? {};
  const n = Number(cand.global_progression_index ?? cand.globalProgressionIndex ?? cand.globalProgressionIndex);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error('DAILY_GLOBAL_PROGRESSION_MUTATION_NOT_ALLOWED');
  }
  if (n !== src) {
    throw new Error('DAILY_GLOBAL_PROGRESSION_MUTATION_NOT_ALLOWED');
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      week,
      campaignId,
      companyId,
      auto_rebalance,
      auto_optimize_distribution,
      enable_campaign_waves,
      distribution_mode,
    } = req.body || {};
    const autoRebalance = Boolean(auto_rebalance);
    const autoOptimizeDistribution = Boolean(auto_optimize_distribution);
    const enableCampaignWaves = Boolean(enable_campaign_waves);
    const distributionMode = distribution_mode === 'same_day_per_topic' ? 'same_day_per_topic' : 'staggered';
    const weekNumber = Number(week);
    if (!campaignId || !Number.isFinite(weekNumber) || weekNumber < 1) {
      return res.status(400).json({ error: 'campaignId and week (week number) are required' });
    }

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('id, start_date, name')
      .eq('id', campaignId)
      .maybeSingle();

    if (!campaign?.start_date) {
      return res.status(412).json({ error: 'Campaign start_date is required before generating daily plans' });
    }

    const blueprint = await getUnifiedCampaignBlueprint(String(campaignId));
    if (!blueprint?.weeks?.length) {
      return res.status(404).json({ error: 'Committed weekly blueprint not found' });
    }
    const weekBlueprint = blueprint.weeks.find((w) => Number(w.week_number) === weekNumber);
    if (!weekBlueprint) {
      return res.status(404).json({ error: `Week ${weekNumber} not found in blueprint` });
    }

    const topicOrderRaw: string[] = Array.isArray(weekBlueprint.topics)
      ? weekBlueprint.topics.map((t) => String((t as any)?.topicTitle ?? '').trim()).filter(Boolean)
      : Array.isArray(weekBlueprint.topics_to_cover)
        ? weekBlueprint.topics_to_cover.map((t) => String(t ?? '').trim()).filter(Boolean)
        : [];
    const topicOrder = topicOrderRaw.length > 0
      ? topicOrderRaw
      : [String(weekBlueprint.phase_label || weekBlueprint.primary_objective || `Week ${weekNumber} topic`).trim()];

    const briefByKey = new Map<string, WeeklyTopicWritingBrief>();
    if (Array.isArray(weekBlueprint.topics)) {
      for (const brief of weekBlueprint.topics) {
        const title = String((brief as any)?.topicTitle ?? '').trim();
        if (title) briefByKey.set(normalizeTopicKey(title), brief as any);
      }
    }

    const topicIndexByKey = new Map<string, number>();
    topicOrder.forEach((t, idx) => topicIndexByKey.set(normalizeTopicKey(t), idx));

    const resolveTopic = (rawTopic: string, fallbackIndex: number): string => {
      const key = normalizeTopicKey(rawTopic);
      if (topicIndexByKey.has(key)) return topicOrder[topicIndexByKey.get(key) ?? 0]!;
      for (const t of topicOrder) {
        const tk = normalizeTopicKey(t);
        if (tk && key && (tk.includes(key) || key.includes(tk))) return t;
      }
      return topicOrder[fallbackIndex % topicOrder.length]!;
    };

    const spreadEvenlyAcrossDays = (count: number, days: number = 7): number[] => {
      const n = Math.max(0, Math.floor(count));
      if (n <= 0) return [];
      if (n === 1) return [1];
      const out: number[] = [];
      for (let i = 0; i < n; i += 1) {
        const idx0 =
          Math.round(((i + 0.5) * days) / n - 0.5);
        const clamped = Math.min(days - 1, Math.max(0, idx0));
        out.push(clamped + 1);
      }
      return out;
    };

    type ExecutionItemInput = {
      content_type: string;
      selected_platforms: string[];
      count_per_week: number;
      topic?: string;
      topic_slots?: Array<{
        topic: string | null;
        global_progression_index?: number;
        intent: any;
      }>;
    };

    const rawExecutionItems: any[] | null =
      Array.isArray((weekBlueprint as any)?.execution_items) ? ((weekBlueprint as any).execution_items as any[]) : null;
    const executionItems: ExecutionItemInput[] = (rawExecutionItems || [])
      .map((it) => {
        const content_type = String(it?.content_type ?? it?.contentType ?? it?.type ?? '').trim().toLowerCase();
        const selected_platforms_raw =
          Array.isArray(it?.selected_platforms) ? it.selected_platforms
          : Array.isArray(it?.selectedPlatforms) ? it.selectedPlatforms
          : Array.isArray(it?.platforms) ? it.platforms
          : it?.platform ? [it.platform]
          : [];
        const selected_platforms = (selected_platforms_raw || [])
          .map((p: any) => normalizePlatformKey(String(p)))
          .filter(Boolean);
        const count_per_week = Number(it?.count_per_week ?? it?.countPerWeek ?? it?.count ?? 0) || 0;
        const topic = typeof it?.topic === 'string' && it.topic.trim() ? String(it.topic).trim() : undefined;
        const topic_slots = Array.isArray(it?.topic_slots)
          ? (it.topic_slots as any[]).map((slot: any) => {
              if (!slot || typeof slot !== 'object') return null;
              const topic = slot.topic == null ? null : String(slot.topic);
              const global_progression_index = Number((slot as any)?.global_progression_index);
              const intentRaw = slot.intent;
              if (!intentRaw || typeof intentRaw !== 'object') return null;
              const objective = (intentRaw as any).objective;
              const cta_type = (intentRaw as any).cta_type;
              const target_audience = (intentRaw as any).target_audience;
              const brief_summary = (intentRaw as any).brief_summary;
              if (typeof objective !== 'string' || !objective) return null;
              if (typeof cta_type !== 'string' || !cta_type) return null;
              if (typeof target_audience !== 'string' || !target_audience) return null;
              if (typeof brief_summary !== 'string' || !brief_summary) return null;
              if (!Number.isFinite(global_progression_index) || global_progression_index < 1) return null;
              return {
                topic,
                global_progression_index,
                intent: intentRaw,
              };
            }).filter(Boolean) as any
          : undefined;
        return { content_type, selected_platforms, count_per_week, topic, topic_slots };
      })
      .filter((it) => it.content_type && it.selected_platforms.length > 0 && Number(it.count_per_week) > 0);
    const useExecutionItems = executionItems.length > 0;

    if (useExecutionItems) {
      for (const it of executionItems) {
        const slots = Array.isArray(it.topic_slots) ? it.topic_slots : [];
        if (slots.length < Math.max(0, Math.floor(it.count_per_week))) {
          throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
        }
        for (const slot of slots) {
          if (!slot || typeof slot !== 'object' || !slot.intent) {
            throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          }
        }
      }
    }

    type Piece = { platformTargets: string[]; contentType: string; topicTitle: string };
    const piecesByTopic = new Map<string, Piece[]>();
    for (const t of topicOrder) piecesByTopic.set(t, []);

    const dailyItemsDeterministic: DailyPlanItem[] = [];
    let dayTopics: string[][] = Array.from({ length: 7 }, () => []);

    if (!useExecutionItems) {
      // AI Content Distribution Planner: distribute weekly topics into daily plan (short topic 6–8 words, full topic, platform, content type, reasoning, holiday awareness).
      const aiSlots = await generateAIDailyDistribution({
        companyId: companyId ?? null,
        campaignId: String(campaignId),
        weekNumber,
        weekBlueprint: weekBlueprint as CampaignBlueprintWeek,
        campaignName: (campaign as any)?.name ?? undefined,
        campaignStartDate: campaign?.start_date ?? undefined,
        targetRegion: null,
        campaignMode: 'STRATEGIC',
        contentTypesAvailable: (weekBlueprint as any)?.content_type_mix ?? undefined,
        distributionMode,
      });
      let globalProgressionIndex = 1;
      for (const slot of aiSlots) {
        const dayIndex = Math.min(7, Math.max(1, slot.day_index));
        const topicTitle = slot.short_topic?.trim() || slot.full_topic?.trim() || 'Daily topic';
        const contentGuidance = deriveContentGuidance(null);
        const writerBrief = {
          objective: slot.reasoning || slot.full_topic,
          target_audience: 'General Audience',
          cta_type: 'Learn more',
          brief_summary: slot.full_topic,
          writing_angle: slot.reasoning,
        };
        const item: DailyPlanItem = {
          dayIndex,
          weekNumber,
          topicTitle,
          topicReference: buildTopicReference(weekNumber, globalProgressionIndex - 1),
          globalProgressionIndex,
          dailyObjective: slot.reasoning || slot.full_topic,
          platformTargets: [normalizePlatformKey(slot.platform)].filter(Boolean),
          contentType: slot.content_type || 'post',
          briefSummary: slot.full_topic,
          writerBrief,
          writingIntent: slot.full_topic,
          whoAreWeWritingFor: 'General Audience',
          whatProblemAreWeAddressing: '',
          whatShouldReaderLearn: '',
          desiredAction: 'Learn more',
          narrativeStyle: 'clear, practical, outcome-driven',
          contentGuidance,
          ctaType: 'Learn more',
          kpiTarget: String((weekBlueprint as any)?.weekly_kpi_focus ?? 'Reach growth'),
        };
        dailyItemsDeterministic.push(item);
        const existing = dayTopics[dayIndex - 1] ?? [];
        if (!existing.includes(slot.full_topic)) existing.push(slot.full_topic);
        dayTopics[dayIndex - 1] = existing;
        globalProgressionIndex += 1;
      }
    } else {
      for (const exec of executionItems) {
        const dayIndices = spreadEvenlyAcrossDays(exec.count_per_week, 7);
        for (let k = 0; k < dayIndices.length; k += 1) {
          const dayIndex = dayIndices[k]!;
          const slot = (exec.topic_slots || [])[k];
          if (!slot || !slot.intent) {
            throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          }
          const rawTopic = slot.topic == null ? '' : String(slot.topic);
          if (!rawTopic.trim()) {
            throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          }
          const topicTitle = rawTopic;
          const topicKey = normalizeTopicKey(topicTitle);
          const topicIndex = topicIndexByKey.get(topicKey) ?? 0;
          const execIntent = slot.intent;

          const dailyObjective = execIntent.objective;
          const who = execIntent.target_audience;
          const briefSummary = execIntent.brief_summary;
          const ctaType = execIntent.cta_type;
          const writerBrief = execIntent;
          const globalProgressionIndex = Number((slot as any)?.global_progression_index);
          const writingAngle = typeof execIntent.writing_angle === 'string' && execIntent.writing_angle ? execIntent.writing_angle : null;
          if (typeof dailyObjective !== 'string' || !dailyObjective) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof who !== 'string' || !who) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof briefSummary !== 'string' || !briefSummary) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (typeof ctaType !== 'string' || !ctaType) throw new Error('DETERMINISTIC_TOPIC_INTENT_REQUIRED');
          if (!Number.isFinite(globalProgressionIndex) || globalProgressionIndex < 1) throw new Error('DETERMINISTIC_GLOBAL_PROGRESSION_REQUIRED');

          const contentGuidance = deriveContentGuidance(null);
          const item: DailyPlanItem = {
            dayIndex,
            weekNumber,
            topicTitle,
            topicReference: buildTopicReference(weekNumber, topicIndex),
            globalProgressionIndex,
            dailyObjective,
            platformTargets: exec.selected_platforms.map(normalizePlatformKey).filter(Boolean),
            contentType: String(exec.content_type || 'post').toLowerCase(),
            briefSummary,
            writerBrief,
            writingIntent: briefSummary,
            whoAreWeWritingFor: who,
            whatProblemAreWeAddressing: '',
            whatShouldReaderLearn: '',
            desiredAction: ctaType,
            narrativeStyle: writingAngle || 'clear, practical, outcome-driven',
            contentGuidance,
            ctaType,
            kpiTarget: String((weekBlueprint as any)?.weekly_kpi_focus ?? 'Reach growth'),
          };
          for (const platform of item.platformTargets) {
            const p = normalizePlatformKey(platform);
            if (!p) continue;
            assertDailyExecutionIdentityNotMutated({
              source_execution: { content_type: item.contentType, platform: p, topic: item.topicTitle },
              candidate: { content_type: item.contentType, platform: p, topic: item.topicTitle },
              stage: 'daily-build',
            });
            assertDailyGlobalProgressionNotMutated({
              source_global_progression_index: item.globalProgressionIndex,
              candidate: { global_progression_index: item.globalProgressionIndex },
              stage: 'daily-build',
            });
          }
          assertDailyIntentNotMutated({
            sourceIntent: execIntent,
            dailyItem: item,
            candidate: {
              objective: item.dailyObjective,
              target_audience: item.whoAreWeWritingFor,
              cta_type: item.ctaType,
              brief_summary: item.briefSummary,
              writer_brief: item.writerBrief,
            },
            stage: 'daily-build',
          });
          dailyItemsDeterministic.push(item);
          dayTopics[dayIndex - 1] = Array.from(new Set([...(dayTopics[dayIndex - 1] ?? []), topicTitle]));
        }
      }
    }

    await supabase
      .from('daily_content_plans')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber);

    const finalItems = dailyItemsDeterministic;
    const validation = { ok: true, errors: [] as string[] };

    const rowsWithContent: Array<{ row: any; contentObj: any }> = [];
    let executionValidationItems: any[] = [];
    const autoRebalanceEffective = useExecutionItems ? false : autoRebalance;
    const autoOptimizeDistributionEffective = useExecutionItems ? false : autoOptimizeDistribution;

    for (const item of finalItems) {
      const dayName = DAYS_OF_WEEK[item.dayIndex - 1] ?? 'Monday';
      const date = computeDayDate({
        campaignStart: String(campaign.start_date),
        weekNumber,
        dayIndex: item.dayIndex,
      });
      const platforms = Array.isArray(item.platformTargets) && item.platformTargets.length > 0
        ? item.platformTargets
        : useExecutionItems
          ? []
          : getDefaultPlatformTargets(weekBlueprint as any);
      if (useExecutionItems && platforms.length === 0) continue;

      for (const platform of platforms) {
        const identitySource = {
          content_type: String(item.contentType || 'post'),
          platform: normalizePlatformKey(platform),
          topic: String(item.topicTitle || ''),
        };
        const writerReady = {
          content_type: identitySource.content_type,
          platform: identitySource.platform,
          topic: identitySource.topic,
          brief_summary: (item as any).briefSummary,
          target_audience: item.whoAreWeWritingFor,
          objective: item.dailyObjective,
          cta_type: item.ctaType,
          global_progression_index: item.globalProgressionIndex,
          writer_brief: (item as any).writerBrief ?? null,
        };
        assertDailyExecutionIdentityNotMutated({
          source_execution: identitySource,
          candidate: writerReady,
          stage: 'writer-ready',
        });
        assertDailyGlobalProgressionNotMutated({
          source_global_progression_index: item.globalProgressionIndex,
          candidate: writerReady,
          stage: 'writer-ready',
        });
        assertDailyIntentNotMutated({
          sourceIntent: (item as any).writerBrief,
          dailyItem: item,
          candidate: writerReady,
          stage: 'writer-ready',
        });
        const executionBase = {
          ...item,
          ...writerReady,
          platform: writerReady.platform,
          contentType: writerReady.content_type,
        } as any;

        let validated = await validateDailyItemAgainstPlatformRules(executionBase);
        assertDailyExecutionIdentityNotMutated({
          source_execution: identitySource,
          candidate: validated?.dailyItem,
          stage: 'post-validate',
        });
        assertDailyGlobalProgressionNotMutated({
          source_global_progression_index: item.globalProgressionIndex,
          candidate: validated?.dailyItem,
          stage: 'post-validate',
        });
        assertDailyIntentNotMutated({
          sourceIntent: (item as any).writerBrief,
          dailyItem: item,
          candidate: validated?.dailyItem,
          stage: 'post-validate',
        });

        if (autoRebalanceEffective && validated.validation_status === 'invalid') {
          try {
            const bundle = await getPlatformRules(executionBase.platform);
            const supported = (bundle?.content_rules || [])
              .map((r: any) => String(r?.content_type || '').toLowerCase().trim())
              .filter(Boolean);
            const preferred =
              supported.includes('post')
                ? 'post'
                : supported.includes('tweet')
                  ? 'tweet'
                  : supported.sort()[0];

            if (preferred) {
              validated = await validateDailyItemAgainstPlatformRules({
                ...executionBase,
                contentType: preferred,
              });
              (validated.dailyItem as any).validation_notes = [
                ...(validated.dailyItem as any).validation_notes || [],
                `auto_rebalance: reassigned unsupported contentType to "${preferred}"`,
              ];
              (validated.dailyItem as any).validation_status =
                validated.validation_status === 'invalid' ? 'invalid' : 'adjusted';
            }
          } catch {
            // fail-soft: keep invalid status
          }
        }

        if (autoRebalanceEffective && validated.validation_status === 'invalid') {
          // Reduce invalid items automatically by not persisting them.
          executionValidationItems.push(validated.dailyItem);
          continue;
        }

        const enriched = await enrichDailyItemWithPlatformRequirements(validated.dailyItem as any);
        assertDailyExecutionIdentityNotMutated({
          source_execution: identitySource,
          candidate: enriched,
          stage: 'post-enrich',
        });
        assertDailyGlobalProgressionNotMutated({
          source_global_progression_index: item.globalProgressionIndex,
          candidate: enriched,
          stage: 'post-enrich',
        });
        assertDailyIntentNotMutated({
          sourceIntent: (item as any).writerBrief,
          dailyItem: item,
          candidate: enriched,
          stage: 'post-enrich',
        });
        executionValidationItems.push(enriched);

        const row = {
          campaign_id: campaignId,
          week_number: weekNumber,
          day_of_week: dayName,
          date,
          platform: normalizePlatformKey(platform),
          content_type: String((validated.dailyItem as any)?.contentType || item.contentType || 'post'),
          title: item.topicTitle,
          content: JSON.stringify(enriched),
          topic: item.topicTitle,
          objective: item.dailyObjective,
          intro_objective: item.whatShouldReaderLearn,
          summary: item.whatProblemAreWeAddressing,
          cta: item.desiredAction,
          brand_voice: item.narrativeStyle,
          format_notes: `${item.contentGuidance.primaryFormat}; max ${item.contentGuidance.maxWordTarget} words; highest limit: ${item.contentGuidance.platformWithHighestLimit}`,
          scheduled_time: '09:00',
          posting_strategy: `Week ${weekNumber} Day ${item.dayIndex} — ${item.topicReference}`,
          status: 'planned',
          priority: 'medium',
          ai_generated: true,
          target_audience: item.whoAreWeWritingFor,
        };
        rowsWithContent.push({ row, contentObj: enriched });
      }
    }

    let executionSummary = analyzeValidationResults(executionValidationItems);
    let recommendations = generatePlanningFeedback(executionSummary);
    let execution_feedback = {
      summary: executionSummary,
      recommendations,
    };

    // Historical awareness: compare against previous weeks' stored snapshots (best-effort).
    let history: Array<{ week_number: number; summary: any }> = [];
    try {
      const { data: prior, error } = await supabase
        .from('weekly_content_refinements')
        .select('week_number, content_plan')
        .eq('campaign_id', campaignId)
        .lt('week_number', weekNumber)
        .order('week_number', { ascending: true })
        .limit(12);
      if (!error && Array.isArray(prior)) {
        history = prior
          .map((row: any) => {
            const wp = Number(row.week_number);
            const plan = row.content_plan;
            const summary = plan?.execution_feedback?.summary ?? null;
            if (!Number.isFinite(wp) || !summary) return null;
            return { week_number: wp, summary };
          })
          .filter(Boolean) as any;
      }
    } catch {
      history = [];
    }
    let feedbackHistory = [
      ...history,
      { week_number: weekNumber, summary: executionSummary },
    ];

    let optimizationSummary = analyzeExecutionFeedback(feedbackHistory as any);
    const weeklyPlanForOptimization = {
      weekNumber,
      platform_allocation: (weekBlueprint as any)?.platform_allocation ?? {},
    };
    let strategy_adjustments = suggestPublishingStrategy(weeklyPlanForOptimization, optimizationSummary);
    let publishing_optimization = {
      summary: optimizationSummary,
      strategy_adjustments,
    };

    if (autoOptimizeDistributionEffective) {
      const reduced = new Set<string>(
        (strategy_adjustments.reduced_platforms || []).map((p) => normalizePlatformKey(p)).filter(Boolean)
      );
      const preferred = (strategy_adjustments.preferred_platforms || [])
        .map((p) => normalizePlatformKey(p))
        .filter(Boolean);
      const preferredPlatform = preferred[0] || 'linkedin';

      const optimizedRowsWithContent: Array<{ row: any; contentObj: any }> = [];
      const optimizedValidationItems: any[] = [];

      for (const entry of rowsWithContent) {
        const currentPlatform = normalizePlatformKey(entry.row.platform);
        if (!reduced.has(currentPlatform)) {
          optimizedRowsWithContent.push(entry);
          optimizedValidationItems.push(entry.contentObj);
          continue;
        }

        // Reassign reduced/unstable platforms to preferred platform.
        const reassignedBase = {
          ...(entry.contentObj || {}),
          platform: preferredPlatform,
          contentType: String((entry.contentObj as any)?.contentType || entry.row.content_type || 'post'),
        } as any;

        let validated = await validateDailyItemAgainstPlatformRules(reassignedBase);

      if (autoRebalanceEffective && validated.validation_status === 'invalid') {
          try {
            const bundle = await getPlatformRules(reassignedBase.platform);
            const supported = (bundle?.content_rules || [])
              .map((r: any) => String(r?.content_type || '').toLowerCase().trim())
              .filter(Boolean);
            const preferredType =
              supported.includes('post')
                ? 'post'
                : supported.includes('tweet')
                  ? 'tweet'
                  : supported.sort()[0];
            if (preferredType) {
              validated = await validateDailyItemAgainstPlatformRules({
                ...reassignedBase,
                contentType: preferredType,
              });
              (validated.dailyItem as any).validation_notes = [
                ...(validated.dailyItem as any).validation_notes || [],
                `auto_rebalance: reassigned unsupported contentType to "${preferredType}"`,
              ];
              (validated.dailyItem as any).validation_status =
                validated.validation_status === 'invalid' ? 'invalid' : 'adjusted';
            }
          } catch {
            // ignore
          }
        }

      if (validated.validation_status === 'invalid') {
          // Reduce invalid items automatically by dropping them under auto optimization.
          optimizedValidationItems.push(validated.dailyItem);
          continue;
        }

        const enriched = await enrichDailyItemWithPlatformRequirements(validated.dailyItem as any);
        (enriched as any).validation_notes = [
          ...((enriched as any).validation_notes || []),
          `auto_optimize_distribution: moved platform "${currentPlatform}" -> "${preferredPlatform}"`,
        ];
        (enriched as any).validation_status = (enriched as any).validation_status === 'invalid' ? 'invalid' : 'adjusted';

        const nextRow = {
          ...entry.row,
          platform: preferredPlatform,
          content_type: String((validated.dailyItem as any)?.contentType || entry.row.content_type || 'post'),
          content: JSON.stringify(enriched),
        };
        optimizedRowsWithContent.push({ row: nextRow, contentObj: enriched });
        optimizedValidationItems.push(enriched);
      }

      // Recompute summaries after auto optimization is applied (one deterministic iteration).
      executionValidationItems = optimizedValidationItems;
      executionSummary = analyzeValidationResults(executionValidationItems);
      recommendations = generatePlanningFeedback(executionSummary);
      execution_feedback = { summary: executionSummary, recommendations };
      feedbackHistory = [...history, { week_number: weekNumber, summary: executionSummary }];
      optimizationSummary = analyzeExecutionFeedback(feedbackHistory as any);
      strategy_adjustments = suggestPublishingStrategy(weeklyPlanForOptimization, optimizationSummary);
      publishing_optimization = { summary: optimizationSummary, strategy_adjustments };

      // Overwrite rowsWithContent for persistence
      rowsWithContent.length = 0;
      rowsWithContent.push(...optimizedRowsWithContent);
    }

    if (enableCampaignWaves) {
      const stable = new Set<string>((publishing_optimization?.summary?.stable_platforms || []).map(normalizePlatformKey));
      const unstable = new Set<string>((publishing_optimization?.summary?.unstable_platforms || []).map(normalizePlatformKey));

      const waveItems = rowsWithContent.map(({ row }) => {
        const platform = normalizePlatformKey(row.platform);
        const stability = stable.has(platform) ? 'stable' : unstable.has(platform) ? 'unstable' : 'unknown';
        return {
          platform,
          topic: String(row.topic || row.title || ''),
          base_date: String(row.date || '').slice(0, 10),
          stability,
        } as const;
      });

      const waveSchedule = generatePlatformWaveSchedule(waveItems as any);

      for (const entry of rowsWithContent) {
        const platform = normalizePlatformKey(entry.row.platform);
        const base_date = String(entry.row.date || '').slice(0, 10);
        const topicKey = String(entry.row.topic || entry.row.title || '').trim();
        const groupKey =
          `${base_date}::${topicKey.toLowerCase().replace(/[^a-z0-9\\s]/g, ' ').replace(/\\s+/g, ' ').trim()}`;
        const lookupKey = `${groupKey}::${platform}`;
        const assignment = waveSchedule.get(lookupKey);
        if (!assignment) continue;

        const contentObj = entry.contentObj && typeof entry.contentObj === 'object' ? entry.contentObj : {};
        (contentObj as any).wave_info = {
          wave_group_id: assignment.wave_group_id,
          wave_order: assignment.wave_order,
          wave_offset_days: assignment.wave_offset_days,
        };

        entry.contentObj = contentObj;
        entry.row.date = assignment.scheduled_date;
        entry.row.content = JSON.stringify(contentObj);
      }
    }

    const rows = rowsWithContent.map((r) => r.row);
    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('daily_content_plans').insert(rows);
      if (insertError) {
        console.error('Error saving daily plans:', insertError);
        return res.status(500).json({ error: 'Failed to save daily plans' });
      }
    }

    // Best-effort persistence into weekly plan JSON when weekly_content_refinements has content_plan.
    try {
      const { data: refinement, error: refinementError } = await supabase
        .from('weekly_content_refinements')
        .select('id, content_plan')
        .eq('campaign_id', campaignId)
        .eq('week_number', weekNumber)
        .maybeSingle();

      if (!refinementError && refinement?.id && (refinement as any).content_plan != null) {
        const existing = (refinement as any).content_plan && typeof (refinement as any).content_plan === 'object'
          ? (refinement as any).content_plan
          : {};
        const updated = { ...existing, execution_feedback, publishing_optimization };
        await supabase
          .from('weekly_content_refinements')
          .update({ content_plan: updated, updated_at: new Date().toISOString() } as any)
          .eq('id', refinement.id);
      }
    } catch (err) {
      console.warn('[execution_feedback] unable to persist into weekly_content_refinements.content_plan:', err);
    }

    const topicDayMap = dayTopics.map((topics, idx) => ({
      dayIndex: idx + 1,
      day: DAYS_OF_WEEK[idx],
      topics,
    }));

    return res.status(200).json({
      success: true,
      week: weekNumber,
      dailyPlan: finalItems,
      topicDayMap,
      validation,
      planning_feedback: execution_feedback,
      execution_feedback,
      publishing_optimization,
      auto_rebalance: autoRebalanceEffective,
      auto_optimize_distribution: autoOptimizeDistributionEffective,
      enable_campaign_waves: enableCampaignWaves,
      message: `Generated topic-aligned daily plan skeleton for Week ${weekNumber}`,
    });

  } catch (error) {
    console.error('Error in generate weekly structure API:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Removed legacy daily planning generator. Daily layer is execution-only.
