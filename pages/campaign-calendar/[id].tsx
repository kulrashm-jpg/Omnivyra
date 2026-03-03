import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Clock, ExternalLink } from 'lucide-react';
import { getExecutionIntelligence } from '../../utils/getExecutionIntelligence';

type ReadinessLabel = 'ready' | 'missing_media' | 'incomplete';
type StageKey = 'awareness' | 'education' | 'authority' | 'engagement' | 'conversion' | 'team_note';

type CalendarActivity = {
  execution_id: string;
  week_number: number;
  day: string;
  date: string;
  time: string;
  title: string;
  platform: string;
  content_type: string;
  readiness_label: ReadinessLabel;
  execution_jobs: Array<{
    job_id: string;
    platform: string;
    status: 'ready' | 'blocked';
    ready_to_schedule: boolean;
  }>;
  raw_item: Record<string, unknown>;
  /** When set, ownership colors override default card styling (additive). */
  execution_mode?: string;
};

type StageGroup = {
  stage: StageKey;
  title: string;
  colorClass: string;
  count: number;
  items: CalendarActivity[];
};

const DAY_INDEX: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const STAGE_ORDER: StageKey[] = ['team_note', 'awareness', 'education', 'authority', 'engagement', 'conversion'];

const STAGE_META: Record<StageKey, { title: string; colorClass: string; pillClass: string }> = {
  team_note: { title: 'Team Note', colorClass: 'bg-violet-500', pillClass: 'text-violet-700 bg-violet-100 border-violet-200' },
  awareness: { title: 'Awareness', colorClass: 'bg-sky-500', pillClass: 'text-sky-700 bg-sky-100 border-sky-200' },
  education: { title: 'Education', colorClass: 'bg-emerald-500', pillClass: 'text-emerald-700 bg-emerald-100 border-emerald-200' },
  authority: { title: 'Authority', colorClass: 'bg-indigo-500', pillClass: 'text-indigo-700 bg-indigo-100 border-indigo-200' },
  engagement: { title: 'Engagement', colorClass: 'bg-amber-500', pillClass: 'text-amber-700 bg-amber-100 border-amber-200' },
  conversion: { title: 'Conversion', colorClass: 'bg-rose-500', pillClass: 'text-rose-700 bg-rose-100 border-rose-200' },
};

const nonEmpty = (value: unknown): string => String(value ?? '').trim();

const normalizeDateKey = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};

const normalizePlatformLabel = (platform: string): string => {
  const p = String(platform || '').trim().toLowerCase();
  if (!p) return 'Unknown';
  if (p === 'x' || p === 'twitter') return 'X';
  return p.charAt(0).toUpperCase() + p.slice(1);
};

const getPlatformGlyph = (platform: string): string => {
  const p = String(platform || '').toLowerCase();
  if (p === 'linkedin') return '💼';
  if (p === 'instagram') return '📸';
  if (p === 'facebook') return '📘';
  if (p === 'x' || p === 'twitter') return '𝕏';
  if (p === 'youtube') return '▶️';
  return '🧩';
};

const getReadinessBadge = (label: ReadinessLabel) => {
  if (label === 'ready') return { text: '🟢 Ready to Schedule', className: 'bg-emerald-100 text-emerald-700' };
  if (label === 'missing_media') return { text: '🟡 Missing Media', className: 'bg-amber-100 text-amber-700' };
  return { text: '🔴 Incomplete', className: 'bg-rose-100 text-rose-700' };
};

const normalizeStageValue = (raw: string): StageKey | null => {
  const value = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (!value) return null;
  if (value.includes('team') && value.includes('note')) return 'team_note';
  if (value.includes('aware')) return 'awareness';
  if (value.includes('educat') || value.includes('learn')) return 'education';
  if (value.includes('author') || value.includes('expert') || value.includes('trust')) return 'authority';
  if (value.includes('engage') || value.includes('community') || value.includes('interact')) return 'engagement';
  if (value.includes('convert') || value.includes('sale') || value.includes('offer') || value.includes('cta')) return 'conversion';
  return null;
};

