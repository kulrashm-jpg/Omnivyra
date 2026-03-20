/**
 * Daily Execution Planner — single-week focus.
 * Week selector → 7-day strip → selected day panel.
 * Features: Regenerate (per week), click activity → Activity Content Workspace.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle, Loader2, Sparkles, X } from 'lucide-react';
import AIGenerationProgress from '@/components/AIGenerationProgress';
import { blueprintItemToUnifiedExecutionUnit } from '@/lib/planning/unifiedExecutionAdapter';
import { applyDistributionForWeek } from '@/lib/planning/distributionEngine';
import { detectMasterContentGroups } from '@/lib/planning/masterContentGrouping';
import { buildRepurposingContext } from '@/lib/planning/repurposingContext';
import { buildMasterContentDocument } from '@/lib/planning/masterContentDocument';
import { CampaignDailyPlanSingleWeekView } from '@/components/campaign-daily-plan/CampaignDailyPlanSingleWeekView';
import type { UnifiedExecutionUnit } from '@/lib/planning/unifiedExecutionAdapter';
import { fetchWithAuth } from '@/components/community-ai/fetchWithAuth';
import { useCampaignResume } from '@/hooks/useCampaignResume';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

type GridActivity = {
  id: string;
  execution_id: string;
  week_number: number;
  day: string;
  title: string;
  platform: string;
  content_type: string;
  raw_item: Record<string, unknown>;
  /** When set, item can be moved via save-week-daily-plan */
  planId?: string;
  /** When set, ownership border is applied (additive). */
  execution_mode?: string;
  /** Creator brief for preview line (from weekly enrichment). */
  creator_instruction?: Record<string, unknown>;
  /** Source of the plan row: 'AI', 'blueprint', or null (unknown). */
  generation_source?: string | null;
};

function nonEmpty(v: unknown): string {
  return String(v ?? '').trim();
}

