/**
 * EXECUTION ENGINE WRITE BOUNDARY
 *
 * This is the ONLY location allowed to write to `daily_content_plans`.
 *
 * All planners (AI, Blueprint, Board, Manual) must call this service.
 *
 * Do NOT write directly to the table from APIs or UI layers.
 */

import { supabase } from '../db/supabaseClient';

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
  generation_source?: string;
};

export type ExecutionSource = 'blueprint' | 'AI' | 'board' | 'manual';

const VALID_SOURCES: ExecutionSource[] = ['AI', 'blueprint', 'board', 'manual'];

function log(source: ExecutionSource, msg: string, data?: Record<string, unknown>) {
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[EXECUTION_ENGINE] source=${source} ${msg}${payload}`);
  }
}

/** Error code when week has executing plans and forceOverride is false */
export const WEEK_EXECUTION_LOCKED = 'WEEK_EXECUTION_LOCKED';

/**
 * Delete a single activity by id.
 * Used by admin delete-activity API.
 */
export async function deleteActivity(activityId: string): Promise<{ deleted: boolean }> {
  log('manual', 'deleteActivity', { activityId });

  const { data, error } = await supabase
    .from('daily_content_plans')
    .delete()
    .eq('id', activityId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[EXECUTION_ENGINE] deleteActivity failed:', error);
    throw new Error(`Failed to delete activity: ${error.message}`);
  }
  return { deleted: !!data };
}

/**
 * Delete all daily plans for a campaign week.
 * Rejects if any row has status='executing' unless forceOverride is true.
 */
export async function deleteWeekPlans(
  campaignId: string,
  weekNumber: number,
  options?: { forceOverride?: boolean }
): Promise<void> {
  const forceOverride = options?.forceOverride ?? false;

  if (!forceOverride) {
    const { data: executing } = await supabase
      .from('daily_content_plans')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('week_number', weekNumber)
      .eq('status', 'executing')
      .limit(1);

    if (executing && executing.length > 0) {
      if (process.env.NODE_ENV !== 'test') {
        console.warn('[EXECUTION_ENGINE] WEEK_EXECUTION_LOCKED', { campaignId, weekNumber });
      }
      const err = new Error('Week is executing; regeneration blocked. Use forceOverride to override.');
      (err as any).code = WEEK_EXECUTION_LOCKED;
      throw err;
    }
  }

  const { error } = await supabase
    .from('daily_content_plans')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('week_number', weekNumber);

  if (error) {
    console.error('[EXECUTION_ENGINE] deleteWeekPlans failed:', error);
    throw new Error(`Failed to delete week plans: ${error.message}`);
  }
}

/**
 * Validate week plan count after generation.
 * Logs warning if count not between 1 and 7.
 */
function validateWeekConsistency(campaignId: string, weekNumber: number): void {
  supabase
    .from('daily_content_plans')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('week_number', weekNumber)
    .then(
      ({ count }) => {
        const c = Number(count ?? 0);
        if (c < 1 || c > 7) {
          if (process.env.NODE_ENV !== 'test') {
            console.warn('[EXECUTION_ENGINE_WARNING] unexpected plan count', {
              campaignId,
              weekNumber,
              count: c,
            });
          }
        }
      },
      () => {}
    );
}

/**
 * Replace week plans: delete existing, insert new.
 * All planners must use this for writes.
 */
export async function saveWeekPlans(
  campaignId: string,
  weekNumber: number,
  plans: ExecutionPlanRow[],
  source: ExecutionSource,
  options?: { forceOverride?: boolean }
): Promise<{ rowsInserted: number }> {
  log(source, 'saveWeekPlans', { campaignId, weekNumber, count: plans.length });
  await deleteWeekPlans(campaignId, weekNumber, { forceOverride: options?.forceOverride });
  if (plans.length === 0) {
    return { rowsInserted: 0 };
  }

  const sourceVal = VALID_SOURCES.includes(source) ? source : 'manual';
  const rowsWithSource = plans.map((p) => ({
    ...p,
    generation_source: sourceVal,
  }));

  const { error } = await supabase.from('daily_content_plans').insert(rowsWithSource);
  if (error) {
    console.error('[EXECUTION_ENGINE] saveWeekPlans insert failed:', error);
    throw new Error(`Failed to save daily plans: ${error.message}`);
  }

  validateWeekConsistency(campaignId, weekNumber);
  return { rowsInserted: plans.length };
}

/**
 * Insert a single activity row.
 * Used when board/creator creates one activity (e.g. creator asset upload when no row exists).
 */
export async function insertActivity(
  row: ExecutionPlanRow,
  source: ExecutionSource
): Promise<{ id: string }> {
  log(source, 'insertActivity', { campaign_id: row.campaign_id, week_number: row.week_number });
  const sourceVal = VALID_SOURCES.includes(source) ? source : 'manual';
  const rowWithSource = { ...row, generation_source: sourceVal };
  const { data, error } = await supabase
    .from('daily_content_plans')
    .insert(rowWithSource)
    .select('id')
    .single();
  if (error) {
    console.error('[EXECUTION_ENGINE] insertActivity failed:', error);
    throw new Error(`Failed to insert activity: ${error.message}`);
  }
  return { id: (data as { id: string })?.id ?? '' };
}

/**
 * Update a single activity by id.
 * Used by board automation for partial updates (reorder, content, etc).
 */
export async function updateActivity(
  activityId: string,
  updates: Record<string, unknown>,
  source: ExecutionSource
): Promise<{ updated: boolean }> {
  log(source, 'updateActivity', { activityId, keys: Object.keys(updates || {}) });

  const sanitized: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };
  delete sanitized.id;
  delete sanitized.campaign_id;
  delete sanitized.created_at;

  const { data, error } = await supabase
    .from('daily_content_plans')
    .update(sanitized)
    .eq('id', activityId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[EXECUTION_ENGINE] updateActivity failed:', error);
    throw new Error(`Failed to update activity: ${error.message}`);
  }
  return { updated: !!data };
}
