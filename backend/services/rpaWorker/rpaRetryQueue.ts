import { randomUUID } from 'crypto';
import type { RpaTask } from './rpaWorkerService';
import { ownedDbTable } from '../../db/writeOwner';

/**
 * Durable RPA retry buffer with per-organization fairness.
 *
 * Phase 9 contract:
 *   - enqueue is keyed by (organization_id, action_id) so the same action can
 *     not be re-queued under a different org via any path.
 *   - flush is split into a per-org sweep (`flushRpaRetryQueueForOrg`) and
 *     a round-robin driver (`flushRpaRetryQueueRoundRobin`) that visits
 *     every org with a backlog, drains up to `limit_per_org` rows each,
 *     and stops when every org has been seen or no org has more work.
 *   - a single tenant with 10,000 failing tasks can never monopolise
 *     the worker's sweep budget; every other org gets its own slice.
 *
 * Backoff on re-queue: max(caller delay, 2^attempts minutes), capped at 120
 * minutes. Max attempts is 5.
 *
 * Execution-safety contract (20261231000002_community_execution_safety):
 *   - Rows are only ever created for PROVABLY-NOT-ACTED deferrals (env not
 *     ready, admission refused). A may-have-acted outcome is never queued.
 *   - A flush must win an atomic compare-and-set claim on the retry row
 *     (`claim_token IS NULL` -> token) AND on the action row
 *     (`community_ai_actions.status` 'approved' -> 'executing', tenant-scoped,
 *     not cancel-requested) before anything runs. Losers do nothing.
 *   - The action is re-run through the executor (kill switch, approval,
 *     playbook + plan limits, URL policy, admission all re-applied). The
 *     executor writes the terminal status; the retry row is then deleted.
 *   - A claim that is never released (worker crash / throw / ledger write
 *     failure) is NOT re-claimed automatically: `claim_token` stays set and
 *     the row is surfaced by `listStaleRpaRetryClaims` for human review.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_CAP_MINUTES = 120;
const DEFAULT_PER_ORG_LIMIT = 10;

// Conservative per-tick global execution cap. A large post-outage backlog
// (worst case ~maxOrgs x limitPerOrg = 1000 serial Chromium sessions in one
// tick) is spread across multiple ticks instead. Env-configurable; does NOT
// change retry counts, backoff, or round-robin fairness — untouched rows
// remain due and drain on the next tick.
const MAX_TASKS_PER_TICK = (() => {
  const o = Number(process.env.RPA_FLUSH_MAX_TASKS_PER_TICK);
  return Number.isInteger(o) && o >= 1 && o <= 1000 ? o : 50;
})();

export async function enqueueRpaRetry(task: RpaTask, opts?: {
  error?: string | null;
  delaySeconds?: number;
}): Promise<{ queued: boolean; attempts: number; next_retry_at: string; error?: string }> {
  const delay = Math.max(1, opts?.delaySeconds ?? 30);
  let nextRetryAt = new Date(Date.now() + delay * 1000).toISOString();
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
      const backoffSeconds = Math.min(BACKOFF_CAP_MINUTES, Math.pow(2, attempts)) * 60;
      nextRetryAt = new Date(Date.now() + Math.max(delay, backoffSeconds) * 1000).toISOString();
      // Re-queue also RELEASES the claim: the only caller able to defer an
      // action is the holder of that action's executing claim.
      const { error } = await ownedDbTable('rpa_retry_queue')
        .update({
          attempts,
          last_error: (opts?.error ?? null)?.toString().slice(0, 500) ?? null,
          last_attempt_at: new Date().toISOString(),
          next_retry_at: nextRetryAt,
          claim_token: null,
          claimed_at: null,
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

export type RetryActionOutcome = {
  ok?: boolean;
  status?: string | null;
  response?: any;
  error?: unknown;
};

/**
 * Runs ONE claimed action (row already transitioned approved -> executing).
 * Production wiring: the community executor with persist:true and
 * expected_from_statuses ['executing'] (see rpaWorkerService).
 */
export type RetryActionRunner = (actionRow: Record<string, any>) => Promise<RetryActionOutcome>;

export type PerOrgFlushOutcome = {
  organization_id: string;
  claimed: number;
  succeeded: number;
  failed: number;
  errors: number;
  /** Rows another worker claimed first (loser did nothing). */
  lost?: number;
  /** Rows whose action was no longer claimable (gone, tenant mismatch, cancelled, not approved). */
  obsolete?: number;
  /** Re-deferred (not acted) and re-queued with backoff. */
  deferred?: number;
  /** Executor reported may-have-acted; the action is `uncertain`, never re-run. */
  uncertain?: number;
};

const RETRY_ROW_COLUMNS =
  'id, action_id, organization_id, platform, action_type, target_url, text, attempts, max_attempts, claim_token, claimed_at';

