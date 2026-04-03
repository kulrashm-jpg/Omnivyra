/**
 * Execution Planner Service — single engine for all daily plan generation flows.
 *
 * Table: daily_content_plans — execution layer only (daily activities, no weekly themes).
 *
 * All planning flows must use this service:
 * - Campaign planner → generateFromBlueprint()
 * - Manual campaign builder → generateFromManualPlanner()
 * - Board auto mode → generateFromBoard()
 * - AI fallback → generateFromAI()
 *
 * Every flow calls saveWeekPlans() for persistence (delete-then-insert).
 * Single read path: getDailyPlans().
 */

import { supabase } from '../db/supabaseClient';
import { generateDailyPlansWithAI } from './dailyPlanAiGenerator';
import type { WeeklyGenerationContext } from './dailyPlanAiGenerator';
import { getCampaignPlanningInputs } from './campaignPlanningInputsService';
import { getUnifiedCampaignBlueprint } from './campaignBlueprintService';
import { scheduleSlotIntelligently } from './intelligentSlotScheduler';
import type { ScheduledSlot } from './intelligentSlotScheduler';
import { generateWeeklyStructure } from '../../pages/api/campaigns/generate-weekly-structure';
import {
  saveWeekPlans as persistenceSaveWeekPlans,
  deleteWeekPlans as persistenceDeleteWeekPlans,
  updateActivity as persistenceUpdateActivity,
  insertActivity as persistenceInsertActivity,
  deleteActivity as persistenceDeleteActivity,
} from './executionPlannerPersistence';

const DAYS_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Minimal row for daily_content_plans. Execution data only. */
export type ExecutionPlanRow = Record<string, unknown> & {
  campaign_id: string;
  week_number: number;
  day_of_week: string;
  date: string;
  platform: string;
  content_type: string;
  title: string;
  content: string;
  status?: string;
  ai_generated?: boolean;
};

export type ExecutionSource = 'blueprint' | 'AI' | 'board' | 'manual';

function setWriteAllowed(): void {
  process.env.ALLOW_EXECUTION_ENGINE_WRITE = '1';
}

