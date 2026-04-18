import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCampaignResume } from '../hooks/useCampaignResume';
import { fetchWithAuth } from './community-ai/fetchWithAuth';

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
import { getExecutionIntelligence } from '../utils/getExecutionIntelligence';
import PlatformIcon from './ui/PlatformIcon';
import { getPlatformLabel } from '../utils/platformIcons';
import {
  type ExecutionStatus,
  getExecutionStatusBackground,
  getExecutionStatusBadgeClasses,
} from '../utils/executionStatus';

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

import type { useCampaignCalendar } from '../hooks/useCampaignCalendar';
type S = ReturnType<typeof useCampaignCalendar>;
export default function CampaignCalendarView({ d }: { d: S }) {
  const {
    _ef1,
    activities,
    campaignId,
    campaignName,
    currentDate,
    dayKeys,
    error,
    executionFilter,
    expandedState,
    fetchScheduledPosts,
    filteredActivities,
    groupedByDate,
    handleReschedule,
    isLoading,
    isStageExpanded,
    monthName,
    moveMonth,
    openActivityDetail,
    openPostPreview,
    openReschedule,
    plannerDay,
    plannerWeek,
    postPreview,
    rescheduleDate,
    rescheduleError,
    rescheduleTarget,
    rescheduling,
    router,
    scheduledByDate,
    scheduledExecIds,
    scheduledPostIdByExecId,
    setActivities,
    setCampaignName,
    setCurrentDate,
    setError,
    setExecutionFilter,
    setExpandedState,
    setIsLoading,
    setPostPreview,
    setRescheduleDate,
    setRescheduleError,
    setRescheduleTarget,
    setRescheduling,
    setScheduledByDate,
    setScheduledExecIds,
    setScheduledPostIdByExecId,
    setTotalScheduled,
    sortedActivities,
    toggleStage,
    totalScheduled,
  } = d;

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

