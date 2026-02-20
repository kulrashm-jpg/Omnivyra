/**
 * Campaign Execution State Service
 * Manages campaign execution progress for resume after server restart, deployment, or worker crash.
 * Does NOT modify enrichment or alignment logic.
 */

import { supabase } from '../db/supabaseClient';
import { enrichRecommendation, type RecommendationEnrichmentInput } from './campaignEnrichmentService';
import { normalizeDurationWeeks } from './campaignEnrichmentService';

const DURATION_VALUES = [2, 4, 8, 12] as const;
type DurationWeeks = (typeof DURATION_VALUES)[number];

function clampDuration(weeks: number): DurationWeeks {
  return normalizeDurationWeeks(weeks) as DurationWeeks;
}

/** Synthetic input to get weekly guidance for a given duration (uses enrichment without modifying it). */
function syntheticInputForDuration(duration: DurationWeeks): RecommendationEnrichmentInput {
  switch (duration) {
    case 2:
      return { facets: [], estimated_reach: 0 };
    case 4:
      return { facets: ['a', 'b'], sub_angles: ['x', 'y'] };
    case 8:
      return { facets: ['a', 'b', 'c'], sub_angles: ['x', 'y', 'z'], estimated_reach: 50000 };
    case 12:
      return {
        context: 'Personal growth',
        facets: ['a', 'b', 'c'],
        sub_angles: ['x', 'y', 'z'],
      };
    default:
      return { facets: ['a', 'b', 'c'], sub_angles: ['x', 'y', 'z'], estimated_reach: 50000 };
  }
}

function buildMomentumSnapshot(
  duration: DurationWeeks,
  weekNumber: number
): { week: number; momentum_level: string; psychological_movement: string } {
  const input = syntheticInputForDuration(duration);
  const enriched = enrichRecommendation(input);
  const guidance = enriched.weekly_guidance[Math.min(weekNumber - 1, enriched.weekly_guidance.length - 1)];
  return {
    week: weekNumber,
    momentum_level: guidance.momentum_level,
    psychological_movement: guidance.psychological_movement,
  };
}

export type ExecutionStatus = 'active' | 'paused' | 'completed';

export interface CampaignExecutionState {
  id: string;
  campaign_id: string;
  duration_weeks: number;
  current_week: number;
  current_day: number;
  completed_weeks: number[];
  completed_days: { week: number; day: number }[];
  momentum_snapshot: { week: number; momentum_level: string; psychological_movement: string };
  last_generated_content_id: string | null;
  status: ExecutionStatus;
  started_at: string | null;
  updated_at: string;
}

export interface ResumeResult {
  campaign_id: string;
  status: ExecutionStatus;
  next_week: number;
  next_day: number;
  momentum_level: string;
  psychological_movement: string;
  completed_weeks: number[];
  completed_days: { week: number; day: number }[];
  is_completed: boolean;
}

function parseCompletedDays(raw: unknown): { week: number; day: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is { week?: number; day?: number } => x != null && typeof x === 'object')
    .map((x) => ({ week: Number(x.week) || 1, day: Number(x.day) || 1 }))
    .filter((x) => x.week >= 1 && x.week <= 12 && x.day >= 1 && x.day <= 7);
}

function parseMomentumSnapshot(raw: unknown): {
  week: number;
  momentum_level: string;
  psychological_movement: string;
} {
  if (raw && typeof raw === 'object' && 'week' in raw && 'momentum_level' in raw && 'psychological_movement' in raw) {
    const o = raw as Record<string, unknown>;
    return {
      week: Number(o.week) || 1,
      momentum_level: String(o.momentum_level || 'medium'),
      psychological_movement: String(o.psychological_movement || ''),
    };
  }
  return { week: 1, momentum_level: 'medium', psychological_movement: '' };
}

function toState(row: Record<string, unknown>): CampaignExecutionState {
  return {
    id: String(row.id ?? ''),
    campaign_id: String(row.campaign_id ?? ''),
    duration_weeks: Number(row.duration_weeks) || 2,
    current_week: Number(row.current_week) || 1,
    current_day: Number(row.current_day) || 1,
    completed_weeks: Array.isArray(row.completed_weeks) ? (row.completed_weeks as number[]) : [],
    completed_days: parseCompletedDays(row.completed_days),
    momentum_snapshot: parseMomentumSnapshot(row.momentum_snapshot),
    last_generated_content_id: row.last_generated_content_id ? String(row.last_generated_content_id) : null,
    status: (row.status as ExecutionStatus) ?? 'active',
    started_at: row.started_at ? String(row.started_at) : null,
    updated_at: String(row.updated_at ?? new Date().toISOString()),
  };
}

/**
 * Start campaign execution. Idempotent: if state exists, returns it (do not duplicate).
 */