function log(source: ExecutionSource, msg: string, data?: Record<string, unknown>) {
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[EXECUTION_ENGINE] source=${source} ${msg}${payload}`);
  }
}

/** Re-export for callers that need explicit delete. */
export { WEEK_EXECUTION_LOCKED } from './executionPlannerPersistence';

export async function deleteWeekPlans(
  campaignId: string,
  weekNumber: number,
  options?: { forceOverride?: boolean }
): Promise<void> {
  setWriteAllowed();
  return persistenceDeleteWeekPlans(campaignId, weekNumber, options);
}

/** Partial board updates (single activity UPDATE). */
export async function updateActivity(
  activityId: string,
  updates: Record<string, unknown>,
  source: ExecutionSource
): Promise<{ updated: boolean }> {
  setWriteAllowed();
  return persistenceUpdateActivity(activityId, updates, source);
}

/** Single activity INSERT (board/creator). */
export async function insertActivity(
  row: import('./executionPlannerPersistence').ExecutionPlanRow,
  source: ExecutionSource
): Promise<{ id: string }> {
  setWriteAllowed();
  return persistenceInsertActivity(row, source);
}

/** Single activity DELETE (admin delete-activity). */
export async function deleteActivity(activityId: string): Promise<{ deleted: boolean }> {
  setWriteAllowed();
  return persistenceDeleteActivity(activityId);
}

/**
 * Replace week plans: delete existing, insert new.
 * Enforces campaign-wide uniqueness: same topic cannot appear on the same platform
 * in more than one week. Conflicting rows are dropped before insert.
 * All planners must use this for writes.
 */
export async function saveWeekPlans(
  campaignId: string,
  weekNumber: number,
  plans: ExecutionPlanRow[],
  source: ExecutionSource,
  options?: { forceOverride?: boolean }
): Promise<{ rowsInserted: number }> {
  setWriteAllowed();
  log(source, 'saveWeekPlans', { campaignId, weekNumber, count: plans.length });

  // Fetch existing rows from all OTHER weeks to prevent the exact same
  // topic+platform+content_type+day combination from spanning multiple weeks.
  const { data: existingRows } = await supabase
    .from('daily_content_plans')
    .select('title, platform, content_type, day_of_week')
    .eq('campaign_id', campaignId)
    .neq('week_number', weekNumber);

  // Cross-week dedup key: topic + platform + content_type + day — precise enough to
  // block true repeats (same piece, same slot, different week) while allowing the
  // same topic to appear on multiple days or as different content types in a week.
  const crossWeekPairs = new Set<string>(
    (existingRows ?? []).map((r: { title: string; platform: string; content_type: string; day_of_week: string }) =>
      [
        String(r.title ?? '').trim().toLowerCase(),
        String(r.platform ?? '').trim().toLowerCase(),
        String(r.content_type ?? '').trim().toLowerCase(),
        String(r.day_of_week ?? '').trim().toLowerCase(),
      ].join('::')
    )
  );

  // Within-batch dedup key: same four fields — prevents inserting the exact same slot twice
  // within a single week, but allows the same topic to appear on different days or as
  // different content types (e.g. video on Monday + carousel on Monday are distinct).
  const batchSeen = new Set<string>();

  const filtered: ExecutionPlanRow[] = [];
  for (const row of plans) {
    const key = [
      String(row.title ?? '').trim().toLowerCase(),
      String(row.platform ?? '').trim().toLowerCase(),
      String(row.content_type ?? '').trim().toLowerCase(),
      String(row.day_of_week ?? '').trim().toLowerCase(),
    ].join('::');

    if (crossWeekPairs.has(key)) {
      log(source, `DEDUP_DROP topic="${row.title}" platform="${row.platform}" content_type="${row.content_type}" day="${row.day_of_week}" already exists in another week — skipping`, { campaignId, weekNumber });
    } else if (batchSeen.has(key)) {
      log(source, `DEDUP_DROP topic="${row.title}" platform="${row.platform}" content_type="${row.content_type}" day="${row.day_of_week}" duplicate within same week batch — skipping`, { campaignId, weekNumber });
    } else {
      batchSeen.add(key);
      filtered.push(row);
    }
  }

  if (filtered.length < plans.length) {
    log(source, `saveWeekPlans dedup removed ${plans.length - filtered.length} rows`, { campaignId, weekNumber });
  }

  return persistenceSaveWeekPlans(campaignId, weekNumber, filtered, source, options);
}

/**
 * Get raw daily plans for a campaign.
 * Single read path; API may apply transformations.
 * Deduplicates by (title, platform) at read time: keeps the earliest week's row,
 * drops later duplicates. This cleans up any pre-existing dirty data in the DB.
 */
export async function getDailyPlans(campaignId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase
    .from('daily_content_plans')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('week_number', { ascending: true })
    .order('day_of_week', { ascending: true });

  if (error) {
    console.error('[EXECUTION_ENGINE] getDailyPlans failed:', error);
    throw new Error(`Failed to fetch daily plans: ${error.message}`);
  }

  // Deduplicate by (title, platform, content_type, day_of_week): drop true duplicates only.
  // Including day and content_type prevents legitimate multi-day activities (e.g. 3 videos
  // across Mon/Tue/Wed) from being collapsed into one.
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const title = String(row.title ?? '').trim().toLowerCase();
    const platform = String(row.platform ?? '').trim().toLowerCase();
    if (!title) { deduped.push(row); continue; }
    const key = [
      title,
      platform,
      String(row.content_type ?? '').trim().toLowerCase(),
      String(row.day_of_week ?? '').trim().toLowerCase(),
    ].join('::');
    if (seen.has(key)) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn(`[EXECUTION_ENGINE] getDailyPlans: dropping duplicate topic="${row.title}" platform="${row.platform}" content_type="${row.content_type}" day="${row.day_of_week}" week=${row.week_number}`);
      }
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function dayNameToIndex(dayName: string): number {
  const i = DAYS_ORDER.indexOf(dayName);
  return i >= 0 ? i + 1 : 1;
}

function computeDayDate(params: { campaignStart: string; weekNumber: number; dayOfWeek: string }): string {
  const start = new Date(params.campaignStart.replace(/T.*/, 'T00:00:00'));
  const dayIndex = dayNameToIndex(params.dayOfWeek);
  const offsetDays = (params.weekNumber - 1) * 7 + (dayIndex - 1);
  start.setDate(start.getDate() + offsetDays);
  return start.toISOString().slice(0, 10);
}

/**
 * Generate from blueprint (execution_items).
 * Used by: Campaign planner, BOLT pipeline.
 */
export async function generateFromBlueprint(
  campaignId: string,
  weekNumber: number,
  options?: { companyId?: string }
): Promise<{ rowsInserted: number }> {
  log('blueprint', 'generateFromBlueprint', { campaignId, weekNumber });
  const result = await generateWeeklyStructure({
    campaignId,
    companyId: options?.companyId ?? '',
    week: weekNumber,
    weeks: [weekNumber],
  });
  const rowsInserted = Array.isArray(result?.dailyPlan) ? result.dailyPlan.length : 0;
  return { rowsInserted };
}

/** Build flat slots list from execution_items (blueprint-derived frequency). */
function deriveFrequencySlotsFromExecutionItems(
  executionItems: Array<{
    content_type?: string;
    selected_platforms?: string[];
    count_per_week?: number;
    platform_counts?: Record<string, number>;
  }>
): Array<{ platform: string; contentType: string; count: number }> {
  const slots: Array<{ platform: string; contentType: string; count: number }> = [];
  for (const item of executionItems) {
    const ct = String(item.content_type ?? 'post').toLowerCase();
    const platforms = Array.isArray(item.selected_platforms) && item.selected_platforms.length > 0
      ? item.selected_platforms
      : [];
    if (platforms.length === 0) continue;
    const platformCounts = item.platform_counts && typeof item.platform_counts === 'object' ? item.platform_counts : null;
    for (const platform of platforms) {
      const count = platformCounts
        ? (Number(platformCounts[platform]) || 0)
        : Math.ceil((Number(item.count_per_week) || 0) / Math.max(platforms.length, 1));
      if (count > 0) slots.push({ platform: platform.toLowerCase(), contentType: ct, count });
    }
  }
  return slots;
}

/**
 * Expand frequency requests into a flat interleaved slot list (no day assignment yet).
 * Interleaves platforms round-robin so different platforms alternate in the expansion.
 */
function expandFrequencyRequests(
  requests: Array<{ platform: string; contentType: string; count: number }>
): Array<{ platform: string; contentType: string }> {
  const expanded: Array<{ platform: string; contentType: string }> = [];
  const maxCount = Math.max(...requests.map((r) => r.count), 0);
  for (let round = 0; round < maxCount; round++) {
    for (const req of requests) {
      if (round < req.count) expanded.push({ platform: req.platform, contentType: req.contentType });
    }
  }
  return expanded;
}

/**
 * Generate from AI using full campaign + blueprint context.
 * Used by: AI fallback when blueprint lacks execution_items.
 */
export async function generateFromAI(
  campaignId: string,
  weekNumber: number
): Promise<{ rowsInserted: number }> {
  log('AI', 'generateFromAI', { campaignId, weekNumber });

  // Fetch full campaign data for rich context
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name, start_date, description, target_audience, company_id, brand_voice, objective')
    .eq('id', campaignId)
    .maybeSingle();

  const cam = campaign as {
    name?: string; start_date?: string; description?: string;
    target_audience?: string; company_id?: string; brand_voice?: string; objective?: string;
  } | null;

  const campaignName = cam?.name ?? 'Campaign';
  const companyId = cam?.company_id ?? undefined;

  let startDate: string = cam?.start_date?.split?.('T')?.[0] ?? '';
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - (weekNumber - 1) * 7);
    startDate = fallback.toISOString().slice(0, 10);
  }

  // Fetch blueprint week for full strategic context
  const blueprint = await getUnifiedCampaignBlueprint(campaignId);
  const weekData = blueprint?.weeks?.find(
    (w: any) => Number(w?.week_number ?? w?.week) === weekNumber
  ) as unknown as {
    theme?: string; phase_label?: string; primary_objective?: string;
    topics_to_cover?: string[]; weeklyContextCapsule?: Record<string, string>;
    topics?: Array<{
      topicTitle?: string; writingIntent?: string; whoAreWeWritingFor?: string;
      whatProblemAreWeAddressing?: string; whatShouldReaderLearn?: string;
      desiredAction?: string; narrativeStyle?: string;
      contentTypeGuidance?: { primaryFormat?: string };
      topicContext?: { recommendedContentTypes?: string[]; platformPriority?: string[] };
      recommendedContentTypes?: string[]; platformPriority?: string[];
    }>;
    platform_allocation?: Record<string, number>;
    content_type_mix?: string[]; cta_type?: string;
  } | undefined;

  const weekTheme = weekData?.theme ?? weekData?.phase_label ?? `Week ${weekNumber}`;

  // Derive platform list from allocation (sorted by allocation %) or fallback
  const allocationMap = weekData?.platform_allocation ?? {};
  const platforms = Object.keys(allocationMap).length > 0
    ? Object.entries(allocationMap)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .map(([p]) => p)
    : ['linkedin', 'instagram', 'x'];

  const contentTypeMix = weekData?.content_type_mix?.length
    ? weekData.content_type_mix
    : ['post', 'article', 'short-video'];

  // Map WeeklyTopicWritingBrief[] to WeeklyGenerationContext topics
  const topics: WeeklyGenerationContext['topics'] = weekData?.topics?.map((t) => ({
    topicTitle: t.topicTitle ?? '',
    writingIntent: t.writingIntent,
    whoAreWeWritingFor: t.whoAreWeWritingFor,
    whatProblemAreWeAddressing: t.whatProblemAreWeAddressing,
    whatShouldReaderLearn: t.whatShouldReaderLearn,
    desiredAction: t.desiredAction,
    narrativeStyle: t.narrativeStyle,
    recommendedContentTypes:
      t.recommendedContentTypes ?? (t.contentTypeGuidance?.primaryFormat ? [t.contentTypeGuidance.primaryFormat] : undefined),
    platformPriority: t.platformPriority ?? t.topicContext?.platformPriority,
  }));

  const capsule = weekData?.weeklyContextCapsule as {
    primaryPainPoint?: string; desiredTransformation?: string; psychologicalGoal?: string;
    toneGuidance?: string; audienceProfile?: string; weeklyIntent?: string;
  } | undefined;

  // Derive frequency slots from execution_items (blueprint) or campaign_planning_inputs
  let frequencySlots: ScheduledSlot[] | undefined;
  const rawExecutionItems = (weekData as any)?.execution_items;
  if (Array.isArray(rawExecutionItems) && rawExecutionItems.length > 0) {
    const slotsFromBlueprint = deriveFrequencySlotsFromExecutionItems(rawExecutionItems);
    if (slotsFromBlueprint.length > 0) {
      const expanded = expandFrequencyRequests(slotsFromBlueprint);
      if (expanded.length > 0) {
        frequencySlots = await scheduleSlotIntelligently(expanded, startDate, weekNumber, {
          campaignName,
          targetAudience: cam?.target_audience ?? undefined,
          brandVoice: cam?.brand_voice ?? undefined,
        });
        log('AI', 'frequencySlots from execution_items (intelligent)', { weekNumber, count: frequencySlots.length });
      }
    }
  }
  if (!frequencySlots || frequencySlots.length === 0) {
    try {
      const planningInputs = await getCampaignPlanningInputs(campaignId);
      const pcr = planningInputs?.platform_content_requests;
      if (pcr && Array.isArray(pcr) && pcr.length > 0) {
        const slotsFromInputs = (pcr as any[]).map((r: any) => ({
          platform: String(r.platform ?? '').toLowerCase(),
          contentType: String(r.content_type ?? 'post').toLowerCase(),
          count: Math.max(0, Math.floor(Number(r.count_per_week ?? r.count ?? 0))),
        })).filter((r) => r.platform && r.count > 0);
        if (slotsFromInputs.length > 0) {
          const expanded = expandFrequencyRequests(slotsFromInputs);
          if (expanded.length > 0) {
            frequencySlots = await scheduleSlotIntelligently(expanded, startDate, weekNumber, {
              campaignName,
              targetAudience: cam?.target_audience ?? undefined,
              brandVoice: cam?.brand_voice ?? undefined,
            });
            log('AI', 'frequencySlots from platform_content_requests (intelligent)', { weekNumber, count: frequencySlots.length });
          }
        }
      }
    } catch (e) {
      console.warn('[generateFromAI] Could not load planning inputs for frequency:', e instanceof Error ? e.message : String(e));
    }
  }

  const ctx: WeeklyGenerationContext = {
    campaignId,
    companyId,
    campaignName,
    campaignDescription: cam?.description ?? undefined,
    campaignObjective: cam?.objective ?? undefined,
    targetAudience: cam?.target_audience ?? undefined,
    brandVoice: cam?.brand_voice ?? undefined,
    weekNumber,
    weekTheme,
    weekPhaseLabel: weekData?.phase_label ?? undefined,
    weekPrimaryObjective: weekData?.primary_objective ?? undefined,
    weekContextCapsule: capsule,
    topics: topics?.length ? topics : undefined,
    topicsToCover: weekData?.topics_to_cover ?? undefined,
    platforms,
    contentTypeMix,
    ctaType: weekData?.cta_type ?? undefined,
    ...(frequencySlots && frequencySlots.length > 0 ? { frequencySlots } : {}),
  };

  const dayPlans = await generateDailyPlansWithAI(ctx);

  const rows: ExecutionPlanRow[] = dayPlans
    .filter((p) => p?.dayOfWeek)
    .map((plan) => {
      const date = computeDayDate({ campaignStart: startDate, weekNumber, dayOfWeek: plan.dayOfWeek });
      const contentObj: Record<string, unknown> = {
        topicTitle: plan.title,
        dailyObjective: plan.dailyObjective,
        writingIntent: plan.writingIntent,
        whoAreWeWritingFor: plan.whoAreWeWritingFor,
        whatProblemAreWeAddressing: plan.whatProblemAreWeAddressing,
        whatShouldReaderLearn: plan.whatShouldReaderLearn,
        desiredAction: plan.desiredAction,
        narrativeStyle: plan.narrativeStyle,
        creatorInstruction: plan.creatorInstruction ?? '',
        platform: plan.platform.toLowerCase(),
        contentType: plan.contentType.toLowerCase(),
      };
      if ((plan as any).topic_part !== undefined) contentObj.topic_part = (plan as any).topic_part;
      if ((plan as any).topic_total !== undefined) contentObj.topic_total = (plan as any).topic_total;
      return {
        campaign_id: campaignId,
        week_number: weekNumber,
        day_of_week: plan.dayOfWeek,
        date,
        platform: plan.platform.toLowerCase(),
        content_type: plan.contentType.toLowerCase(),
        title: plan.title || `${plan.dayOfWeek} content`,
        content: JSON.stringify(contentObj),
        hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : [],
        scheduled_time: plan.optimalTime ?? '09:00',
        status: 'planned',
        priority: 'medium',
        ai_generated: true,
        target_audience: ctx.targetAudience ?? '',
      } as ExecutionPlanRow;
    });

  return saveWeekPlans(campaignId, weekNumber, rows, 'AI');
}

/**
 * Generate from board state.
 * Used by: Board automation when board activities are converted to daily plans.
 */
export async function generateFromBoard(
  campaignId: string,
  weekNumber: number,
  boardActivities: Array<{ dayOfWeek: string; platform?: string; contentType?: string; title?: string }>
): Promise<{ rowsInserted: number }> {
  log('board', 'generateFromBoard', { campaignId, weekNumber, count: boardActivities.length });

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, start_date')
    .eq('id', campaignId)
    .maybeSingle();

  let startDate: string =
    (campaign as { start_date?: string } | null)?.start_date?.split?.('T')?.[0] ?? '';
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - (weekNumber - 1) * 7);
    startDate = fallback.toISOString().slice(0, 10);
  }

  const rows: ExecutionPlanRow[] = boardActivities
    .filter((a) => a?.dayOfWeek && DAYS_ORDER.includes(a.dayOfWeek))
    .map((a) => {
      const date = computeDayDate({ campaignStart: startDate, weekNumber, dayOfWeek: a.dayOfWeek });
      const platform = (a.platform || 'linkedin').toLowerCase();
      const contentType = (a.contentType || 'post').toLowerCase();
      const contentObj = {
        topicTitle: a.title || `${a.dayOfWeek} content`,
        dailyObjective: '',
        writingIntent: '',
        platform,
        contentType,
        desiredAction: '',
        whatProblemAreWeAddressing: '',
        whatShouldReaderLearn: '',
      };
      return {
        campaign_id: campaignId,
        week_number: weekNumber,
        day_of_week: a.dayOfWeek,
        date,
        platform,
        content_type: contentType,
        title: a.title || `${a.dayOfWeek} content`,
        content: JSON.stringify(contentObj),
        hashtags: [],
        scheduled_time: '09:00',
        status: 'planned',
        priority: 'medium',
        ai_generated: false,
        target_audience: '',
      } as ExecutionPlanRow;
    });

  return saveWeekPlans(campaignId, weekNumber, rows, 'board');
}

/**
 * Generate from manual planner (structured plan).
 * Used by: Manual campaign builder finalize.
 */
export async function generateFromManualPlanner(params: {
  campaignId: string;
  companyId: string;
  plan: { weeks: unknown[] };
  startDate?: string;
}): Promise<void> {
  log('manual', 'generateFromManualPlanner', { campaignId: params.campaignId, weeksCount: params.plan.weeks?.length });
  // Uses same blueprint path as campaign planner
  const { runPlannerCommitAndGenerateWeekly } = await import('./boltPipelineService');
  await runPlannerCommitAndGenerateWeekly(params);
}