const SUCCESS_STATUSES = new Set(['executed', 'sent_unverified']);

/** Atomic CAS claim of one retry row. Returns true only for the winner. */
export async function claimRpaRetryRow(input: {
  rowId: string;
  organizationId: string;
  claimToken: string;
  nowIso: string;
}): Promise<boolean> {
  const { data, error } = await ownedDbTable('rpa_retry_queue')
    .update({ claim_token: input.claimToken, claimed_at: input.nowIso, updated_at: input.nowIso })
    .eq('id', input.rowId)
    .eq('organization_id', input.organizationId)
    .is('claim_token', null)
    .lte('next_retry_at', input.nowIso)
    .select('id')
    .maybeSingle();
  return !error && !!data;
}

/**
 * Atomic, tenant-scoped CAS claim of the action row: approved -> executing,
 * only while no cancel has been requested. True only for the winner.
 */
export async function claimRetryActionRow(input: {
  actionId: string;
  organizationId: string;
  tenantId: string;
  nowIso: string;
}): Promise<boolean> {
  const { data, error } = await ownedDbTable('community_ai_actions')
    .update({ status: 'executing', updated_at: input.nowIso })
    .eq('id', input.actionId)
    .eq('organization_id', input.organizationId)
    .eq('tenant_id', input.tenantId)
    .eq('status', 'approved')
    .is('cancel_requested_at', null)
    .select('id, status')
    .maybeSingle();
  return !error && !!data;
}

async function deleteClaimedRow(rowId: string, claimToken: string) {
  await ownedDbTable('rpa_retry_queue').delete().eq('id', rowId).eq('claim_token', claimToken);
}

/**
 * Flush up to `limit` rows from the retry queue for ONE organization.
 * Each row is claimed atomically, its action is claimed atomically, and the
 * action is re-run through `runAction`. See the module contract above.
 */
export async function flushRpaRetryQueueForOrg(input: {
  organization_id: string;
  runAction: RetryActionRunner;
  limit?: number;
  now?: () => Date;
  newClaimToken?: () => string;
}): Promise<PerOrgFlushOutcome> {
  const { organization_id: orgId, runAction } = input;
  const limit = input.limit ?? DEFAULT_PER_ORG_LIMIT;
  const now = input.now ?? (() => new Date());
  const newToken = input.newClaimToken ?? (() => randomUUID());
  let claimed = 0, succeeded = 0, failed = 0, errors = 0, lost = 0, obsolete = 0, deferred = 0, uncertain = 0;

  try {
    const { data: rows } = await ownedDbTable('rpa_retry_queue')
      .select(RETRY_ROW_COLUMNS)
      .eq('organization_id', orgId)
      .is('claim_token', null)
      .lte('next_retry_at', now().toISOString())
      .order('next_retry_at', { ascending: true })
      .limit(limit);

    for (const row of (rows || []) as Array<Record<string, any>>) {
      const attempts = Number(row.attempts ?? 0);
      const maxAttempts = Number(row.max_attempts ?? MAX_ATTEMPTS);
      if (attempts >= maxAttempts) continue; // exhausted rows are never re-run

      const token = newToken();
      const won = await claimRpaRetryRow({
        rowId: String(row.id),
        organizationId: orgId,
        claimToken: token,
        nowIso: now().toISOString(),
      });
      if (!won) { lost += 1; continue; }
      claimed += 1;

      try {
        const { data: action } = await ownedDbTable('community_ai_actions')
          .select('*')
          .eq('id', row.action_id)
          .eq('organization_id', orgId)
          .maybeSingle();
        if (!action || !(action as any).tenant_id) {
          obsolete += 1;
          await deleteClaimedRow(String(row.id), token);
          continue;
        }
        const actionClaimed = await claimRetryActionRow({
          actionId: String(row.action_id),
          organizationId: orgId,
          tenantId: String((action as any).tenant_id),
          nowIso: now().toISOString(),
        });
        if (!actionClaimed) {
          // Another path owns the action, it was cancelled, or it is no
          // longer approved. Nothing runs; the retry row is obsolete.
          obsolete += 1;
          await deleteClaimedRow(String(row.id), token);
          continue;
        }

        let out: RetryActionOutcome;
        try {
          out = await runAction({ ...(action as Record<string, any>), status: 'executing' });
        } catch (err: any) {
          // Unclassified: the action may have run. Keep the claim (stale
          // claims surface for review); the action row stays `executing`
          // until the reaper marks it `uncertain`. Never re-run.
          errors += 1;
          console.warn('[rpaRetryQueue] runAction threw; claim retained for review:', err?.message || err, 'org=', orgId);
          continue;
        }

        if (out?.response?.persist_error) {
          // The terminal ledger write failed — the ledger does not know the
          // outcome. Keep the claim for review; never re-run.
          errors += 1;
          continue;
        }
        const status = String(out?.status ?? '');
        if (status === 'deferred') {
          // Not acted; enqueueRpaRetry already re-queued the row with backoff
          // and released the claim.
          deferred += 1;
          continue;
        }
        if (SUCCESS_STATUSES.has(status)) succeeded += 1;
        else if (status === 'uncertain') uncertain += 1;
        else failed += 1;
        // The executor wrote the terminal status on the action row; the
        // retry row has served its purpose.
        await deleteClaimedRow(String(row.id), token);
      } catch (err: any) {
        errors += 1;
        console.warn('[rpaRetryQueue] row processing failed; claim retained:', err?.message || err, 'org=', orgId);
      }
    }
  } catch (err: any) {
    errors += 1;
    console.warn('[rpaRetryQueue] per-org sweep failed:', err?.message || err, 'org=', orgId);
  }

  return { organization_id: orgId, claimed, succeeded, failed, errors, lost, obsolete, deferred, uncertain };
}

