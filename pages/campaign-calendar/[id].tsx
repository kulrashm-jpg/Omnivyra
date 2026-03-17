import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCampaignResume } from '../../hooks/useCampaignResume';

/** Repurpose progress dots — unique = ●, repurposed = ● ● ○ etc. */
function RepurposeDots({ index, total, contentType }: { index: number; total: number; contentType?: string }) {
  const safeTotal = total < 1 ? 1 : total;
  const safeIndex = index < 1 ? 1 : index;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-indigo-500" aria-label={safeTotal === 1 ? 'Unique' : `${safeIndex} of ${safeTotal}`}>
      {Array.from({ length: safeTotal }, (_, i) => (
        <span key={i} className={i < safeIndex ? 'text-indigo-500' : 'text-gray-300'}>{i < safeIndex ? '●' : '○'}</span>
      ))}
      {contentType && <span className="text-gray-400 ml-0.5">{contentType}</span>}
    </span>
  );
}
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Clock, ExternalLink, X } from 'lucide-react';
import { getExecutionIntelligence } from '../../utils/getExecutionIntelligence';
import PlatformIcon from '../../components/ui/PlatformIcon';
import { getPlatformLabel } from '../../utils/platformIcons';
import {
  type ExecutionStatus,
  getExecutionStatusBackground,
  getExecutionStatusBadgeClasses,
} from '../../utils/executionStatus';

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
  /** Unified execution status; default PENDING when missing. */
  execution_status: ExecutionStatus;
  execution_jobs: Array<{
    job_id: string;
    platform: string;
    status: 'ready' | 'blocked';
    ready_to_schedule: boolean;
    /** When set, used for job-level display; default PENDING. */
    execution_status?: ExecutionStatus;
  }>;
  raw_item: Record<string, unknown>;
  /** When set, ownership colors override default card styling (additive). */
  execution_mode?: string;
  /** Repurpose lineage: e.g. 1/3, 2/3, 3/3 for repurposed content. */
  repurpose_index?: number;
  repurpose_total?: number;
  /** True when this topic already appears on this platform elsewhere — scheduling violation. */
  repurpose_duplicate?: boolean;
};

/** Derive ExecutionStatus from job: use job.execution_status if present, else legacy ready_to_schedule → SCHEDULED, else PENDING. */
function jobExecutionStatus(job: { execution_status?: string; ready_to_schedule?: boolean; status?: string }): ExecutionStatus {
  const raw = (job?.execution_status ?? '').toString().toUpperCase();
  if (raw === 'SCHEDULED' || raw === 'FINALIZED' || raw === 'IN_PROGRESS' || raw === 'PENDING') return raw as ExecutionStatus;
  if (job?.ready_to_schedule || String(job?.status ?? '').toLowerCase() === 'ready') return 'SCHEDULED';
  return 'PENDING';
}

/** Derive activity-level ExecutionStatus from jobs (best status wins) or legacy readiness. */
function activityExecutionStatus(
  jobs: Array<{ execution_status?: ExecutionStatus }>,
  legacyReady?: boolean,
  legacyMissingMedia?: boolean
): ExecutionStatus {
  if (jobs.length > 0) {
    const ordered: ExecutionStatus[] = ['SCHEDULED', 'FINALIZED', 'IN_PROGRESS', 'PENDING'];
    for (const s of ordered) {
      if (jobs.some((j) => (j.execution_status ?? 'PENDING') === s)) return s;
    }
  }
  if (legacyReady) return 'SCHEDULED';
  if (legacyMissingMedia) return 'IN_PROGRESS';
  return 'PENDING';
}

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

