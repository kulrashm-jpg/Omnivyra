/**
 * Daily Content Plan — week×day grid template.
 * Replaces the previous "view plan and work on daily" destination.
 * Features: Regenerate (per week), drag-and-drop activities, click activity → Activity Content Workspace.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Calendar, GripVertical, RefreshCw, ExternalLink } from 'lucide-react';
import { getAiLookingAheadMessage } from '@/lib/aiLookingAheadMessage';
import { getAiStrategicConfidence } from '@/lib/aiStrategicConfidence';
import { getExecutionIntelligence } from '../../utils/getExecutionIntelligence';
import { blueprintItemToUnifiedExecutionUnit } from '@/lib/planning/unifiedExecutionAdapter';
import { applyDistributionForWeek } from '@/lib/planning/distributionEngine';
import { detectMasterContentGroups } from '@/lib/planning/masterContentGrouping';
import { buildRepurposingContext } from '@/lib/planning/repurposingContext';
import { buildMasterContentDocument } from '@/lib/planning/masterContentDocument';
import type { UnifiedExecutionUnit } from '@/lib/planning/unifiedExecutionAdapter';

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
  const weekRefsMap = useRef<Record<number, HTMLDivElement | null>>({});

  const [campaignName, setCampaignName] = useState('');
  const [campaignStartDate, setCampaignStartDate] = useState<string | null>(null);
  const [totalWeeks, setTotalWeeks] = useState(1);
  const [weeklyPlans, setWeeklyPlans] = useState<Array<{ weekNumber?: number; week?: number; theme?: string }>>([]);
  const [activities, setActivities] = useState<GridActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regeneratingWeek, setRegeneratingWeek] = useState<number | null>(null);
  const [dragged, setDragged] = useState<GridActivity | null>(null);
  const [dropTarget, setDropTarget] = useState<{ week: number; day: string } | null>(null);

  const fetchWithAuth = useCallback(async (input: RequestInfo, init?: RequestInit) => {
    const res = await fetch(input, { ...init, credentials: 'include' });
    return res;
  }, []);

  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [planRes, weeklyRes, campaignRes] = await Promise.all([
        fetchWithAuth(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(id)}`),
        fetchWithAuth(`/api/campaigns/get-weekly-plans?campaignId=${encodeURIComponent(id)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`),
        companyId ? fetchWithAuth(`/api/campaigns?type=campaign&campaignId=${encodeURIComponent(id)}&companyId=${encodeURIComponent(companyId)}`) : Promise.resolve(null),
      ]);

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
        const w = await weeklyRes.json().catch(() => []);
        if (Array.isArray(w)) plans.push(...w);
      }
      setWeeklyPlans(plans);

      const payload = planRes.ok ? await planRes.json().catch(() => ({})) : {};
      const planWeeks = (Array.isArray(payload?.draftPlan?.weeks) && payload.draftPlan.weeks.length > 0 ? payload.draftPlan.weeks : (Array.isArray(payload?.committedPlan?.weeks) ? payload.committedPlan.weeks : [])) || [];
      const totalFromPlan = planWeeks.length;
      const totalFromWeekly = plans.length;
      setTotalWeeks(Math.max(1, durationWeeks ?? 0, totalFromPlan, totalFromWeekly));

      const mapped: GridActivity[] = [];
      for (const week of planWeeks) {
        const weekNumber = Number((week as any)?.week ?? (week as any)?.week_number ?? 0) || 0;
        const items = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
        const units = items.map((item: any) => blueprintItemToUnifiedExecutionUnit(item, week, id));
        const distributedUnits = applyDistributionForWeek(units, week as Record<string, unknown>);
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

      if (mapped.length === 0) {
        const dailyRes = await fetchWithAuth(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(id)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`);
        if (dailyRes.ok) {
          const dailyPlans: any[] = await dailyRes.json().catch(() => []);
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
            });
          });
        }
      }

      setActivities(mapped);
    } catch (err: any) {
      setError(err?.message || 'Failed to load plan');
    } finally {
      setIsLoading(false);
    }
  }, [id, companyId, fetchWithAuth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!router.isReady || !Number.isFinite(focusWeek) || isLoading) return;
    const el = weekRefsMap.current[focusWeek];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [router.isReady, focusWeek, isLoading]);

  /** Staggered times for multiple platforms on the same day. */
  const STAGGERED_TIMES = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00', '18:30', '20:00'];

  const openActivityWorkspace = (activity: GridActivity) => {
    const raw = activity.raw_item;
    const hasNested = (raw as any)?.writer_content_brief != null || (raw as any)?.intent != null;
    const dailyExecutionItem = hasNested
      ? { ...raw }
      : {
          ...raw,
          topic: activity.title,
          title: activity.title,
          platform: activity.platform,
          content_type: activity.content_type,
          intent: {
            objective: (raw as any)?.dailyObjective ?? (raw as any)?.objective,
            pain_point: (raw as any)?.whatProblemAreWeAddressing ?? (raw as any)?.summary,
            outcome_promise: (raw as any)?.whatShouldReaderLearn ?? (raw as any)?.introObjective,
            cta_type: (raw as any)?.desiredAction ?? (raw as any)?.cta,
          },
          writer_content_brief: {
            topicTitle: (raw as any)?.topicTitle ?? (raw as any)?.topic ?? activity.title,
            writingIntent: (raw as any)?.writingIntent ?? (raw as any)?.description,
            whatShouldReaderLearn: (raw as any)?.whatShouldReaderLearn ?? (raw as any)?.introObjective,
            whatProblemAreWeAddressing: (raw as any)?.whatProblemAreWeAddressing ?? (raw as any)?.summary,
            desiredAction: (raw as any)?.desiredAction ?? (raw as any)?.cta,
            narrativeStyle: (raw as any)?.narrativeStyle ?? (raw as any)?.brandVoice,
            topicGoal: (raw as any)?.dailyObjective ?? (raw as any)?.objective,
          },
        };

    const normalizeTitle = (t: string) => String(t ?? '').trim().toLowerCase();
    const sameTopic = normalizeTitle(activity.title);
    const activitiesForThisTopicOnDay = activities.filter(
      (a) =>
        a.week_number === activity.week_number &&
        a.day === activity.day &&
        normalizeTitle(a.title) === sameTopic
    );

    const dayIndex = DAYS.map((d) => d.toLowerCase()).indexOf(String(activity.day || '').trim().toLowerCase());
    const safeDayIndex = dayIndex >= 0 ? dayIndex : 0;
    let scheduleDate = '';
    if (campaignStartDate) {
      try {
        const base = new Date(campaignStartDate + 'T12:00:00');
        const offsetDays = (activity.week_number - 1) * 7 + safeDayIndex;
        base.setDate(base.getDate() + offsetDays);
        scheduleDate = base.toISOString().slice(0, 10);
      } catch {
        scheduleDate = '';
      }
    }

    const schedules = activitiesForThisTopicOnDay.map((a, idx) => ({
      id: a.planId ? `plan-${a.planId}` : `repurpose-${a.execution_id}-${idx}`,
      platform: a.platform.toLowerCase(),
      contentType: a.content_type || 'post',
      date: scheduleDate,
      time: STAGGERED_TIMES[idx % STAGGERED_TIMES.length],
      status: 'planned',
      title: activity.title,
      description: String((raw as any)?.writingIntent ?? (raw as any)?.description ?? ''),
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
      description: String((raw as any)?.writingIntent ?? (raw as any)?.description ?? ''),
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

  const handleRegenerateWeek = async (weekNumber: number) => {
    setRegeneratingWeek(weekNumber);
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
      if (res.ok) await loadData();
      else throw new Error('Regenerate failed');
    } catch (e) {
      setError('Failed to regenerate week. Try again.');
    } finally {
      setRegeneratingWeek(null);
    }
  };

  const handleDrop = async (targetWeek: number, targetDay: string) => {
    if (!dragged || !id) return;
    setDropTarget(null);
    setDragged(null);
    if (dragged.week_number === targetWeek && dragged.day === targetDay) return;
    if (dragged.week_number !== targetWeek) return; // only same-week move supported for now
    if (!dragged.planId) return; // only daily_content_plans can be moved
    const res = await fetchWithAuth('/api/campaigns/save-week-daily-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId: id,
        weekNumber: targetWeek,
        items: [{ id: dragged.planId, dayOfWeek: targetDay }],
      }),
    });
    if (res.ok) {
      setActivities((prev) =>
        prev.map((a) =>
          a.id === dragged.id ? { ...a, day: targetDay } : a
        )
      );
    }
  };

  const weeksToShow = React.useMemo(() => {
    return Array.from({ length: totalWeeks }, (_, i) => i + 1);
  }, [totalWeeks]);

  const aiPreviewByWeek = useMemo(() => {
    const m: Record<number, string | null> = {};
    weeklyPlans.forEach((p) => {
      const wn = (p as { weekNumber?: number; week?: number }).weekNumber ?? (p as { week?: number }).week;
      if (wn != null) m[wn] = getAiLookingAheadMessage(p as any);
    });
    return m;
  }, [weeklyPlans]);

  const aiConfidenceByWeek = useMemo(() => {
    const m: Record<number, string | null> = {};
    weeklyPlans.forEach((p) => {
      const wn = (p as { weekNumber?: number; week?: number }).weekNumber ?? (p as { week?: number }).week;
      if (wn != null) m[wn] = getAiStrategicConfidence(p as any);
    });
    return m;
  }, [weeklyPlans]);

  const getActivitiesFor = (weekNumber: number, day: string) =>
    activities.filter((a) => a.week_number === weekNumber && a.day === day);

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
        <title>Daily Content Plan{campaignName ? ` — ${campaignName}` : ''}</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => router.push(`/campaign-planning-hierarchical?campaignId=${id}${companyId ? `&companyId=${companyId}` : ''}`)}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-5 h-5" />
              Back to week plan
            </button>
            <h1 className="text-xl font-bold text-gray-900">
              Daily Content Plan{campaignName ? ` — ${campaignName}` : ''}
            </h1>
            <div />
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 text-red-800 px-4 py-2 text-sm">
              {error}
            </div>
          )}

          <p className="text-sm text-gray-600 mb-4">
            All weeks are shown below. Weeks without daily activities have empty day cells—use <strong>Regenerate</strong> to generate them. Drag activities between days to reorder. Click an activity to open the Activity Content Workspace. Changes here match the weekly plan page.
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

          <div className="space-y-6">
            {weeksToShow.map((weekNumber) => {
              const weekPlan = weeklyPlans.find((p) => (p.weekNumber ?? p.week) === weekNumber);
              const theme = weekPlan?.theme || `Week ${weekNumber} Theme`;
              const distributionStrategy = (weekPlan as any)?.distribution_strategy;
              const distributionReason = (weekPlan as any)?.distribution_reason;
              const planningAdjustmentReason = (weekPlan as any)?.planning_adjustment_reason;
              const planningAdjustmentsSummary = (weekPlan as any)?.planning_adjustments_summary;
              const momentumAdjustments = (weekPlan as any)?.momentum_adjustments;
              const recoveredTopics = (weekPlan as any)?.week_extras?.recovered_topics as Array<{ topic: string; recovered_from_week: number }> | undefined;
              const isRegenerating = regeneratingWeek === weekNumber;
              const isFocusedWeek = Number.isFinite(focusWeek) && focusWeek === weekNumber;
              return (
                <div
                  key={weekNumber}
                  ref={(el) => { weekRefsMap.current[weekNumber] = el; }}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
                  data-week={weekNumber}
                >
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Week {weekNumber}: {theme}</h2>
                    {distributionStrategy && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Distribution: {String(distributionStrategy).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase())}
                      </p>
                    )}
                    {distributionReason && (
                      <p className="text-xs text-gray-500 mt-0.5">Why: {distributionReason}</p>
                    )}
                    {planningAdjustmentReason && (
                      <p className="text-xs text-gray-500 mt-0.5">{planningAdjustmentReason}</p>
                    )}
                    {planningAdjustmentsSummary?.text && (
                      <p className="text-xs text-gray-500 mt-0.5">What changed: {planningAdjustmentsSummary.text}</p>
                    )}
                    {momentumAdjustments?.absorbed_from_week?.length ? (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Momentum adjusted from Week {momentumAdjustments.absorbed_from_week.join(', ')}
                        {momentumAdjustments.momentum_transfer_strength ? (
                          <> · Momentum: {momentumAdjustments.momentum_transfer_strength.charAt(0).toUpperCase() + momentumAdjustments.momentum_transfer_strength.slice(1)} adjustment</>
                        ) : null}
                      </p>
                    ) : null}
                    {recoveredTopics?.length ? (
                      <p className="text-xs text-gray-500 mt-0.5" title={recoveredTopics.map((r) => r.topic).join(', ')}>
                        Narrative recovered from Week {[...new Set(recoveredTopics.map((r) => r.recovered_from_week))].join(', ')}
                      </p>
                    ) : null}
                    {aiPreviewByWeek[weekNumber] ? (
                      <p className="text-xs text-slate-500 italic mt-0.5">AI Preview: {aiPreviewByWeek[weekNumber]}</p>
                    ) : null}
                    {aiConfidenceByWeek[weekNumber] ? (
                      <p className="text-xs text-slate-400 italic mt-0.5">{aiConfidenceByWeek[weekNumber]}</p>
                    ) : null}
                    <button
                      onClick={() => handleRegenerateWeek(weekNumber)}
                      disabled={isRegenerating}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 text-sm font-medium disabled:opacity-50"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                      Regenerate
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-px bg-gray-200">
                    {DAYS.map((day) => {
                      const cellActivities = getActivitiesFor(weekNumber, day);
                      const isDropTarget = dropTarget?.week === weekNumber && dropTarget?.day === day;
                      const isFocusedDay = isFocusedWeek && focusDay && day.toLowerCase() === focusDay.toLowerCase();
                      return (
                        <div
                          key={day}
                          onDragOver={(e) => { e.preventDefault(); setDropTarget({ week: weekNumber, day }); }}
                          onDragLeave={() => setDropTarget((t) => (t?.week === weekNumber && t?.day === day ? null : t))}
                          onDrop={(e) => { e.preventDefault(); handleDrop(weekNumber, day); }}
                          className={`min-h-[100px] bg-white p-2 ${isDropTarget ? 'ring-2 ring-indigo-400 bg-indigo-50/50' : ''} ${isFocusedDay ? 'ring-2 ring-emerald-400 bg-emerald-50/70' : ''}`}
                          data-day={day}
                        >
                          <div className="text-xs font-medium text-gray-500 mb-1">{day.slice(0, 3)}</div>
                          <div className="space-y-1">
                            {cellActivities.map((act) => {
                              const execMode = (act.execution_mode ?? 'AI_AUTOMATED') as 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';
                              const intel = getExecutionIntelligence(execMode);
                              const modeColors = intel.colorClasses;
                              const actClass = modeColors
                                ? `flex flex-col gap-0.5 rounded border p-1.5 cursor-pointer group ${modeColors.card} hover:opacity-90`
                                : 'flex flex-col gap-0.5 rounded border border-gray-200 bg-gray-50 hover:bg-indigo-50 hover:border-indigo-200 p-1.5 cursor-pointer group';
                              const execDot = execMode === 'AI_AUTOMATED' ? '🟢' : execMode === 'CONDITIONAL_AI' ? '🟡' : '🔴';
                              const modeLabel = intel.label;
                              const modeExplanation = intel.explanation;
                              const creatorInst = act.creator_instruction ?? (act.raw_item?.creator_instruction && typeof act.raw_item.creator_instruction === 'object' ? act.raw_item.creator_instruction as Record<string, unknown> : null);
                              const creatorPreview = creatorInst?.targetAudience ? `Audience: ${String(creatorInst.targetAudience)}` : creatorInst?.objective ? `Goal: ${String(creatorInst.objective)}` : null;
                              return (
                              <div
                                key={act.id}
                                draggable
                                onDragStart={() => setDragged(act)}
                                onDragEnd={() => setDragged(null)}
                                onClick={() => openActivityWorkspace(act)}
                                className={actClass}
                              >
                                <div className="flex items-center gap-1 w-full">
                                  <span className="text-[9px] leading-none shrink-0" title={execMode === 'AI_AUTOMATED' ? 'Fully AI executable' : (modeLabel ?? undefined)}>{execDot}</span>
                                  <GripVertical className="w-3 h-3 text-gray-400 shrink-0 opacity-0 group-hover:opacity-100" />
                                  <span className="text-xs text-gray-800 truncate flex-1" title={act.title}>
                                    {act.title.slice(0, 24)}{act.title.length > 24 ? '…' : ''}
                                  </span>
                                  <span className="text-[10px] text-gray-500 capitalize shrink-0">{act.platform}</span>
                                  <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                                </div>
                                <div className="font-medium text-[10px] text-gray-800">{modeLabel ?? 'AI Ready'}</div>
                                {modeExplanation && <div className="text-[9px] text-gray-500">{modeExplanation}</div>}
                                {execMode === 'CONDITIONAL_AI' && (
                                  <>
                                    <span className="inline-block text-[9px] px-1 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 w-fit">Template Required</span>
                                    <span className="block text-[9px] text-gray-500">Template unlocks AI generation</span>
                                  </>
                                )}
                                {creatorPreview && (
                                  <span className="text-[9px] text-gray-500 truncate" title={creatorPreview}>{creatorPreview}</span>
                                )}
                              </div>
                            );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {weeksToShow.length > 0 && (
            <p className="text-xs text-gray-500 mt-4">And so on… Add more weeks from the main plan.</p>
          )}
        </div>
      </div>
    </>
  );
}