const mapDeterministicFallbackStage = (activity: CalendarActivity): StageKey => {
  const ct = activity.content_type.toLowerCase();
  if (ct.includes('offer') || ct.includes('demo') || ct.includes('pricing') || ct.includes('testimonial')) return 'conversion';
  if (ct.includes('guide') || ct.includes('tutorial') || ct.includes('article') || ct.includes('blog')) return 'education';
  if (ct.includes('webinar') || ct.includes('case') || ct.includes('thought') || ct.includes('podcast')) return 'authority';
  if (ct.includes('poll') || ct.includes('qa') || ct.includes('community') || ct.includes('thread')) return 'engagement';
  if (activity.readiness_label !== 'ready') return 'engagement';
  return 'awareness';
};

const resolveStageForActivity = (activity: CalendarActivity): StageKey => {
  const explicitStage = normalizeStageValue(nonEmpty((activity.raw_item as any)?.stage));
  if (explicitStage && explicitStage !== 'team_note') return explicitStage;
  const narrativeRole = normalizeStageValue(nonEmpty((activity.raw_item as any)?.execution_readiness?.narrative_role));
  if (narrativeRole && narrativeRole !== 'team_note') return narrativeRole;
  return mapDeterministicFallbackStage(activity);
};

const extractTeamNote = (rawItem: Record<string, unknown>): string => {
  const value = nonEmpty(
    (rawItem as any)?.team_note ??
      (rawItem as any)?.teamNote ??
      (rawItem as any)?.team_instruction ??
      (rawItem as any)?.teamInstruction ??
      (rawItem as any)?.notes?.team
  );
  if (!value) return '';
  const [firstLine] = value.split('\n');
  return nonEmpty(firstLine);
};

const buildStageGroupsForDay = (dateKey: string, dayItems: CalendarActivity[]): StageGroup[] => {
  const buckets: Record<StageKey, CalendarActivity[]> = {
    awareness: [],
    education: [],
    authority: [],
    engagement: [],
    conversion: [],
    team_note: [],
  };

  dayItems.forEach((activity) => {
    const teamNote = extractTeamNote(activity.raw_item);
    if (teamNote) {
      buckets.team_note.push({
        ...activity,
        execution_id: `${activity.execution_id}__team_note`,
        title: teamNote,
        platform: 'team',
        content_type: 'team_note',
      });
    }
    const stage = resolveStageForActivity(activity);
    buckets[stage].push(activity);
  });

  return STAGE_ORDER.map((stage) => {
    const items = buckets[stage];
    if (!items.length) return null;
    return {
      stage,
      title: STAGE_META[stage].title,
      colorClass: STAGE_META[stage].colorClass,
      count: items.length,
      items,
    } satisfies StageGroup;
  }).filter((group): group is StageGroup => Boolean(group));
};

