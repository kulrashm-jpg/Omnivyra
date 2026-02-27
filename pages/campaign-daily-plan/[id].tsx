/**
 * Daily Content Plan — week×day grid template.
 * Replaces the previous "view plan and work on daily" destination.
 * Features: Regenerate (per week), drag-and-drop activities, click activity → Activity Content Workspace.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ArrowLeft, Calendar, GripVertical, RefreshCw, ExternalLink } from 'lucide-react';

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
};

function nonEmpty(v: unknown): string {
  return String(v ?? '').trim();
}

export default function CampaignDailyPlanPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';
  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';

  const [campaignName, setCampaignName] = useState('');
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
      if (campaignRes?.ok) {
        const cp = await campaignRes.json().catch(() => ({}));
        if (cp?.campaign?.name) name = cp.campaign.name;
        durationWeeks = (cp?.campaign as any)?.duration_weeks ?? null;
      }
      setCampaignName(name);

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
        items.forEach((item: any, itemIndex: number) => {
          const execution_id = nonEmpty(item?.execution_id) || `execution-${weekNumber}-${itemIndex}`;
          const dayRaw = nonEmpty((item as any)?.day);
          const day = dayRaw || DAYS[itemIndex % 7];
          const title = nonEmpty(item?.title ?? item?.topic ?? item?.writer_content_brief?.topicTitle) || 'Untitled';
          mapped.push({
            id: execution_id,
            execution_id,
            week_number: weekNumber,
            day,
            title,
            platform: nonEmpty(item?.platform).toLowerCase() || 'linkedin',
            content_type: nonEmpty(item?.content_type).toLowerCase() || 'post',
            raw_item: item && typeof item === 'object' ? item : {},
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
      schedules: [],
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
              Back to plan
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

          <div className="space-y-6">
            {weeksToShow.map((weekNumber) => {
              const theme = weeklyPlans.find((p) => (p.weekNumber ?? p.week) === weekNumber)?.theme || `Week ${weekNumber} Theme`;
              const isRegenerating = regeneratingWeek === weekNumber;
              return (
                <div key={weekNumber} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Week {weekNumber}: {theme}</h2>
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
                      return (
                        <div
                          key={day}
                          onDragOver={(e) => { e.preventDefault(); setDropTarget({ week: weekNumber, day }); }}
                          onDragLeave={() => setDropTarget((t) => (t?.week === weekNumber && t?.day === day ? null : t))}
                          onDrop={(e) => { e.preventDefault(); handleDrop(weekNumber, day); }}
                          className={`min-h-[100px] bg-white p-2 ${isDropTarget ? 'ring-2 ring-indigo-400 bg-indigo-50/50' : ''}`}
                        >
                          <div className="text-xs font-medium text-gray-500 mb-1">{day.slice(0, 3)}</div>
                          <div className="space-y-1">
                            {cellActivities.map((act) => (
                              <div
                                key={act.id}
                                draggable
                                onDragStart={() => setDragged(act)}
                                onDragEnd={() => setDragged(null)}
                                onClick={() => openActivityWorkspace(act)}
                                className="flex items-center gap-1 rounded border border-gray-200 bg-gray-50 hover:bg-indigo-50 hover:border-indigo-200 p-1.5 cursor-pointer group"
                              >
                                <GripVertical className="w-3 h-3 text-gray-400 shrink-0 opacity-0 group-hover:opacity-100" />
                                <span className="text-xs text-gray-800 truncate flex-1" title={act.title}>
                                  {act.title.slice(0, 24)}{act.title.length > 24 ? '…' : ''}
                                </span>
                                <span className="text-[10px] text-gray-500 capitalize">{act.platform}</span>
                                <ExternalLink className="w-3 h-3 text-gray-400 shrink-0" />
                              </div>
                            ))}
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
