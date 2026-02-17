/**
 * Stage 19 — Idempotent Execution & Concurrency Guard.
 * Prevents concurrent schedule-structured-plan executions per campaign.
 */

import { supabase } from '../db/supabaseClient';
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
  const { data: campaign, error: fetchError } = await supabase
    .from('campaigns')
    .select('scheduler_lock_id, scheduler_locked_at')
    .eq('id', campaignId)
    .maybeSingle();

  if (fetchError || !campaign) {
    throw new Error('Campaign not found');
  }

  const lockId = (campaign as any).scheduler_lock_id;
  const lockedAt = (campaign as any).scheduler_locked_at;

  if (lockId && lockedAt) {
    const lockedAtMs = new Date(lockedAt).getTime();
    const ageMs = Date.now() - lockedAtMs;

    if (ageMs < LOCK_WINDOW_MS) {
      throw new SchedulerLockError('SCHEDULER_ALREADY_RUNNING');
    }
  }

  const newLockId = randomUUID();
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('campaigns')
    .update({
      scheduler_lock_id: newLockId,
      scheduler_locked_at: now,
      updated_at: now,
    })
    .eq('id', campaignId);

  if (updateError) {
    throw new Error(`Failed to acquire scheduler lock: ${updateError.message}`);
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