export default function CampaignCalendarPage() {
  const router = useRouter();
  const campaignId = typeof router.query.id === 'string' ? router.query.id : '';
  const plannerWeek = Number(Array.isArray(router.query.week) ? router.query.week[0] : (router.query.week || 0));
  const plannerDay = String(Array.isArray(router.query.day) ? router.query.day[0] : (router.query.day || '')).trim();

  const [isLoading, setIsLoading] = useState(true);
  const [campaignName, setCampaignName] = useState('Campaign Calendar');
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const [executionFilter, setExecutionFilter] = useState<'all' | 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI'>('all');

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;
    const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';

    const run = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/campaigns/retrieve-plan?campaignId=${encodeURIComponent(campaignId)}`);
        if (!response.ok) throw new Error('Failed to load campaign plan');
        const payload = await response.json();
        const planWeeks =
          (Array.isArray(payload?.draftPlan?.weeks) && payload.draftPlan.weeks.length > 0
            ? payload.draftPlan.weeks
            : (Array.isArray(payload?.committedPlan?.weeks) ? payload.committedPlan.weeks : [])) || [];

        let mapped: CalendarActivity[] = [];
        for (const week of planWeeks) {
          const weekNumber = Number((week as any)?.week ?? (week as any)?.week_number ?? 0) || 0;
          const items = Array.isArray((week as any)?.daily_execution_items) ? (week as any).daily_execution_items : [];
          items.forEach((item: any, itemIndex: number) => {
            const execution_id = nonEmpty(item?.execution_id) || `execution-${weekNumber}-${itemIndex}`;
            const platform = nonEmpty(item?.platform).toLowerCase() || 'linkedin';
            const content_type = nonEmpty(item?.content_type).toLowerCase() || 'post';
            const title = nonEmpty(item?.title) || nonEmpty(item?.topic) || nonEmpty(item?.writer_content_brief?.topicTitle);
            const dayRaw = nonEmpty((item as any)?.day);
            const day = dayRaw || Object.keys(DAY_INDEX)[itemIndex % 7].replace(/^./, (c) => c.toUpperCase());

            const scheduledRaw = nonEmpty(item?.scheduled_time);
            const parsed = new Date(scheduledRaw);
            const hasIsoDate = scheduledRaw.includes('T') && Number.isFinite(parsed.getTime());
            const fallbackDate = new Date();
            fallbackDate.setDate(fallbackDate.getDate() + (Math.max(weekNumber, 1) - 1) * 7 + (DAY_INDEX[day.toLowerCase()] ?? 0));
            const date = hasIsoDate ? parsed.toISOString().split('T')[0] : fallbackDate.toISOString().split('T')[0];
            const time = hasIsoDate ? parsed.toISOString().slice(11, 16) : (scheduledRaw.match(/^\d{1,2}:\d{2}$/) ? scheduledRaw : '09:00');

            const readiness = item?.execution_readiness && typeof item.execution_readiness === 'object' ? item.execution_readiness : null;
            const blocking = Array.isArray(readiness?.blocking_reasons) ? readiness.blocking_reasons : [];
            const readiness_label: ReadinessLabel = readiness?.ready_to_schedule
              ? 'ready'
              : (blocking.includes('missing_required_media') ? 'missing_media' : 'incomplete');

            const execution_jobs = Array.isArray(item?.execution_jobs)
              ? item.execution_jobs.map((job: any) => ({
                  job_id: nonEmpty(job?.job_id),
                  platform: nonEmpty(job?.platform).toLowerCase() || platform,
                  status: String(job?.status || '').toLowerCase() === 'ready' ? 'ready' : 'blocked',
                  ready_to_schedule: Boolean(job?.ready_to_schedule),
                }))
              : [];

            const execution_mode = typeof (item as any)?.execution_mode === 'string' ? (item as any).execution_mode : undefined;
            mapped.push({
              execution_id,
              week_number: weekNumber,
              day,
              date,
              time,
              title,
              platform,
              content_type,
              readiness_label,
              execution_jobs,
              raw_item: item,
              ...(execution_mode ? { execution_mode } : {}),
            });
          });
        }

        // Fallback: when blueprint has no daily_execution_items, use daily-plans (e.g. AI-created daily plan)
        if (mapped.length === 0) {
          const [dailyRes, campaignRes] = await Promise.all([
            fetch(`/api/campaigns/daily-plans?campaignId=${encodeURIComponent(campaignId)}`),
            companyId
              ? fetch(`/api/campaigns?type=campaign&campaignId=${encodeURIComponent(campaignId)}&companyId=${encodeURIComponent(companyId)}`)
              : Promise.resolve(null),
          ]);
          let campaignStartDate: string | null = null;
          if (campaignRes?.ok) {
            const campaignPayload = await campaignRes.json();
            const start = campaignPayload?.campaign?.start_date;
            if (start && typeof start === 'string') campaignStartDate = start;
          }
          const baseDate = campaignStartDate
            ? new Date(campaignStartDate + 'T00:00:00')
            : new Date();
          if (!Number.isFinite(baseDate.getTime())) baseDate.setTime(Date.now());

          if (dailyRes.ok) {
            const dailyPlans: any[] = await dailyRes.json();
            const fromDaily: CalendarActivity[] = (dailyPlans || []).map((plan: any, idx: number) => {
              const weekNumber = Number(plan.weekNumber ?? plan.week_number ?? 1) || 1;
              const dayOfWeek = nonEmpty(plan.dayOfWeek ?? plan.day_of_week) || 'Monday';
              const dayIndex = DAY_INDEX[dayOfWeek.toLowerCase()] ?? 0;
              const weekStart = new Date(baseDate);
              weekStart.setDate(baseDate.getDate() + (weekNumber - 1) * 7);
              const activityDate = new Date(weekStart);
              activityDate.setDate(weekStart.getDate() + dayIndex);
              const date = activityDate.toISOString().split('T')[0];
              const timeRaw = plan.scheduledTime ?? plan.scheduled_time ?? plan.optimal_posting_time ?? '09:00';
              const time = typeof timeRaw === 'string' && timeRaw.match(/^\d{1,2}:\d{2}/) ? timeRaw.slice(0, 5) : '09:00';
              const title = nonEmpty(plan.title ?? plan.topic ?? (plan.dailyObject as any)?.topicTitle) || 'Untitled Activity';
              const platform = nonEmpty(plan.platform).toLowerCase() || 'linkedin';
              const contentType = nonEmpty(plan.contentType ?? plan.content_type ?? (plan.dailyObject as any)?.contentType).toLowerCase() || 'post';
              const status = String(plan.status ?? 'planned').toLowerCase();
              const readiness_label: ReadinessLabel = status === 'scheduled' || status === 'ready' ? 'ready' : 'incomplete';
              const raw = (plan.dailyObject && typeof plan.dailyObject === 'object') ? plan.dailyObject : plan;
              return {
                execution_id: String(plan.id ?? `daily-${weekNumber}-${idx}`),
                week_number: weekNumber,
                day: dayOfWeek,
                date,
                time,
                title,
                platform,
                content_type: contentType,
                readiness_label,
                execution_jobs: [],
                raw_item: raw,
              };
            });
            mapped = fromDaily;
          }
        }

        if (!cancelled) {
          setActivities(mapped);
          setCampaignName(`Campaign ${campaignId} Calendar`);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load calendar');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [campaignId, router.query.companyId]);

  useEffect(() => {
    if (!activities.length) return;
    if (!(Number.isFinite(plannerWeek) && plannerWeek > 0 && plannerDay)) return;
    const matched = activities.find((a) => a.week_number === plannerWeek && a.day.toLowerCase() === plannerDay.toLowerCase());
    if (!matched) return;
    const d = new Date(`${matched.date}T00:00:00`);
    if (!Number.isFinite(d.getTime())) return;
    setCurrentDate(d);
  }, [activities, plannerWeek, plannerDay]);

  const sortedActivities = useMemo(() => {
    return [...activities].sort((a, b) => (`${a.date}T${a.time}`).localeCompare(`${b.date}T${b.time}`));
  }, [activities]);

  const monthName = useMemo(
    () => currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    [currentDate]
  );

  const filteredActivities = useMemo(() => {
    if (executionFilter === 'all') return sortedActivities;
    return sortedActivities.filter((a) => a.execution_mode === executionFilter);
  }, [sortedActivities, executionFilter]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, CalendarActivity[]>();
    filteredActivities.forEach((activity) => {
      const date = new Date(`${activity.date}T00:00:00`);
      if (!Number.isFinite(date.getTime())) return;
      if (date.getMonth() !== currentDate.getMonth() || date.getFullYear() !== currentDate.getFullYear()) return;
      const list = map.get(activity.date) || [];
      list.push(activity);
      map.set(activity.date, list);
    });
    return map;
  }, [filteredActivities, currentDate]);

  const dayKeys = useMemo(() => Array.from(groupedByDate.keys()).sort(), [groupedByDate]);

  const moveMonth = (direction: 'prev' | 'next') => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      next.setMonth(prev.getMonth() + (direction === 'prev' ? -1 : 1));
      return next;
    });
  };

  const isStageExpanded = (dateKey: string, stage: StageKey, count: number): boolean => {
    if (stage === 'team_note') return true;
    const storageKey = `${dateKey}__${stage}`;
    if (Object.prototype.hasOwnProperty.call(expandedState, storageKey)) return Boolean(expandedState[storageKey]);
    return count <= 5;
  };

  const toggleStage = (dateKey: string, stage: StageKey, count: number) => {
    if (stage === 'team_note') return;
    const storageKey = `${dateKey}__${stage}`;
    const currently = isStageExpanded(dateKey, stage, count);
    setExpandedState((prev) => ({ ...prev, [storageKey]: !currently }));
  };

  const openActivityDetail = (activity: CalendarActivity) => {
    if (activity.platform === 'team') return;
    const raw = activity.raw_item && typeof activity.raw_item === 'object' ? activity.raw_item as Record<string, unknown> : {};
    const hasNested = raw.writer_content_brief != null || raw.intent != null;
    const dailyExecutionItem = hasNested
      ? { ...raw }
      : {
          ...raw,
          topic: activity.title,
          title: activity.title,
          platform: activity.platform,
          content_type: activity.content_type,
          intent: {
            ...(typeof (raw as any).intent === 'object' && (raw as any).intent ? (raw as any).intent : {}),
            objective: (raw as any).dailyObjective ?? (raw as any).objective,
            pain_point: (raw as any).whatProblemAreWeAddressing ?? (raw as any).summary ?? (raw as any).pain_point,
            outcome_promise: (raw as any).whatShouldReaderLearn ?? (raw as any).introObjective ?? (raw as any).outcome_promise,
            cta_type: (raw as any).desiredAction ?? (raw as any).cta ?? (raw as any).cta_type,
          },
          writer_content_brief: {
            ...(typeof (raw as any).writer_content_brief === 'object' && (raw as any).writer_content_brief ? (raw as any).writer_content_brief : {}),
            topicTitle: (raw as any).topicTitle ?? (raw as any).topic ?? activity.title,
            writingIntent: (raw as any).writingIntent ?? (raw as any).description,
            whatShouldReaderLearn: (raw as any).whatShouldReaderLearn ?? (raw as any).introObjective,
            whatProblemAreWeAddressing: (raw as any).whatProblemAreWeAddressing ?? (raw as any).summary,
            desiredAction: (raw as any).desiredAction ?? (raw as any).cta,
            narrativeStyle: (raw as any).narrativeStyle ?? (raw as any).brandVoice,
            topicGoal: (raw as any).dailyObjective ?? (raw as any).objective,
          },
        };
    const workspaceKey = `activity-workspace-${campaignId}-${activity.execution_id}`;
    const payload = {
      campaignId,
      weekNumber: activity.week_number,
      day: activity.day,
      activityId: activity.execution_id,
      title: activity.title,
      topic: activity.title,
      description: String((raw as any)?.writingIntent ?? (raw as any)?.description ?? ''),
      dailyExecutionItem,
      schedules: [
        {
          id: activity.execution_id,
          platform: activity.platform,
          contentType: activity.content_type,
          date: activity.date,
          time: activity.time,
          status: activity.readiness_label === 'ready' ? 'scheduled' : 'planned',
          description: '',
          title: activity.title,
        },
      ],
    };
    try {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(workspaceKey, JSON.stringify(payload));
        window.open(`/activity-workspace?workspaceKey=${encodeURIComponent(workspaceKey)}`, '_blank');
      }
    } catch (err) {
      console.error('Failed to open activity detail from calendar:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-gray-600">Loading campaign calendar...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (campaignId) {
                  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
                  router.push(`/campaign-planning-hierarchical?campaignId=${encodeURIComponent(campaignId)}${companyId ? `&companyId=${encodeURIComponent(companyId)}` : ''}`);
                } else {
                  router.back();
                }
              }}
              className="p-2 rounded-lg border border-gray-200 hover:bg-white"
              title="Back to week plan"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Campaign Calendar</h1>
              <p className="text-sm text-gray-600">{campaignName}</p>
            </div>
          </div>
          <span className="text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-2 py-1">
            Tentative scheduling only
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-gray-500">Responsibility:</span>
          {(['all', 'AI_AUTOMATED', 'CREATOR_REQUIRED', 'CONDITIONAL_AI'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setExecutionFilter(mode)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                executionFilter === mode
                  ? 'bg-indigo-100 border-indigo-300 text-indigo-800'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {mode === 'all' ? 'All' : mode === 'AI_AUTOMATED' ? 'AI' : mode === 'CREATOR_REQUIRED' ? 'Creator' : 'Conditional'}
            </button>
          ))}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">{monthName}</h2>
            <div className="flex items-center gap-1">
              <button
                onClick={() => moveMonth('prev')}
                className="p-1.5 rounded border border-gray-200 hover:bg-gray-50"
                title="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => moveMonth('next')}
                className="p-1.5 rounded border border-gray-200 hover:bg-gray-50"
                title="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded border border-rose-200 bg-rose-50 text-rose-700 text-sm">{error}</div>
        )}

        {dayKeys.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-600 space-y-3">
            <p className="font-medium text-gray-800">No activities found for this month.</p>
            <p>
              The calendar shows activities only after <strong>daily plans</strong> are generated from your week plan.
              If you just created the week plan, go to <strong>Campaign Details</strong> and use{' '}
              <strong>Generate Daily Plans &amp; Open Planner</strong> to create day-by-day activities; they will then appear here.
            </p>
            {campaignId && (
              <button
                type="button"
                onClick={() => {
                  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
                  router.push(`/campaign-details/${campaignId}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
                }}
                className="mt-2 px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                Go to Campaign Details →
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {dayKeys.map((dateKey) => {
              const dayItems = groupedByDate.get(dateKey) || [];
              const stageGroups = buildStageGroupsForDay(dateKey, dayItems);
              const total = stageGroups.reduce((sum, g) => sum + g.count, 0);
              return (
                <section key={dateKey} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                  <div className="h-1 w-full flex">
                    {stageGroups.map((group) => {
                      const width = total > 0 ? (group.count / total) * 100 : 0;
                      return (
                        <div
                          key={`${dateKey}-${group.stage}-bar`}
                          className={group.colorClass}
                          style={{ width: `${width}%`, height: '4px' }}
                        />
                      );
                    })}
                  </div>

                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">
                      {new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                    <span className="text-xs text-gray-500">{total} activities</span>
                  </div>

                  <div className="p-4 space-y-4">
                    {stageGroups.map((group) => {
                      const expanded = isStageExpanded(dateKey, group.stage, group.count);
                      const isTeamNote = group.stage === 'team_note';
                      const meta = STAGE_META[group.stage];
                      return (
                        <div key={`${dateKey}-${group.stage}`} className="rounded-lg border border-gray-100 bg-gray-50/40">
                          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
                            <div className="flex items-center gap-2">
                              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${meta.colorClass}`} />
                              <span className="text-sm font-medium text-gray-900">{group.title}</span>
                              <span className={`text-[11px] px-2 py-0.5 rounded-full border ${meta.pillClass}`}>
                                {group.count}
                              </span>
                            </div>
                            {!isTeamNote && (
                              <button
                                type="button"
                                onClick={() => toggleStage(dateKey, group.stage, group.count)}
                                className="text-xs text-gray-600 hover:text-gray-900"
                              >
                                {expanded ? 'Collapse' : 'Expand'}
                              </button>
                            )}
                          </div>

                          {expanded && (
                            <div className="p-4 space-y-3">
                              {group.items.map((activity) => {
                                const execMode = (activity.execution_mode ?? 'AI_AUTOMATED') as 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';
                                const intel = getExecutionIntelligence(execMode);
                                const readiness = getReadinessBadge(activity.readiness_label);
                                const modeColors = intel.colorClasses;
                                const articleClass = modeColors
                                  ? `rounded-xl p-4 shadow-sm ${modeColors.card}`
                                  : 'bg-white border border-gray-200 rounded-xl p-4 shadow-sm';
                                const execDot = execMode === 'AI_AUTOMATED' ? '🟢' : execMode === 'CONDITIONAL_AI' ? '🟡' : '🔴';
                                const modeLabel = intel.label;
                                const modeExplanation = intel.explanation;
                                const rawItem = activity.raw_item && typeof activity.raw_item === 'object' ? activity.raw_item as Record<string, unknown> : {};
                                const creatorInst = rawItem?.creator_instruction && typeof rawItem.creator_instruction === 'object' ? rawItem.creator_instruction as Record<string, unknown> : null;
                                const creatorPreview = creatorInst?.targetAudience ? `Audience: ${String(creatorInst.targetAudience)}` : creatorInst?.objective ? `Goal: ${String(creatorInst.objective)}` : null;
                                return (
                                  <article
                                    key={activity.execution_id}
                                    className={articleClass}
                                  >
                                    <div className="font-medium text-gray-900">{modeLabel ?? 'AI Ready'}</div>
                                    {modeExplanation && <div className="text-xs text-gray-500 mt-0.5">{modeExplanation}</div>}
                                    {execMode === 'CONDITIONAL_AI' && (
                                      <>
                                        <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">Template Required</span>
                                        <span className="block mt-0.5 text-[10px] text-gray-500">Template unlocks AI generation</span>
                                      </>
                                    )}
                                    <div className="flex items-start justify-between gap-3 mt-1.5">
                                      <h4 className="text-base font-semibold text-gray-900">{activity.title}</h4>
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs leading-none" title={execMode === 'AI_AUTOMATED' ? 'Fully AI executable' : (modeLabel ?? undefined)}>{execDot}</span>
                                        <span className={`text-[11px] px-2 py-1 rounded-full font-medium ${readiness.className}`}>
                                          {readiness.text}
                                        </span>
                                        <span className="text-[11px] px-2 py-1 rounded-full border border-gray-200 bg-gray-50 text-gray-700 inline-flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          {activity.time}
                                        </span>
                                      </div>
                                    </div>
                                    {creatorPreview && (
                                      <div className="text-[10px] text-gray-500 mt-1 truncate">{creatorPreview}</div>
                                    )}

                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                      <span className="px-2 py-1 rounded border border-gray-200 bg-gray-50">
                                        {getPlatformGlyph(activity.platform)} {normalizePlatformLabel(activity.platform)}
                                      </span>
                                      <span className="px-2 py-1 rounded border border-gray-200 bg-gray-50 capitalize">
                                        {activity.content_type}
                                      </span>
                                      {activity.execution_jobs.length > 0 && (
                                        <span className="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-700">
                                          {activity.execution_jobs
                                            .map((job) => `[${normalizePlatformLabel(job.platform)} ${job.ready_to_schedule ? '🟢' : '🔴'}]`)
                                            .join(' ')}
                                        </span>
                                      )}
                                    </div>

                                    {activity.platform !== 'team' && (
                                      <div className="mt-3">
                                        <button
                                          onClick={() => openActivityDetail(activity)}
                                          className="inline-flex items-center gap-1 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded px-3 py-1.5 text-xs hover:bg-indigo-100"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                          Open Activity Detail
                                        </button>
                                      </div>
                                    )}
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