export default function CampaignDailyPlanPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
  const focusWeek = Number(Array.isArray(router.query.week) ? router.query.week[0] : (router.query.week ?? NaN));
  const focusDay = String(Array.isArray(router.query.day) ? router.query.day[0] : (router.query.day ?? '')).trim();
  const focusDate = String(Array.isArray(router.query.date) ? router.query.date[0] : (router.query.date ?? '')).trim();
  const focusTime = String(Array.isArray(router.query.time) ? router.query.time[0] : (router.query.time ?? '')).trim();

  const resumeParams: Record<string, string> = {};
  if (Number.isFinite(focusWeek) && focusWeek > 0) resumeParams.week = String(focusWeek);
  if (focusDay) resumeParams.day = focusDay;
  useCampaignResume({
    campaignId: id || undefined,
    page: 'campaign-daily-plan',
    extraParams: Object.keys(resumeParams).length > 0 ? resumeParams : undefined,
  });

  const [campaignName, setCampaignName] = useState('');
  const [campaignStartDate, setCampaignStartDate] = useState<string | null>(null);
  const [totalWeeks, setTotalWeeks] = useState(1);
  const [weeklyPlans, setWeeklyPlans] = useState<Array<{ weekNumber?: number; week?: number; theme?: string }>>([]);
  const [planWeeks, setPlanWeeks] = useState<Record<string, unknown>[]>([]);
  const [activities, setActivities] = useState<GridActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingWeek, setRegeneratingWeek] = useState<number | null>(null);
  const [isRepurposeScheduling, setIsRepurposeScheduling] = useState(false);
  const [campaignScheduled, setCampaignScheduled] = useState(false);
  const [showScheduleConfirm, setShowScheduleConfirm] = useState(false);
  const [scheduledPostCount, setScheduledPostCount] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [selectedWeekIndex, setSelectedWeekIndex] = useState(0);
  const [selectedDayIndex, setSelectedDayIndex] = useState(0);

  useEffect(() => {
    if (!notice) return;
    // Keep errors visible; auto-clear success/info after 5s
    if (notice.type === 'error') return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [planRes, weeklyRes, campaignRes, stageRes, dailyRes] = await Promise.all([
        fetchWithAuth(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(id)}`),
        fetchWithAuth(`/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(id)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`),
        companyId ? fetchWithAuth(`/api/campaigns?type=campaign&campaignId=${encodeURIComponent(id)}&companyId=${encodeURIComponent(companyId)}`) : Promise.resolve(null),
        fetchWithAuth(`/api/campaigns/stage-availability-batch?campaignIds=${encodeURIComponent(id)}`),
        fetchWithAuth(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(id)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`),
      ]);

      if (stageRes?.ok) {
        const stageData = await stageRes.json().catch(() => ({}));
        const counts = stageData?.availability?.[id]?.counts ?? {};
        const scheduledPosts = Number(counts?.scheduledPosts ?? 0);
        setCampaignScheduled(scheduledPosts > 0);
      }

      let name = 'Daily Content Plan';
      let durationWeeks: number | null = null;
      let startDate: string | null = null;
      if (campaignRes?.ok) {
        const cp = await campaignRes.json().catch(() => ({}));
        if (cp?.campaign?.name) name = cp.campaign.name;
        durationWeeks = (cp?.campaign as any)?.duration_weeks ?? null;
        const raw = (cp?.campaign as any)?.start_date;
        startDate = typeof raw === 'string' && raw.trim() ? raw.trim().split('T')[0] : null;
      }
      setCampaignName(name);
      setCampaignStartDate(startDate);

      const plans: Array<{ weekNumber?: number; week?: number; theme?: string }> = [];
      if (weeklyRes.ok) {
        const w = await weeklyRes.json().catch(() => ({}));
        const plansArray = Array.isArray(w) ? w : (Array.isArray((w as any)?.plans) ? (w as any).plans : []);
        plans.push(...plansArray);
      }
      setWeeklyPlans(plans);

      const payload = planRes.ok ? await planRes.json().catch(() => ({})) : {};
      const rawPlanWeeks = (Array.isArray(payload?.draftPlan?.weeks) && payload.draftPlan.weeks.length > 0 ? payload.draftPlan.weeks : (Array.isArray(payload?.committedPlan?.weeks) ? payload.committedPlan.weeks : [])) || [];
      setPlanWeeks(rawPlanWeeks);
      const totalFromPlan = rawPlanWeeks.length;
      const totalFromWeekly = plans.length;
      const strategyDuration = Number((payload?.draftPlan?.strategy_context ?? payload?.committedPlan?.strategy_context)?.duration_weeks) || 0;
      setTotalWeeks(Math.max(1, durationWeeks ?? 0, strategyDuration, totalFromPlan, totalFromWeekly));

      let memoryProfile: { campaign_id: string; action_acceptance_rate: Record<string, number>; platform_confidence_average: Record<string, number>; total_events: number } | null = null;
      if (id) {
        try {
          const profileRes = await fetchWithAuth(`/api/intelligence/strategic-memory?campaignId=${encodeURIComponent(id)}`);
          if (profileRes?.ok) memoryProfile = await profileRes.json().catch(() => null);
        } catch {
          // non-blocking
        }
      }
      const mapped: GridActivity[] = [];

      // Prefer daily_content_plans when it has data (execution engine is source of truth for populated campaigns)
      const dailyPayload = dailyRes.ok ? await dailyRes.json().catch(() => []) : [];
      const dailyPlans: any[] = Array.isArray(dailyPayload) ? dailyPayload : [];
      if (!dailyRes.ok) {
        if (typeof window !== 'undefined') {
          console.warn('[DAILY_PLAN_TRACE] daily-plans API returned', dailyRes.status, '- auth or server error; check you have access to this campaign');
        }
        setNotice({
          type: dailyRes.status === 401 || dailyRes.status === 403 ? 'error' : 'info',
          message:
            dailyRes.status === 401
              ? 'Sign in to load daily plans. Activities in the database will appear once authenticated.'
              : dailyRes.status === 403
                ? 'You do not have access to this campaign. Daily plans require campaign role.'
                : `Daily plans API returned ${dailyRes.status}. Check console for details.`,
        });
      }
      if (dailyPlans.length > 0) {
        dailyPlans.forEach((plan: any, idx: number) => {
          const weekNumber = Number(plan.weekNumber ?? plan.week_number ?? 1) || 1;
          const dayOfWeek = nonEmpty(plan.dayOfWeek ?? plan.day_of_week) || 'Monday';
          const title = nonEmpty(plan.title ?? plan.topic ?? (plan.dailyObject as any)?.topicTitle) || 'Untitled';
          const raw = (plan.dailyObject && typeof plan.dailyObject === 'object') ? plan.dailyObject : plan;
          const execution_mode = typeof (raw?.execution_mode ?? plan?.execution_mode) === 'string' ? (raw?.execution_mode ?? plan?.execution_mode) : undefined;
          const creator_instruction = (raw?.creator_instruction ?? (plan as any)?.creator_instruction) && typeof (raw?.creator_instruction ?? (plan as any)?.creator_instruction) === 'object' ? (raw?.creator_instruction ?? (plan as any)?.creator_instruction) as Record<string, unknown> : undefined;
          mapped.push({
            id: String(plan.id ?? `daily-${weekNumber}-${idx}`),
            execution_id: String(plan.id ?? `daily-${weekNumber}-${idx}`),
            week_number: weekNumber,
            day: dayOfWeek,
            title,
            platform: nonEmpty(plan.platform).toLowerCase() || 'linkedin',
            content_type: String(plan.content_type ?? (plan.dailyObject as any)?.contentType ?? 'post').toLowerCase(),
            raw_item: raw,
            planId: plan.id,
            ...(execution_mode ? { execution_mode } : {}),
            ...(creator_instruction ? { creator_instruction } : {}),
            generation_source: plan.generation_source ?? null,
          });
        });
        if (typeof window !== 'undefined') {
          console.log('[DAILY_PLAN_TRACE] loadData: loaded', mapped.length, 'activities from daily_content_plans (preferred)');
        }
      }

      // Fallback to blueprint when daily_content_plans is empty
      if (mapped.length === 0) {
        for (const week of rawPlanWeeks) {
          const weekNumber = Number((week as any)?.week ?? (week as any)?.week_number ?? 0) || 0;
          const items = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
          const units = items.map((item: any) => blueprintItemToUnifiedExecutionUnit(item, week, id));
          const result = applyDistributionForWeek(units, week as Record<string, unknown>, memoryProfile);
          const distributedUnits = result.units;
          detectMasterContentGroups(distributedUnits);
          distributedUnits.forEach((unit, itemIndex: number) => {
            const item = items[itemIndex];
            const execution_id = unit.execution_id || `execution-${weekNumber}-${itemIndex}`;
            const day = unit.day || DAYS[itemIndex % 7];
            mapped.push({
              id: execution_id,
              execution_id,
              week_number: unit.week_number,
              day,
              title: unit.title,
              platform: unit.platform,
              content_type: unit.content_type ?? 'post',
              raw_item: item && typeof item === 'object' ? item : {},
              ...(unit.execution_mode ? { execution_mode: unit.execution_mode } : {}),
              ...(unit.creator_instruction ? { creator_instruction: unit.creator_instruction } : {}),
            });
          });
        }
        if (typeof window !== 'undefined' && mapped.length > 0) {
          console.log('[DAILY_PLAN_TRACE] loadData: loaded', mapped.length, 'activities from blueprint (fallback)');
        }
      }

      setActivities(mapped);
    } catch (err: any) {
      setError(err?.message || 'Failed to load plan');
    } finally {
      setIsLoading(false);
    }
  }, [id, companyId]);

  const loadDataRef = useRef<() => Promise<void> | null>(null);
  loadDataRef.current = loadData;

  const handleRepurposeAndSchedule = useCallback(async () => {
    if (!id || isRepurposeScheduling) return;
    setIsRepurposeScheduling(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetchWithAuth(`/api/campaigns/${id}/repurpose-and-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || data?.message || 'Failed to repurpose and schedule.';
        setNotice({ type: 'error', message: msg });
        return;
      }
      const count = data?.scheduledPostsCreated ?? data?.scheduled ?? data?.count ?? data?.rowsScheduled ?? data?.scheduledCount ?? null;
      const alreadyDone = data?.alreadyScheduled ?? 0;
      if (count != null) setScheduledPostCount(Number(count));
      const msg = count === 0 && alreadyDone > 0
        ? `All ${alreadyDone} activities are already scheduled.`
        : count != null
          ? `${count} new post${count !== 1 ? 's' : ''} scheduled${alreadyDone > 0 ? ` (${alreadyDone} already scheduled, skipped)` : ''}.`
          : 'Campaign scheduled successfully.';
      setNotice({ type: 'success', message: msg });
      setCampaignScheduled(true);
      setShowScheduleConfirm(false);
      await loadDataRef.current?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to repurpose and schedule.';
      setNotice({ type: 'error', message: msg });
    } finally {
      setIsRepurposeScheduling(false);
    }
  }, [id, isRepurposeScheduling, fetchWithAuth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Dynamic week generation from campaign duration */
  const weeksToShow = React.useMemo(
    () => Array.from({ length: totalWeeks }, (_, i) => i + 1),
    [totalWeeks]
  );

  /** Add days to date string */
  const addDays = useCallback((start: string | null, days: number): string => {
    if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().slice(0, 10);
    }
    const base = new Date(start + 'T00:00:00');
    base.setDate(base.getDate() + days);
    return base.toISOString().slice(0, 10);
  }, []);

  const getWeekdayName = useCallback((iso: string): string => {
    try {
      return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    } catch {
      return 'Monday';
    }
  }, []);

  /** Default selection on initial load: Week 1 (or focusWeek), first day with activities or day 0 */
  const initialSelectionDone = useRef(false);
  useEffect(() => {
    if (isLoading || initialSelectionDone.current) return;
    initialSelectionDone.current = true;
    const focusWeekNum = Number.isFinite(focusWeek) && focusWeek >= 1 ? focusWeek : 1;
    const idx = weeksToShow.indexOf(focusWeekNum);
    if (idx >= 0) setSelectedWeekIndex(idx);
    const wn = weeksToShow[idx >= 0 ? idx : 0] ?? 1;
    const weekActs = activities.filter((a) => a.week_number === wn);
    for (let i = 0; i < 7; i++) {
      const dateStr = addDays(campaignStartDate, idx >= 0 ? idx * 7 + i : i);
      const weekday = getWeekdayName(dateStr);
      if (weekActs.some((a) => (a.day ?? '').toLowerCase() === weekday.toLowerCase())) {
        setSelectedDayIndex(i);
        return;
      }
    }
    if (focusDay) {
      const dayIdx = DAYS.findIndex((d) => d.toLowerCase() === focusDay.toLowerCase());
      if (dayIdx >= 0) setSelectedDayIndex(dayIdx);
    } else {
      setSelectedDayIndex(0);
    }
  }, [isLoading, weeksToShow, activities, campaignStartDate, focusWeek, focusDay, addDays, getWeekdayName]);

  /** When week changes: select first day with activities or day 0 */
  const handleWeekSelect = useCallback(
    (wn: number) => {
      const idx = weeksToShow.indexOf(wn);
      setSelectedWeekIndex(idx >= 0 ? idx : 0);
      const weekNumber = weeksToShow[idx >= 0 ? idx : 0] ?? 1;
      const weekActs = activities.filter((a) => a.week_number === weekNumber);
      for (let i = 0; i < 7; i++) {
        const dateStr = addDays(campaignStartDate, (idx >= 0 ? idx : 0) * 7 + i);
        const weekday = getWeekdayName(dateStr);
        if (weekActs.some((a) => (a.day ?? '').toLowerCase() === weekday.toLowerCase())) {
          setSelectedDayIndex(i);
          return;
        }
      }
      setSelectedDayIndex(0);
    },
    [weeksToShow, activities, campaignStartDate, addDays, getWeekdayName]
  );

  /** Staggered times for multiple platforms on the same day. */
  const STAGGERED_TIMES = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00', '18:30', '20:00'];

  const openActivityWorkspace = (activity: GridActivity) => {
    const raw = activity.raw_item;
    // For AI-generated plans, `raw` is the API plan object. Parse rich data from content JSON if available.
    const parsedContent = (() => {
      try {
        const c = (raw as any)?.content ?? (raw as any)?.dailyObject;
        if (c && typeof c === 'string' && c.startsWith('{')) return JSON.parse(c) as Record<string, unknown>;
        if (c && typeof c === 'object') return c as Record<string, unknown>;
        return null;
      } catch { return null; }
    })();
    const richRaw: Record<string, unknown> = parsedContent ? { ...raw, ...parsedContent } : (raw as Record<string, unknown>);
    const hasNested = (richRaw as any)?.writer_content_brief != null || (richRaw as any)?.intent != null;
    const dailyExecutionItem = hasNested
      ? { ...richRaw }
      : {
          ...richRaw,
          topic: activity.title,
          title: activity.title,
          platform: activity.platform,
          content_type: activity.content_type,
          intent: {
            objective: (richRaw as any)?.dailyObjective ?? (richRaw as any)?.objective,
            pain_point: (richRaw as any)?.whatProblemAreWeAddressing ?? (richRaw as any)?.summary,
            outcome_promise: (richRaw as any)?.whatShouldReaderLearn ?? (richRaw as any)?.introObjective,
            cta_type: (richRaw as any)?.desiredAction ?? (richRaw as any)?.cta,
          },
          writer_content_brief: {
            topicTitle: (richRaw as any)?.topicTitle ?? (richRaw as any)?.topic ?? activity.title,
            writingIntent: (richRaw as any)?.writingIntent ?? (richRaw as any)?.description,
            whatShouldReaderLearn: (richRaw as any)?.whatShouldReaderLearn ?? (richRaw as any)?.introObjective,
            whatProblemAreWeAddressing: (richRaw as any)?.whatProblemAreWeAddressing ?? (richRaw as any)?.summary,
            desiredAction: (richRaw as any)?.desiredAction ?? (richRaw as any)?.cta,
            narrativeStyle: (richRaw as any)?.narrativeStyle ?? (richRaw as any)?.brandVoice,
            topicGoal: (richRaw as any)?.dailyObjective ?? (richRaw as any)?.objective,
          },
        };

    const normalizeTitle = (t: string) => String(t ?? '').trim().toLowerCase();
    const sameTopic = normalizeTitle(activity.title);
    // Match all platforms for this topic across the whole week (not just same day)
    const activitiesForThisTopic = activities.filter(
      (a) =>
        a.week_number === activity.week_number &&
        normalizeTitle(a.title) === sameTopic
    );

    const computeDateForDay = (day: string): string => {
      if (!campaignStartDate) return '';
      try {
        const dayIndex = DAYS.map((d) => d.toLowerCase()).indexOf(String(day || '').trim().toLowerCase());
        const safeDayIndex = dayIndex >= 0 ? dayIndex : 0;
        const base = new Date(campaignStartDate + 'T12:00:00');
        base.setDate(base.getDate() + (activity.week_number - 1) * 7 + safeDayIndex);
        return base.toISOString().slice(0, 10);
      } catch {
        return '';
      }
    };

    const totalDistributions = activitiesForThisTopic.length;
    const schedules = activitiesForThisTopic.map((a, idx) => ({
      id: a.planId ? `plan-${a.planId}` : `repurpose-${a.execution_id}-${idx}`,
      executionId: a.execution_id,
      platform: a.platform.toLowerCase(),
      contentType: a.content_type || 'post',
      date: computeDateForDay(a.day),
      time: STAGGERED_TIMES[idx % STAGGERED_TIMES.length],
      status: 'planned',
      title: activity.title,
      description: String((richRaw as any)?.writingIntent ?? (richRaw as any)?.description ?? ''),
      sequence_index: idx + 1,
      total_distributions: totalDistributions,
      isPrimary: a.execution_id === activity.execution_id,
    }));

    const weekActivities = activities.filter((a) => a.week_number === activity.week_number);
    const unitsForContext: UnifiedExecutionUnit[] = weekActivities.map((a) => ({
      execution_id: a.execution_id,
      campaign_id: id,
      week_number: a.week_number,
      title: a.title,
      platform: a.platform,
      content_type: a.content_type ?? 'post',
      source_type: 'BLUEPRINT_EXECUTION' as const,
      topic: a.title,
    }));
    const repurposing_context = buildRepurposingContext(unitsForContext, activity.execution_id);
    const master_content_document = buildMasterContentDocument(
      repurposing_context,
      activity.execution_id
    );

    const workspaceKey = `activity-workspace-${id}-${activity.execution_id}`;
    const payload = {
      campaignId: id,
      weekNumber: activity.week_number,
      day: activity.day,
      activityId: activity.execution_id,
      title: activity.title,
      topic: activity.title,
      description: String((richRaw as any)?.writingIntent ?? (richRaw as any)?.description ?? ''),
      dailyExecutionItem,
      source: 'daily' as const,
      schedules,
      ...(repurposing_context != null ? { repurposing_context } : {}),
      ...(master_content_document != null ? { master_content_document } : {}),
    };
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
        window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
      }
    } catch (e) {
      console.error('Failed to open Activity Content Workspace', e);
    }
  };

  const [generatingFromAI, setGeneratingFromAI] = useState(false);

  /** Drag-and-drop: save updated day assignments to DB via save-week-daily-plan */
  const handleSaveDayChanges = useCallback(async (weekNumber: number, moves: Array<{ planId: string; day: string }>) => {
    if (!id || moves.length === 0) return;
    try {
      const res = await fetchWithAuth('/api/campaigns/save-week-daily-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: id,
          weekNumber,
          items: moves.map((m) => ({ id: m.planId, dayOfWeek: m.day })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setNotice({ type: 'error', message: err?.error || 'Failed to save day changes.' });
        return;
      }
      setNotice({ type: 'success', message: 'Day assignments saved.' });
      await loadDataRef.current?.();
    } catch (e) {
      setNotice({ type: 'error', message: e instanceof Error ? e.message : 'Failed to save day changes.' });
    }
  }, [id, fetchWithAuth]);

  /** Source B: AI expansion — single API call generates 7 days and persists to daily_content_plans */
  const handleGenerateFromAI = useCallback(async (weekNumber: number) => {
    if (!id || generatingFromAI) return;
    if (typeof window !== 'undefined') console.log('[DAILY_PLAN_TRACE] BUTTON_TRIGGERED Generate from AI', { weekNumber });
    setGeneratingFromAI(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/generate-ai-daily-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: id,
          weekNumber,
          companyId: companyId || undefined,
          provider: 'demo',
        }),
      });
      const data = res.ok ? await res.json().catch(() => ({})) : null;
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || errData?.details || 'Failed to generate daily plans');
      }
      const rowsInserted = data?.rowsInserted ?? 7;
      setNotice({ type: 'success', message: `Generated ${rowsInserted} daily plans.` });
      await loadDataRef.current?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate from AI.';
      setError(msg);
      setNotice({ type: 'error', message: msg });
    } finally {
      setGeneratingFromAI(false);
    }
  }, [id, companyId, fetchWithAuth, generatingFromAI]);

  const handleRegenerateWeek = async (weekNumber: number) => {
    if (typeof window !== 'undefined') console.log('[DAILY_PLAN_TRACE] BUTTON_TRIGGERED Regenerate', { weekNumber });
    setRegeneratingWeek(weekNumber);
    setError(null);
    try {
      const res = await fetchWithAuth('/api/campaigns/generate-weekly-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: id,
          companyId: companyId || undefined,
          week: weekNumber,
          theme: weeklyPlans.find((p) => (p.weekNumber ?? p.week) === weekNumber)?.theme || `Week ${weekNumber} Theme`,
          contentFocus: '',
          targetAudience: 'General Audience',
          distribution_mode: 'staggered',
        }),
      });
      if (res.ok) {
        await loadData();
        setNotice({ type: 'success', message: 'Week regenerated — plans updated with latest frequency and content type settings.' });
        return;
      }
      // Blueprint-based generation failed for any reason — always fall back to AI.
      await handleGenerateFromAI(weekNumber);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to regenerate week. Try again.');
    } finally {
      setRegeneratingWeek(null);
    }
  };

  if (!id) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">No campaign selected.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading daily plan…</div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Daily Execution Planner{campaignName ? ` — ${campaignName}` : ''}</title>
      </Head>
      {generatingFromAI && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md">
            <AIGenerationProgress
              isActive={true}
              message="Generating 7 daily plans"
              expectedSeconds={25}
              maxSecondsHint={60}
              rotatingMessages={[
                'Generating Monday…',
                'Generating Tuesday…',
                'Generating Wednesday…',
                'Generating Thursday…',
                'Generating Friday…',
                'Generating Saturday…',
                'Generating Sunday…',
                'Saving to database…',
              ]}
            />
          </div>
        </div>
      )}
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => router.push(`/campaign-details/${id}${companyId ? `?companyId=${companyId}` : ''}`)}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 active:scale-[0.98] transition-transform px-2 py-1 rounded hover:bg-gray-100 self-start"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to campaign
            </button>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900">
              Daily Execution Planner{campaignName ? ` — ${campaignName}` : ''}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => router.push(`/campaign-calendar/${id}${companyId ? `?companyId=${companyId}` : ''}`)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-sm font-medium"
                title="Open calendar view"
              >
                <Calendar className="w-4 h-4" />
                Calendar
              </button>
              {!campaignScheduled ? (
                <button
                  onClick={() => setShowScheduleConfirm(true)}
                  disabled={isRepurposeScheduling}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-medium disabled:opacity-50"
                  title="Generate platform-specific content for every activity and place on the posting calendar"
                >
                  {isRepurposeScheduling ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Scheduling…
                    </>
                  ) : (
                    'Repurpose & Schedule Campaign'
                  )}
                </button>
              ) : (
                <span className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-100 text-emerald-800 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Scheduled{scheduledPostCount != null ? ` (${scheduledPostCount})` : ''}
                </span>
              )}
            </div>
          </div>

          {notice && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2 text-sm ${
                notice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : notice.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-sky-200 bg-sky-50 text-sky-800'
              }`}
            >
              {notice.message}
            </div>
          )}

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-2 text-sm">
              {error}
            </div>
          )}

          <p className="text-sm text-gray-600 mb-4">
            Select a week and day to view activities. Use <strong>Regenerate</strong> to generate daily activities, then <strong>drag activities between days</strong> to rearrange and click <strong>Save day changes</strong>. Click an activity to open the Activity Content Workspace.
          </p>

          {(focusDate || focusTime) && (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 flex items-center gap-2">
              <Calendar className="w-4 h-4 shrink-0" />
              <span>
                Viewing:{focusDate ? (
                  (() => {
                    const d = new Date(focusDate + 'T00:00:00');
                    const formatted = Number.isFinite(d.getTime())
                      ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                      : focusDate;
                    return <>{formatted}</>;
                  })()
                ) : null}
                {focusTime && (
                  <span className="ml-1">
                    {focusDate ? ' at ' : ''}
                    {/^\d{1,2}(:\d{2})?$/.test(focusTime)
                      ? (() => {
                          const [h, m = 0] = focusTime.split(':').map(Number);
                          const hour = h % 12 || 12;
                          const ampm = h < 12 ? 'AM' : 'PM';
                          return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
                        })()
                      : focusTime}
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
            {weeksToShow.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <p className="text-sm text-gray-600">No weeks in this plan yet.</p>
                <p className="text-xs text-gray-400">Go back to Campaign Details to generate a week plan, then return here.</p>
                <button
                  type="button"
                  onClick={() => router.push(`/campaign-details/${id}${companyId ? `?companyId=${companyId}` : ''}`)}
                  className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                >
                  Go to Campaign Details
                </button>
              </div>
            ) : (
              (() => {
                const weekNumber = weeksToShow[selectedWeekIndex] ?? 1;
                const weekActivities = activities.filter((a) => a.week_number === weekNumber);
                const hasActivities = weekActivities.length > 0;
                return (
                  <>
                    {!hasActivities ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 mb-4 flex items-center justify-between gap-4">
                        <span>No daily activities for Week {weekNumber} yet.</span>
                        <button
                          type="button"
                          onClick={() => handleGenerateFromAI(weekNumber)}
                          disabled={generatingFromAI}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-medium hover:bg-amber-800 disabled:opacity-50"
                        >
                          Generate from AI
                        </button>
                      </div>
                    ) : null}
                    <CampaignDailyPlanSingleWeekView
                      weeksToShow={weeksToShow}
                      activities={activities}
                      weeklyPlans={weeklyPlans}
                      campaignStartDate={campaignStartDate}
                      selectedWeekIndex={selectedWeekIndex}
                      selectedDayIndex={selectedDayIndex}
                      onWeekSelect={handleWeekSelect}
                      onDaySelect={setSelectedDayIndex}
                      onActivityClick={openActivityWorkspace}
                      onRegenerateWeek={handleRegenerateWeek}
                      regeneratingWeek={regeneratingWeek}
                      onGenerateFromAI={handleGenerateFromAI}
                      generatingFromAI={generatingFromAI}
                      onSaveDayChanges={handleSaveDayChanges}
                    />
                  </>
                );
              })()
            )}
          </div>
        </div>
      </div>

      {/* Confirmation dialog for "Repurpose & Schedule" */}
      {showScheduleConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md bg-white rounded-xl shadow-xl border border-gray-200 p-6">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-semibold text-gray-900 mb-1">Schedule entire campaign?</h2>
                <p className="text-sm text-gray-600">
                  This will generate platform-adapted content for every activity in all {totalWeeks} weeks and add them to your posting calendar. Activities already scheduled will be skipped.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowScheduleConfirm(false)}
                disabled={isRepurposeScheduling}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRepurposeAndSchedule}
                disabled={isRepurposeScheduling}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {isRepurposeScheduling ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scheduling…
                  </>
                ) : (
                  'Confirm & Schedule'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-scheduling success banner with View Calendar CTA */}
      {campaignScheduled && (
        <div className="fixed bottom-6 right-6 z-40 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-xl shadow-lg">
          <CheckCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">
            Campaign scheduled{scheduledPostCount != null ? ` — ${scheduledPostCount} posts queued` : ''}
          </span>
          <button
            onClick={() => router.push(`/campaign-calendar/${id}${companyId ? `?companyId=${companyId}` : ''}`)}
            className="ml-2 px-3 py-1 rounded-lg bg-white text-emerald-700 text-xs font-semibold hover:bg-emerald-50"
          >
            View Calendar →
          </button>
          <button
            onClick={() => setCampaignScheduled(false)}
            className="ml-1 text-emerald-200 hover:text-white"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}
