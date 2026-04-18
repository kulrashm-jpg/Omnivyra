import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useCampaignResume } from '../../hooks/useCampaignResume';
import { fetchWithAuth } from '../../components/community-ai/fetchWithAuth';

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

import { useCampaignCalendar } from '../../hooks/useCampaignCalendar';
import CampaignCalendarView from '../../components/CampaignCalendarView';
export default function CampaignCalendarPage() {
  const d = useCampaignCalendar();
  if (d._ef1) return null;
  return <CampaignCalendarView d={d} />;
}
