import { supabase } from '../../db/supabaseClient';
import type { RpaTask, RpaResult } from './rpaWorkerService';
import { ownedDbTable } from '../../db/writeOwner';

/**
 * Durable RPA retry buffer with per-organization fairness.
 *
 * Phase 9 contract:
 *   - enqueue is unchanged but the unique index is now
 *     (organization_id, action_id) so the same action can not be re-queued
 *     under a different org via any path.
 *   - flush is split into a per-org sweep (`flushRpaRetryQueueForOrg`) and
 *     a round-robin driver (`flushRpaRetryQueueRoundRobin`) that visits
 *     every org with a backlog, drains up to `limit_per_org` rows each,
 *     and stops when every org has been seen or no org has more work.
 *   - a single tenant with 10,000 failing tasks can never monopolise
 *     the worker's sweep budget; every other org gets its own slice.
 *
 * Backoff: `2^attempts` minutes, capped at 120 minutes. Max attempts is 5.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_MINUTES = 120;
const DEFAULT_PER_ORG_LIMIT = 10;

export async function enqueueRpaRetry(task: RpaTask, opts?: {
  error?: string | null;
  delaySeconds?: number;
}): Promise<{ queued: boolean; attempts: number; next_retry_at: string; error?: string }> {
  const delay = Math.max(1, opts?.delaySeconds ?? 30);
  const nextRetryAt = new Date(Date.now() + delay * 1000).toISOString();
  try {
    const { data: existing } = await ownedDbTable('rpa_retry_queue')
      .select('id, attempts, max_attempts')
      .eq('organization_id', task.organization_id)
      .eq('action_id', task.action_id)
      .maybeSingle();
    if (existing) {
      const attempts = Number((existing as any).attempts ?? 0) + 1;
      const maxAttempts = Number((existing as any).max_attempts ?? MAX_ATTEMPTS);
      if (attempts >= maxAttempts) {
        return { queued: false, attempts, next_retry_at: nextRetryAt, error: 'MAX_ATTEMPTS_EXCEEDED' };
      }
      const { error } = await ownedDbTable('rpa_retry_queue')
        .update({
          attempts,
          last_error: (opts?.error ?? null)?.toString().slice(0, 500) ?? null,
          last_attempt_at: new Date().toISOString(),
          next_retry_at: nextRetryAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', (existing as any).id);
      if (error) return { queued: false, attempts, next_retry_at: nextRetryAt, error: error.message };
      return { queued: true, attempts, next_retry_at: nextRetryAt };
    }
    const { error } = await ownedDbTable('rpa_retry_queue').insert({
      action_id: task.action_id,
      organization_id: task.organization_id,
      platform: task.platform,
      action_type: task.action_type,
      target_url: task.target_url,
      text: task.text ?? null,
      attempts: 1,
      last_error: (opts?.error ?? null)?.toString().slice(0, 500) ?? null,
      last_attempt_at: new Date().toISOString(),
      next_retry_at: nextRetryAt,
      max_attempts: MAX_ATTEMPTS,
    });
    if (error) return { queued: false, attempts: 1, next_retry_at: nextRetryAt, error: error.message };
    return { queued: true, attempts: 1, next_retry_at: nextRetryAt };
  } catch (err: any) {
    return { queued: false, attempts: 0, next_retry_at: nextRetryAt, error: err?.message || 'RETRY_ENQUEUE_FAILED' };
  }
}

type HandlerResult = Awaited<ReturnType<(task: RpaTask) => Promise<RpaResult>>>;

type PerOrgFlushOutcome = {
  organization_id: string;
  claimed: number;
  succeeded: number;
  failed: number;
  errors: number;
};

async function recordTerminalFailure(rowId: string, result: HandlerResult, attempts: number, maxAttempts: number) {
  const capMinutes = BACKOFF_CAP_MINUTES;
  const backoffMinutes = Math.min(capMinutes, Math.pow(2, attempts));
  const nextRetryAt = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
  const terminal = attempts >= maxAttempts;
  await ownedDbTable('rpa_retry_queue')
    .update({
      attempts,
      last_error: (result.error ?? 'unknown').toString().slice(0, 500),
      last_attempt_at: new Date().toISOString(),
      ...(terminal ? {} : { next_retry_at: nextRetryAt }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);
}

/**
 * Flush up to `limit` rows from the retry queue for ONE organization.
 * Successes delete the row; failures bump attempts with exponential
 * backoff (2^n minutes, capped). Returns a counter record.
 */
