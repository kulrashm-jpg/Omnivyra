import { supabase } from '../db/supabaseClient';
import { ownedDbTable } from '../db/writeOwner';

type LockState = {
  locked_by: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  retry_count: number;
  max_retries: number;
  plan_version: number;
};

export class CreatorExecutionLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreatorExecutionLockError';
  }
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isLeaseActive(leaseExpiresAt: string | null | undefined): boolean {
  if (!leaseExpiresAt) return false;
  const expiresAt = new Date(leaseExpiresAt);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > Date.now();
}

export async function acquireCreatorExecutionLock(input: {
  dailyPlanId: string;
  lockOwner: string;
  expectedPlanVersion: number;
  leaseSeconds?: number;
}): Promise<LockState> {
  const leaseSeconds = Math.max(30, Math.min(900, Number(input.leaseSeconds ?? 300)));
  const { data, error } = await supabase.rpc('claim_creator_execution_lock', {
    p_daily_plan_id: input.dailyPlanId,
    p_lock_owner: input.lockOwner,
    p_expected_plan_version: input.expectedPlanVersion,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new CreatorExecutionLockError(`Failed to claim creator execution lock: ${error.message}`);
  }
  const claimedRows = Array.isArray(data) ? data : data ? [data] : [];
  const claimed = claimedRows[0] as Record<string, unknown> | undefined;
  if (!claimed) {
    const { data: existing, error: inspectError } = await ownedDbTable('daily_content_plans')
      .select('locked_by, lease_expires_at, attempt_count, retry_count, max_retries, plan_version')
      .eq('id', input.dailyPlanId)
      .maybeSingle();
    if (inspectError) {
      throw new CreatorExecutionLockError(`Failed to inspect creator execution lock: ${inspectError.message}`);
    }
    if (!existing) {
      throw new CreatorExecutionLockError('Daily content plan not found for creator execution');
    }
    const currentPlanVersion = toNumber((existing as any).plan_version, 1);
    if (currentPlanVersion !== input.expectedPlanVersion) {
      throw new CreatorExecutionLockError(
        `Stale daily content plan version ${currentPlanVersion}; expected ${input.expectedPlanVersion}`
      );
    }
    const currentLockOwner = typeof (existing as any).locked_by === 'string' ? String((existing as any).locked_by) : null;
    const currentLease = typeof (existing as any).lease_expires_at === 'string' ? String((existing as any).lease_expires_at) : null;
    if (currentLockOwner && currentLockOwner !== input.lockOwner && isLeaseActive(currentLease)) {
      throw new CreatorExecutionLockError(`Daily content plan is already locked by ${currentLockOwner}`);
    }
    throw new CreatorExecutionLockError('Unable to claim creator execution lock');
  }

  return {
    locked_by: String((claimed as any).locked_by || input.lockOwner),
    lease_expires_at: typeof (claimed as any).lease_expires_at === 'string' ? String((claimed as any).lease_expires_at) : null,
    attempt_count: toNumber((claimed as any).attempt_count, 1),
    retry_count: toNumber((claimed as any).retry_count, 0),
    max_retries: Math.max(1, toNumber((claimed as any).max_retries, 3)),
    plan_version: toNumber((claimed as any).plan_version, input.expectedPlanVersion),
  };
}

export async function extendCreatorExecutionLease(input: {
  dailyPlanId: string;
  lockOwner: string;
  leaseSeconds?: number;
}): Promise<void> {
  const leaseSeconds = Math.max(30, Math.min(900, Number(input.leaseSeconds ?? 300)));
  const { data, error } = await supabase.rpc('extend_creator_execution_lock', {
    p_daily_plan_id: input.dailyPlanId,
    p_lock_owner: input.lockOwner,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new CreatorExecutionLockError(`Failed to extend creator execution lock: ${error.message}`);
  }
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (!rows[0]) {
    throw new CreatorExecutionLockError('Creator execution lock heartbeat lost ownership');
  }
}

export async function releaseCreatorExecutionLock(input: {
  dailyPlanId: string;
  lockOwner: string;
}): Promise<void> {
  const { error } = await ownedDbTable('daily_content_plans')
    .update({
      locked_by: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.dailyPlanId)
    .eq('locked_by', input.lockOwner);

  if (error) {
    throw new CreatorExecutionLockError(`Failed to release creator execution lock: ${error.message}`);
  }
}