export async function startCampaign(
  campaignId: string,
  duration: number
): Promise<CampaignExecutionState | null> {
  const dur = clampDuration(duration);
  if (!DURATION_VALUES.includes(dur)) return null;

  const { data: existing } = await supabase
    .from('campaign_execution_state')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (existing) {
    return toState(existing);
  }

  const momentumSnapshot = buildMomentumSnapshot(dur, 1);
  const { data: inserted, error } = await supabase
    .from('campaign_execution_state')
    .insert({
      campaign_id: campaignId,
      duration_weeks: dur,
      current_week: 1,
      current_day: 1,
      completed_weeks: [],
      completed_days: [],
      momentum_snapshot: momentumSnapshot,
      status: 'active',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to start campaign: ${error.message}`);
  return toState(inserted);
}

/**
 * Mark a day complete. Idempotent: if (week, day) already in completed_days, no-op.
 */
export async function markDayComplete(
  campaignId: string,
  week: number,
  day: number,
  lastGeneratedContentId?: string | null
): Promise<CampaignExecutionState | null> {
  const { data: row, error: fetchError } = await supabase
    .from('campaign_execution_state')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (fetchError || !row) return null;

  const state = toState(row);
  if (state.status === 'completed') return state;

  const completedDays = state.completed_days;
  const alreadyDone = completedDays.some((d) => d.week === week && d.day === day);
  if (alreadyDone) return state;

  const newCompletedDays = [...completedDays, { week, day }].sort(
    (a, b) => a.week - b.week || a.day - b.day
  );

  let nextWeek = state.current_week;
  let nextDay = state.current_day;
  const newCompletedWeeks = [...state.completed_weeks];

  if (day < 7) {
    nextWeek = week;
    nextDay = day + 1;
  } else {
    if (!newCompletedWeeks.includes(week)) newCompletedWeeks.push(week);
    newCompletedWeeks.sort((a, b) => a - b);
    nextWeek = week + 1;
    nextDay = 1;
  }

  if (nextWeek < state.current_week || (nextWeek === state.current_week && nextDay < state.current_day)) {
    nextWeek = state.current_week;
    nextDay = state.current_day;
  }

  const isCompleted = nextWeek > state.duration_weeks;
  const newStatus = isCompleted ? 'completed' : state.status;
  const momentumSnapshot = isCompleted
    ? state.momentum_snapshot
    : buildMomentumSnapshot(state.duration_weeks as DurationWeeks, nextWeek);

  const updatePayload: Record<string, unknown> = {
    current_week: nextWeek,
    current_day: nextDay,
    completed_weeks: newCompletedWeeks,
    completed_days: newCompletedDays,
    momentum_snapshot: momentumSnapshot,
    status: newStatus,
    updated_at: new Date().toISOString(),
  };
  if (lastGeneratedContentId != null) {
    updatePayload.last_generated_content_id = lastGeneratedContentId;
  }

  const { data: updated, error } = await supabase
    .from('campaign_execution_state')
    .update(updatePayload)
    .eq('campaign_id', campaignId)
    .select()
    .single();

  if (error) throw new Error(`Failed to mark day complete: ${error.message}`);
  return toState(updated);
}

/**
 * Mark a week complete. Idempotent: if week already in completed_weeks, no-op.
 */
export async function markWeekComplete(
  campaignId: string,
  week: number
): Promise<CampaignExecutionState | null> {
  const { data: row, error: fetchError } = await supabase
    .from('campaign_execution_state')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (fetchError || !row) return null;

  const state = toState(row);
  if (state.status === 'completed') return state;
  if (state.completed_weeks.includes(week)) return state;

  const newCompletedWeeks = [...state.completed_weeks, week].sort((a, b) => a - b);
  const nextWeek = Math.max(week + 1, state.current_week);
  const isCompleted = nextWeek > state.duration_weeks;
  const newStatus = isCompleted ? 'completed' : state.status;
  const momentumSnapshot = isCompleted
    ? state.momentum_snapshot
    : buildMomentumSnapshot(state.duration_weeks as DurationWeeks, nextWeek);

  const { data: updated, error } = await supabase
    .from('campaign_execution_state')
    .update({
      current_week: nextWeek,
      current_day: 1,
      completed_weeks: newCompletedWeeks,
      status: newStatus,
      momentum_snapshot: momentumSnapshot,
      updated_at: new Date().toISOString(),
    })
    .eq('campaign_id', campaignId)
    .select()
    .single();

  if (error) throw new Error(`Failed to mark week complete: ${error.message}`);
  return toState(updated);
}

/**
 * Get campaign execution state. Returns null if not found.
 */
export async function getCampaignState(campaignId: string): Promise<CampaignExecutionState | null> {
  const { data, error } = await supabase
    .from('campaign_execution_state')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (error) throw new Error(`Failed to get campaign state: ${error.message}`);
  if (!data) return null;
  return toState(data);
}

/**
 * Resume campaign. Returns next actionable week/day; never regresses; idempotent (read-only state).
 */
export async function resumeCampaign(campaignId: string): Promise<ResumeResult | null> {
  const state = await getCampaignState(campaignId);
  if (!state) return null;

  if (state.status === 'completed') {
    return {
      campaign_id: campaignId,
      status: 'completed',
      next_week: state.duration_weeks,
      next_day: 7,
      momentum_level: state.momentum_snapshot.momentum_level,
      psychological_movement: state.momentum_snapshot.psychological_movement,
      completed_weeks: state.completed_weeks,
      completed_days: state.completed_days,
      is_completed: true,
    };
  }

  if (state.current_week > state.duration_weeks) {
    await supabase
      .from('campaign_execution_state')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      })
      .eq('campaign_id', campaignId);
    return {
      campaign_id: campaignId,
      status: 'completed',
      next_week: state.duration_weeks,
      next_day: 7,
      momentum_level: state.momentum_snapshot.momentum_level,
      psychological_movement: state.momentum_snapshot.psychological_movement,
      completed_weeks: state.completed_weeks,
      completed_days: state.completed_days,
      is_completed: true,
    };
  }

  return {
    campaign_id: campaignId,
    status: state.status,
    next_week: state.current_week,
    next_day: state.current_day,
    momentum_level: state.momentum_snapshot.momentum_level,
    psychological_movement: state.momentum_snapshot.psychological_movement,
    completed_weeks: state.completed_weeks,
    completed_days: state.completed_days,
    is_completed: false,
  };
}