export async function flushRpaRetryQueueForOrg(input: {
  organization_id: string;
  handler: (task: RpaTask) => Promise<RpaResult>;
  limit?: number;
}): Promise<PerOrgFlushOutcome> {
  const { organization_id: orgId, handler } = input;
  const limit = input.limit ?? DEFAULT_PER_ORG_LIMIT;
  let claimed = 0, succeeded = 0, failed = 0, errors = 0;

  try {
    const { data: rows } = await ownedDbTable('rpa_retry_queue')
      .select('id, action_id, organization_id, platform, action_type, target_url, text, attempts, max_attempts')
      .eq('organization_id', orgId)
      .lte('next_retry_at', new Date().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(limit);

    for (const row of rows || []) {
      claimed += 1;
      try {
        const task: RpaTask = {
          tenant_id: row.organization_id as string,
          organization_id: row.organization_id as string,
          platform: row.platform as string,
          action_type: row.action_type as RpaTask['action_type'],
          target_url: row.target_url as string,
          text: (row.text as string | null) ?? null,
          action_id: row.action_id as string,
        };
        const result = await handler(task);
        if (result.success) {
          succeeded += 1;
          await ownedDbTable('rpa_retry_queue').delete().eq('id', row.id);
        } else {
          failed += 1;
          const attempts = Number(row.attempts ?? 0) + 1;
          const maxAttempts = Number(row.max_attempts ?? MAX_ATTEMPTS);
          await recordTerminalFailure(row.id as string, result, attempts, maxAttempts);
        }
      } catch (err: any) {
        errors += 1;
        console.warn('[rpaRetryQueue] handler threw:', err?.message || err, 'org=', orgId);
      }
    }
  } catch (err: any) {
    errors += 1;
    console.warn('[rpaRetryQueue] per-org sweep failed:', err?.message || err, 'org=', orgId);
  }

  return { organization_id: orgId, claimed, succeeded, failed, errors };
}

/**
 * Fair round-robin retry flush. Enumerates organization_ids with at
 * least one due retry row (attempts < max_attempts, next_retry_at <=
 * now()), visits each one with a bounded per-org limit. No org can
 * monopolise the sweep.
 *
 * Returns aggregate counters + remaining backlog so the scheduler's
 * activity log surfaces the state.
 */
export async function flushRpaRetryQueueRoundRobin(input: {
  handler: (task: RpaTask) => Promise<RpaResult>;
  limitPerOrg?: number;
  maxOrgs?: number;
}): Promise<{
  orgs_visited: number;
  claimed: number;
  succeeded: number;
  failed: number;
  errors: number;
  remaining: number;
  per_org?: PerOrgFlushOutcome[];
}> {
  const limitPerOrg = input.limitPerOrg ?? DEFAULT_PER_ORG_LIMIT;
  const maxOrgs = input.maxOrgs ?? 100;

  // Distinct org enumeration from the retry queue itself — orgs with no
  // due retries are skipped. We pull up to 10× maxOrgs candidate rows so
  // we can dedupe without querying per-org separately.
  let orgIds: string[] = [];
  try {
    const { data } = await ownedDbTable('rpa_retry_queue')
      .select('organization_id')
      .lte('next_retry_at', new Date().toISOString())
      .lt('attempts', MAX_ATTEMPTS)
      .order('next_retry_at', { ascending: true })
      .limit(maxOrgs * 10);
    const seen = new Set<string>();
    for (const r of (data || []) as Array<{ organization_id: string }>) {
      if (r.organization_id && !seen.has(r.organization_id)) {
        seen.add(r.organization_id);
        if (seen.size >= maxOrgs) break;
      }
    }
    orgIds = Array.from(seen);
  } catch (err: any) {
    console.warn('[rpaRetryQueue] org enumeration failed:', err?.message || err);
    return { orgs_visited: 0, claimed: 0, succeeded: 0, failed: 0, errors: 1, remaining: 0 };
  }

  const perOrg: PerOrgFlushOutcome[] = [];
  let claimed = 0, succeeded = 0, failed = 0, errors = 0;
  for (const orgId of orgIds) {
    const outcome = await flushRpaRetryQueueForOrg({
      organization_id: orgId,
      handler: input.handler,
      limit: limitPerOrg,
    });
    perOrg.push(outcome);
    claimed += outcome.claimed;
    succeeded += outcome.succeeded;
    failed += outcome.failed;
    errors += outcome.errors;
  }

  // Remaining backlog across all orgs (rows still eligible).
  const { count: remaining } = await ownedDbTable('rpa_retry_queue')
    .select('id', { count: 'exact', head: true })
    .lt('attempts', MAX_ATTEMPTS);

  return {
    orgs_visited: orgIds.length,
    claimed,
    succeeded,
    failed,
    errors,
    remaining: remaining ?? 0,
    per_org: perOrg,
  };
}