/**
 * Claims that were taken but never released (crash, throw, or a failed
 * ledger write). These are NEVER re-claimed automatically — the action may
 * have been performed. Surfaced for human review.
 */
export async function listStaleRpaRetryClaims(input?: {
  olderThanMs?: number;
  limit?: number;
  now?: () => Date;
}): Promise<Array<Record<string, any>>> {
  const now = input?.now ?? (() => new Date());
  const cutoff = new Date(now().getTime() - (input?.olderThanMs ?? 10 * 60_000)).toISOString();
  try {
    const { data } = await ownedDbTable('rpa_retry_queue')
      .select(RETRY_ROW_COLUMNS)
      .not('claim_token', 'is', null)
      .lt('claimed_at', cutoff)
      .order('claimed_at', { ascending: true })
      .limit(input?.limit ?? 100);
    return (data || []) as Array<Record<string, any>>;
  } catch {
    return [];
  }
}

/**
 * Fair round-robin retry flush. Enumerates organization_ids with at
 * least one due, unclaimed retry row (attempts < max_attempts,
 * next_retry_at <= now()), visits each one with a bounded per-org limit.
 * No org can monopolise the sweep.
 *
 * Returns aggregate counters + remaining backlog so the scheduler's
 * activity log surfaces the state.
 */
export async function flushRpaRetryQueueRoundRobin(input: {
  runAction: RetryActionRunner;
  limitPerOrg?: number;
  maxOrgs?: number;
}): Promise<{
  orgs_visited: number;
  claimed: number;
  succeeded: number;
  failed: number;
  errors: number;
  remaining: number;
  stale_claims?: number;
  per_org?: PerOrgFlushOutcome[];
}> {
  const limitPerOrg = input.limitPerOrg ?? DEFAULT_PER_ORG_LIMIT;
  const maxOrgs = input.maxOrgs ?? 100;

  // Distinct org enumeration from the retry queue itself — orgs with no
  // due retries are skipped. We pull up to 10x maxOrgs candidate rows so
  // we can dedupe without querying per-org separately.
  let orgIds: string[] = [];
  try {
    const { data } = await ownedDbTable('rpa_retry_queue')
      .select('organization_id')
      .lte('next_retry_at', new Date().toISOString())
      .lt('attempts', MAX_ATTEMPTS)
      .is('claim_token', null)
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
  let budget = MAX_TASKS_PER_TICK;
  for (const orgId of orgIds) {
    if (budget <= 0) break; // per-tick cap reached — remaining orgs drain next tick
    const outcome = await flushRpaRetryQueueForOrg({
      organization_id: orgId,
      runAction: input.runAction,
      // Round-robin fairness preserved: still <= limitPerOrg per org, just
      // additionally bounded by the remaining global per-tick budget.
      limit: Math.min(limitPerOrg, budget),
    });
    perOrg.push(outcome);
    claimed += outcome.claimed;
    succeeded += outcome.succeeded;
    failed += outcome.failed;
    errors += outcome.errors;
    budget -= outcome.claimed;
  }

  // Remaining backlog across all orgs (rows still eligible and unclaimed).
  const { count: remaining } = await ownedDbTable('rpa_retry_queue')
    .select('id', { count: 'exact', head: true })
    .lt('attempts', MAX_ATTEMPTS)
    .is('claim_token', null);

  const stale = await listStaleRpaRetryClaims({ limit: 1000 });

  return {
    orgs_visited: orgIds.length,
    claimed,
    succeeded,
    failed,
    errors,
    remaining: remaining ?? 0,
    stale_claims: stale.length,
    per_org: perOrg,
  };
}