const normalizePlatformLabel = (platform: string): string => getPlatformLabel(platform) || 'Unknown';

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
  if (activity.execution_status !== 'SCHEDULED' && activity.execution_status !== 'FINALIZED') return 'engagement';
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

  useCampaignResume({
    campaignId: campaignId || undefined,
    page: 'campaign-calendar',
    extraParams: plannerWeek > 0 ? { week: String(plannerWeek), ...(plannerDay ? { day: plannerDay } : {}) } : undefined,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [campaignName, setCampaignName] = useState('Campaign Calendar');
  const [activities, setActivities] = useState<CalendarActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
  const [executionFilter, setExecutionFilter] = useState<'all' | 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI'>('all');
  const [postPreview, setPostPreview] = useState<{ content: string; platform: string; contentType: string; title: string } | null>(null);

  // Scheduled posts overlay — fetched from scheduled_posts via activity-events API
  const [scheduledByDate, setScheduledByDate] = useState<Record<string, number>>({});
  const [scheduledExecIds, setScheduledExecIds] = useState<Set<string>>(new Set());
  const [scheduledPostIdByExecId, setScheduledPostIdByExecId] = useState<Record<string, string>>({});
  const [totalScheduled, setTotalScheduled] = useState(0);

  // Reschedule (move date) state
  const [rescheduleTarget, setRescheduleTarget] = useState<{ executionId: string; scheduledPostId: string; currentDate: string } | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

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

            const execution_readiness = item?.execution_readiness && typeof item.execution_readiness === 'object' ? item.execution_readiness : null;
            const blocking = Array.isArray(execution_readiness?.blocking_reasons) ? execution_readiness.blocking_reasons : [];
            const legacyReady = Boolean(execution_readiness?.ready_to_schedule);
            const legacyMissingMedia = blocking.includes('missing_required_media');

            const execution_jobs = Array.isArray(item?.execution_jobs)
              ? item.execution_jobs.map((job: any) => {
                  const status: ExecutionStatus = jobExecutionStatus(job);
                  return {
                    job_id: nonEmpty(job?.job_id),
                    platform: nonEmpty(job?.platform).toLowerCase() || platform,
                    status: String(job?.status || '').toLowerCase() === 'ready' ? 'ready' as const : 'blocked' as const,
                    ready_to_schedule: Boolean(job?.ready_to_schedule),
                    execution_status: status,
                  };
                })
              : [];

            const execution_status = activityExecutionStatus(execution_jobs, legacyReady, legacyMissingMedia);
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
              execution_status,
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
              const execution_status: ExecutionStatus = status === 'scheduled' || status === 'ready' ? 'SCHEDULED' : 'PENDING';
              const raw = (plan.dailyObject && typeof plan.dailyObject === 'object') ? plan.dailyObject : plan;
              const planId = String(plan.id ?? `daily-${weekNumber}-${idx}`);
              return {
                execution_id: planId,
                week_number: weekNumber,
                day: dayOfWeek,
                date,
                time,
                title,
                platform,
                content_type: contentType,
                execution_status,
                execution_jobs: [],
                raw_item: raw,
                // repurpose_index / repurpose_total assigned in the post-processing pass below
              };
            });
            mapped = fromDaily;
          }
        }

        // Assign repurpose_index / repurpose_total campaign-wide.
        // Duplicate (topic + platform) pairs are flagged as repurpose_duplicate=true.
        const repurposeGroups = new Map<string, number[]>(); // title → [arrayIndex, ...] (unique platform only)
        const duplicateIndices = new Set<number>();
        mapped.forEach((a, i) => {
          const key = (a.title ?? '').trim();
          if (!key) return;
          const existing = repurposeGroups.get(key) ?? [];
          const plat = (a.platform ?? '').toLowerCase().trim();
          if (plat && existing.some((idx) => (mapped[idx].platform ?? '').toLowerCase().trim() === plat)) {
            duplicateIndices.add(i); // scheduling violation
            return;
          }
          existing.push(i);
          repurposeGroups.set(key, existing);
        });
        // Mark violations
        duplicateIndices.forEach((i) => {
          mapped[i] = { ...mapped[i], repurpose_duplicate: true };
        });
        for (const indices of repurposeGroups.values()) {
          const sorted = [...indices].sort((a, b) => {
            const dA = mapped[a].date || '9999-99-99';
            const dB = mapped[b].date || '9999-99-99';
            if (dA !== dB) return dA.localeCompare(dB);
            return (mapped[a].platform ?? '').localeCompare(mapped[b].platform ?? '');
          });
          const total = sorted.length;
          sorted.forEach((arrayIdx, rank) => {
            mapped[arrayIdx] = { ...mapped[arrayIdx], repurpose_index: rank + 1, repurpose_total: total };
          });
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

  // Fetch actual scheduled_posts for this campaign (independent of plan blueprint)
  useEffect(() => {
    const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
    if (!campaignId || !companyId) return;
    // stageFilter=all bypasses date bounds — returns every scheduled_post for the campaign
    fetch(
      `/api/calendar/activity-events?companyId=${encodeURIComponent(companyId)}&campaignId=${encodeURIComponent(campaignId)}&stageFilter=all&start=2000-01-01&end=2100-12-31`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((events: any[]) => {
        const byDate: Record<string, number> = {};
        const execIds = new Set<string>();
        const postIdMap: Record<string, string> = {};
        events.forEach((ev) => {
          if (ev.date) byDate[ev.date] = (byDate[ev.date] || 0) + 1;
          if (ev.execution_id) {
            execIds.add(String(ev.execution_id));
            if (ev.scheduled_post_id) postIdMap[String(ev.execution_id)] = String(ev.scheduled_post_id);
          }
        });
        setScheduledByDate(byDate);
        setScheduledExecIds(execIds);
        setScheduledPostIdByExecId(postIdMap);
        setTotalScheduled(events.length);
      })
      .catch(() => {});
  }, [campaignId, router.query.companyId]);

  // When scheduled posts load, jump to the first month that has scheduled posts
  // if the current view month has no plan activities and no scheduled posts
  useEffect(() => {
    if (totalScheduled === 0) return;
    const scheduledDates = Object.keys(scheduledByDate).sort();
    if (scheduledDates.length === 0) return;
    const firstScheduled = new Date(scheduledDates[0] + 'T00:00:00');
    if (!Number.isFinite(firstScheduled.getTime())) return;
    // Only auto-jump if the current month has nothing to show
    const hasPlanInCurrentMonth = activities.some((a) => {
      const d = new Date(a.date + 'T00:00:00');
      return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
    });
    const hasScheduledInCurrentMonth = scheduledDates.some((d) => {
      const dt = new Date(d + 'T00:00:00');
      return dt.getMonth() === currentDate.getMonth() && dt.getFullYear() === currentDate.getFullYear();
    });
    if (!hasPlanInCurrentMonth && !hasScheduledInCurrentMonth) {
      setCurrentDate(firstScheduled);
    }
  }, [totalScheduled]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  const openPostPreview = useCallback((activity: CalendarActivity) => {
    if (activity.platform === 'team') return;
    const raw = activity.raw_item && typeof activity.raw_item === 'object' ? activity.raw_item as Record<string, unknown> : {};
    const content = String((raw as any)?.generated_content ?? (raw as any)?.content ?? '').trim();
    const fallback = activity.title ? `Content for "${activity.title}" — ${activity.platform} ${activity.content_type}` : `Post — ${activity.platform} ${activity.content_type}`;
    setPostPreview({
      content: content || fallback,
      platform: activity.platform,
      contentType: activity.content_type,
      title: activity.title,
    });
  }, []);

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
    const generatedContent = String((raw as any)?.generated_content ?? '').trim();
    const platformVariants = Array.isArray((raw as any)?.platform_variants) ? (raw as any).platform_variants : (
      generatedContent ? [{ platform: activity.platform, content_type: activity.content_type, generated_content: generatedContent }] : []
    );
    if (platformVariants.length > 0 && !(dailyExecutionItem as any).platform_variants) {
      (dailyExecutionItem as any).platform_variants = platformVariants;
    }
    const masterContent = (raw as any)?.master_content && typeof (raw as any).master_content === 'object'
      ? (raw as any).master_content
      : generatedContent ? { content: generatedContent, generation_status: 'generated' } : null;
    if (masterContent && !(dailyExecutionItem as any).master_content) {
      (dailyExecutionItem as any).master_content = masterContent;
    }
    const schedulesFromVariants = platformVariants.length > 0
      ? platformVariants.map((v: any, i: number) => ({
          id: `${activity.execution_id}-${v.platform}-${v.content_type}-${i}`,
          platform: v.platform || activity.platform,
          contentType: v.content_type || activity.content_type,
          date: activity.date,
          time: activity.time,
          status: activity.execution_status === 'SCHEDULED' ? 'scheduled' : 'planned',
          description: '',
          title: activity.title,
        }))
      : [{
          id: activity.execution_id,
          platform: activity.platform,
          contentType: activity.content_type,
          date: activity.date,
          time: activity.time,
          status: activity.execution_status === 'SCHEDULED' ? 'scheduled' : 'planned',
          description: '',
          title: activity.title,
        }];
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
      schedules: schedulesFromVariants,
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

  const fetchScheduledPosts = useCallback(() => {
    const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
    if (!campaignId || !companyId) return;
    fetch(
      `/api/calendar/activity-events?companyId=${encodeURIComponent(companyId)}&campaignId=${encodeURIComponent(campaignId)}&stageFilter=all&start=2000-01-01&end=2100-12-31`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((events: any[]) => {
        const byDate: Record<string, number> = {};
        const execIds = new Set<string>();
        const postIdMap: Record<string, string> = {};
        events.forEach((ev) => {
          if (ev.date) byDate[ev.date] = (byDate[ev.date] || 0) + 1;
          if (ev.execution_id) {
            execIds.add(String(ev.execution_id));
            if (ev.scheduled_post_id) postIdMap[String(ev.execution_id)] = String(ev.scheduled_post_id);
          }
        });
        setScheduledByDate(byDate);
        setScheduledExecIds(execIds);
        setScheduledPostIdByExecId(postIdMap);
        setTotalScheduled(events.length);
      })
      .catch(() => {});
  }, [campaignId, router.query.companyId]);

  const openReschedule = (activity: CalendarActivity) => {
    const scheduledPostId = scheduledPostIdByExecId[String(activity.execution_id)];
    if (!scheduledPostId) return;
    setRescheduleTarget({ executionId: String(activity.execution_id), scheduledPostId, currentDate: activity.date });
    setRescheduleDate(activity.date);
    setRescheduleError(null);
  };

  const handleReschedule = async () => {
    if (!rescheduleTarget || !rescheduleDate) return;
    setRescheduling(true);
    setRescheduleError(null);
    try {
      const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
      const res = await fetch('/api/schedule/reschedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduled_post_id: rescheduleTarget.scheduledPostId, new_date: rescheduleDate, companyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRescheduleError(err?.error || 'Failed to reschedule');
        return;
      }
      setRescheduleTarget(null);
      fetchScheduledPosts();
    } catch (err: any) {
      setRescheduleError(err?.message || 'Failed to reschedule');
    } finally {
      setRescheduling(false);
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
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (campaignId) {
                  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
                  router.push(`/campaign-details/${encodeURIComponent(campaignId)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
                } else {
                  router.back();
                }
              }}
              className="p-2 rounded-lg border border-gray-200 hover:bg-white"
              title="Back to campaign"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900">Campaign Calendar</h1>
              <p className="text-sm text-gray-600">{campaignName}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {campaignId && (
              <button
                onClick={() => {
                  const companyId = typeof router.query.companyId === 'string' ? router.query.companyId : '';
                  router.push(`/campaign-daily-plan/${encodeURIComponent(campaignId)}${companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''}`);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 text-xs font-medium"
                title="Go to daily execution planner"
              >
                <Calendar className="w-3.5 h-3.5" />
                Daily Plan
              </button>
            )}
            <span className="text-xs text-gray-600 bg-white border border-gray-200 rounded-full px-2 py-1">
              Tentative scheduling only
            </span>
          </div>
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

        {/* Scheduled posts banner — shown when actual scheduled_posts exist for this campaign */}
        {totalScheduled > 0 && (
          <div className="mb-4 flex items-center gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50">
            <span className="text-emerald-600 text-lg">✓</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-emerald-800">
                {totalScheduled} post{totalScheduled !== 1 ? 's' : ''} scheduled across {Object.keys(scheduledByDate).length} day{Object.keys(scheduledByDate).length !== 1 ? 's' : ''}
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">
                Days with a green badge below have real posts in the scheduling queue. Use the dashboard Calendar tab to see all months.
              </p>
            </div>
          </div>
        )}

        {dayKeys.length === 0 && Object.keys(scheduledByDate).length === 0 ? (
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
        ) : dayKeys.length === 0 && totalScheduled > 0 ? (
          <div className="bg-white border border-emerald-200 rounded-xl p-6 text-sm text-gray-600 space-y-2">
            <p className="font-medium text-gray-800">No plan activities for this month — but posts are scheduled!</p>
            <p className="text-emerald-700">
              {totalScheduled} post{totalScheduled !== 1 ? 's' : ''} have been scheduled across {Object.keys(scheduledByDate).length} days. Use the ← → arrows to navigate to the months with your scheduled posts.
            </p>
            <p className="text-xs text-gray-500">
              Earliest scheduled date: <strong>{Object.keys(scheduledByDate).sort()[0]}</strong>
            </p>
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

                  <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-gray-900">
                      {new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      {scheduledByDate[dateKey] > 0 && (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          ✓ {scheduledByDate[dateKey]} scheduled
                        </span>
                      )}
                      <span className="text-xs text-gray-500">{total} activities</span>
                    </div>
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
                                const modeColors = intel.colorClasses;
                                const statusBg = getExecutionStatusBackground(activity.execution_status);
                                const articleClass = modeColors
                                  ? `rounded-xl p-4 shadow-sm border ${modeColors.card} ${statusBg}`
                                  : `bg-white border border-gray-200 rounded-xl p-4 shadow-sm ${statusBg}`;
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
                                    <div className="flex flex-col gap-1.5 mt-1.5 sm:flex-row sm:items-start sm:justify-between">
                                      <h4 className="text-base font-semibold text-gray-900">
                                        {activity.title}
                                      </h4>
                                      <div className="flex flex-wrap items-center gap-2">
                                      <RepurposeDots
                                        index={activity.repurpose_index ?? 1}
                                        total={activity.repurpose_total ?? 1}
                                        contentType={activity.content_type}
                                      />
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs leading-none" title={execMode === 'AI_AUTOMATED' ? 'Fully AI executable' : (modeLabel ?? undefined)}>{execDot}</span>
                                        <span className={`text-[11px] px-2 py-1 rounded-full font-medium border ${getExecutionStatusBadgeClasses(activity.execution_status)}`}>
                                          [{activity.execution_status}]
                                        </span>
                                        {scheduledExecIds.has(String(activity.execution_id)) && (
                                          <span className="text-[11px] px-2 py-1 rounded-full font-medium border border-emerald-200 bg-emerald-50 text-emerald-700">
                                            ✓ Scheduled
                                          </span>
                                        )}
                                        <span className="text-[11px] px-2 py-1 rounded-full border border-gray-200 bg-gray-50 text-gray-700 inline-flex items-center gap-1">
                                          <Clock className="h-3 w-3" />
                                          {activity.time}
                                        </span>
                                      </div>
                                      </div>
                                    </div>
                                    {creatorPreview && (
                                      <div className="text-[10px] text-gray-500 mt-1 truncate">{creatorPreview}</div>
                                    )}

                                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                                      <button
                                        type="button"
                                        onClick={() => openPostPreview(activity)}
                                        className="px-2 py-1 rounded border border-gray-200 bg-gray-50 inline-flex items-center gap-1 hover:bg-gray-100 hover:border-gray-300 cursor-pointer"
                                        title={`View ${activity.platform} ${activity.content_type} in format`}
                                      >
                                        <PlatformIcon platform={activity.platform} size={14} showLabel />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => openPostPreview(activity)}
                                        className="px-2 py-1 rounded border border-gray-200 bg-gray-50 capitalize hover:bg-gray-100 hover:border-gray-300 cursor-pointer"
                                        title={`View ${activity.content_type} in ${activity.platform} format`}
                                      >
                                        {activity.content_type}
                                      </button>
                                      {activity.execution_jobs.length > 0 && (
                                        <span className="px-2 py-1 rounded border border-slate-200 bg-slate-50 text-slate-700">
                                          {activity.execution_jobs
                                            .map((job) => (
                                              <span key={job.job_id} className="inline-flex items-center gap-0.5 mr-1">
                                                <PlatformIcon platform={job.platform} size={12} />
                                                <span className={`text-[10px] px-1 rounded ${getExecutionStatusBadgeClasses(job.execution_status ?? 'PENDING')}`}>
                                                  {job.execution_status ?? 'PENDING'}
                                                </span>
                                              </span>
                                            ))}
                                        </span>
                                      )}
                                    </div>

                                    {activity.platform !== 'team' && (
                                      <div className="mt-3 flex flex-wrap items-center gap-2">
                                        <button
                                          onClick={() => openActivityDetail(activity)}
                                          className="inline-flex items-center gap-1 border border-indigo-200 bg-indigo-50 text-indigo-700 rounded px-3 py-1.5 text-xs hover:bg-indigo-100"
                                        >
                                          <ExternalLink className="h-3 w-3" />
                                          Open Activity Detail
                                        </button>
                                        {scheduledExecIds.has(String(activity.execution_id)) && (
                                          <button
                                            type="button"
                                            onClick={() => openReschedule(activity)}
                                            className="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 text-amber-700 rounded px-3 py-1.5 text-xs hover:bg-amber-100"
                                          >
                                            <Calendar className="h-3 w-3" />
                                            Move to Date
                                          </button>
                                        )}
                                      </div>
                                    )}
                                    {rescheduleTarget?.executionId === String(activity.execution_id) && (
                                      <div className="mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50 space-y-2">
                                        <p className="text-xs font-medium text-amber-800">Move scheduled post to a new date</p>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="date"
                                            value={rescheduleDate}
                                            onChange={(e) => setRescheduleDate(e.target.value)}
                                            className="flex-1 px-2 py-1.5 text-xs border border-amber-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                                          />
                                          <button
                                            type="button"
                                            onClick={handleReschedule}
                                            disabled={!rescheduleDate || rescheduling}
                                            className="px-3 py-1.5 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                          >
                                            {rescheduling ? 'Moving…' : 'Confirm'}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRescheduleTarget(null)}
                                            className="px-3 py-1.5 text-xs rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100"
                                          >
                                            Cancel
                                          </button>
                                        </div>
                                        {rescheduleError && <p className="text-xs text-red-600">{rescheduleError}</p>}
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

        {postPreview && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setPostPreview(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <span className="text-sm font-medium text-gray-700">
                  {getPlatformLabel(postPreview.platform)} {postPreview.contentType} — {postPreview.title}
                </span>
                <button
                  type="button"
                  onClick={() => setPostPreview(null)}
                  className="p-1.5 rounded hover:bg-gray-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  <div className={`p-4 font-sans ${postPreview.platform === 'linkedin' ? 'bg-[#f3f6f8]' : 'bg-white'}`}>
                    <div className="flex gap-3 mb-3">
                      <div className="w-12 h-12 rounded-full bg-gray-300 flex-shrink-0" />
                      <div>
                        <div className="font-semibold text-gray-900">
                          {postPreview.platform === 'linkedin' ? 'Your name' : 'Author'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {postPreview.platform === 'linkedin'
                            ? 'Professional headline · 1st'
                            : postPreview.platform === 'x'
                              ? '@handle'
                              : `${getPlatformLabel(postPreview.platform)} post`}
                        </div>
                      </div>
                    </div>
                    <div className={`whitespace-pre-wrap text-sm leading-relaxed ${
                      postPreview.platform === 'linkedin' ? 'text-gray-800' : 'text-gray-800'
                    }`}>
                      {postPreview.content}
                    </div>
                    {postPreview.platform === 'linkedin' && (
                      <div className="mt-3 pt-3 border-t border-gray-200 flex gap-4 text-xs text-gray-500">
                        <span>Like</span>
                        <span>Comment</span>
                        <span>Repost</span>
                        <span>Send</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

