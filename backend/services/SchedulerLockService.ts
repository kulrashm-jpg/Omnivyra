/**
 * Stage 19 — Idempotent Execution & Concurrency Guard.
 * Prevents concurrent schedule-structured-plan executions per campaign.
 */

import { createServiceRoleMigrationProxy } from '../db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { randomUUID } from 'crypto';

/** Lock window: concurrent executions blocked within this period (minutes). */
const LOCK_WINDOW_MINUTES = 5;
const LOCK_WINDOW_MS = LOCK_WINDOW_MINUTES * 60 * 1000;

export class SchedulerLockError extends Error {
  code: 'SCHEDULER_ALREADY_RUNNING' | 'SCHEDULER_LOCK_STALE';

  constructor(code: SchedulerLockError['code']) {
    super(code);
    this.name = 'SchedulerLockError';
    this.code = code;
  }
}

/**
 * Acquire a scheduler lock for the campaign.
 * Throws SCHEDULER_ALREADY_RUNNING if lock exists and is fresh (< 5 min).
 * Allows override if lock is stale (> 5 min).
 * @returns lockId to pass to releaseSchedulerLock
 */
export async function acquireSchedulerLock(campaignId: string): Promise<string> {
  const newLockId = randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - LOCK_WINDOW_MS).toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('campaigns')
    .update({
      scheduler_lock_id: newLockId,
      scheduler_locked_at: now,
      updated_at: now,
    })
    .eq('id', campaignId)
    .or(`scheduler_lock_id.is.null,scheduler_locked_at.lt.${staleBefore}`)
    .select('id')
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to acquire scheduler lock: ${updateError.message}`);
  }
  if (!updated) {
    const { data: exists, error: fetchError } = await supabase
      .from('campaigns')
      .select('id')
      .eq('id', campaignId)
      .maybeSingle();
    if (fetchError || !exists) throw new Error('Campaign not found');
    throw new SchedulerLockError('SCHEDULER_ALREADY_RUNNING');
  }

  return newLockId;
}

/**
 * Release the scheduler lock. Only clears if lockId matches.
 */
export async function releaseSchedulerLock(
  campaignId: string,
  lockId: string
): Promise<void> {
  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('scheduler_lock_id')
    .eq('id', campaignId)
    .maybeSingle();

  if (fetchError || !campaign) return;

  const currentLockId = (campaign as any).scheduler_lock_id;
  if (currentLockId !== lockId) return;

  await supabase
    .from('campaigns')
    .update({
      scheduler_lock_id: null,
      scheduler_locked_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', campaignId)
    .eq('scheduler_lock_id', lockId);
}
