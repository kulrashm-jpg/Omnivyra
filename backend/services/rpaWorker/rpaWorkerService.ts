import { enqueueRpaTask, startRpaWorker } from './rpaTaskQueue';
import { buildScript } from './rpaPlatformScripts';
import { runRpaScript } from './rpaPlaywrightRunner';
import { rpaEnvReady, assertRpaEnvReady, isProbeFailure } from './rpaEnv';
import { admitRpaTask, observeAllActiveOrgs } from './rpaQueueState';
import { enqueueRpaRetry, flushRpaRetryQueueRoundRobin, type RetryActionRunner } from './rpaRetryQueue';
import { validateRpaTarget } from './rpaTargetUrlPolicy';
import { getCommunityAiPlatformPolicy } from '../communityAiPlatformPolicyService';
import { withHeavyJobSlot } from '../../queue/bullmqClient';

export type RpaTask = {
  tenant_id: string;
  organization_id: string;
  platform: string;
  action_type: 'reply' | 'like' | 'share' | 'follow' | 'schedule';
  target_url: string;
  text?: string | null;
  action_id: string;
};

export type RpaResult = {
  success: boolean;
  /** Platform-native id surfaced by the runner when the script extracted one. */
  platform_id?: string;
  /** Local filesystem path of the audit screenshot (legacy / fallback). */
  screenshot_path?: string;
  /** Durable public URL of the screenshot stored in the rpa-artifacts bucket. */
  screenshot_url?: string;
  error?: string;
  /**
   * Consequence classification for a non-success result:
   *   false     — provably NOT acted (refused/aborted before the submit
   *               interaction); may be retried or re-routed.
   *   true / absent — MAY have acted; must never be retried or re-routed and
   *               is surfaced as `uncertain` for human review.
   */
  may_have_acted?: boolean;
  /** True when the task was not run but was durably queued in rpa_retry_queue. */
  deferred?: boolean;
};

/** Conservative reading: anything not explicitly `may_have_acted:false` may have acted. */
export const rpaResultMayHaveActed = (r: RpaResult | null | undefined): boolean =>
  !r || (r.success !== true && r.may_have_acted !== false && r.deferred !== true);

type RpaHandler = (task: RpaTask) => Promise<RpaResult>;

const normalizePlatform = (platform: string) => platform.trim().toLowerCase();

/**
 * Worker-startup gate: call this from the long-running RPA worker's main
 * loop so a misconfigured environment fails loudly rather than silently
 * draining the queue with RPA_ENV_NOT_READY failures.
 */
export { assertRpaEnvReady };

/**
 * Scheduler entry points. The cron worker calls these on its own cadence
 * to observe state and drain deferred retries. Both are per-org aware:
 *
 *   observeBackpressure — enumerates organizations with recent RPA
 *     activity, computes per-org state, upserts rpa_queue_state.
 *
 *   flushRetries — round-robin over orgs with due retries; each org gets
 *     at most `limit_per_org` sweep slots. No single tenant can
 *     monopolise the worker's attention.
 */
export const rpaSchedulerHooks = {
  observeBackpressure: observeAllActiveOrgs,
  flushRetries: async (opts?: { limit_per_org?: number; max_orgs?: number }) => {
    // Single env readiness check per tick. If Playwright/Chromium is
    // unavailable, skip the whole tick cleanly instead of iterating every
    // due row (each would otherwise fail downstream identically).
    const ready = await rpaEnvReady();
    if (isProbeFailure(ready)) {
      console.warn(`[rpaRetryQueueFlush] skipped — RPA env not ready: ${ready.reason}`);
      return { orgs_visited: 0, claimed: 0, succeeded: 0, failed: 0, errors: 0, remaining: 0 };
    }
    // Platform kill switch: when execution is disabled nothing is claimed,
    // so no action is consumed (mirrors the community scheduler).
    const policy = await getCommunityAiPlatformPolicy();
    if (!policy?.execution_enabled) {
      console.warn('[rpaRetryQueueFlush] skipped — community execution disabled by platform policy');
      return { orgs_visited: 0, claimed: 0, succeeded: 0, failed: 0, errors: 0, remaining: 0 };
    }
    // Every retry row is re-run THROUGH THE EXECUTOR after the flush has
    // atomically claimed both the retry row and the action row
    // (approved → executing). The executor re-applies the platform kill
    // switch, approval, playbook and plan limits, and executeRpaTask
    // re-applies URL policy, env readiness and per-org admission.
    return flushRpaRetryQueueRoundRobin({
      runAction: runClaimedRetryAction,
      limitPerOrg: opts?.limit_per_org,
      maxOrgs: opts?.max_orgs,
    });
  },
};

/** Map a claimed community_ai_actions row to the executor input. */
export function retryRowToExecutorAction(row: Record<string, any>) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    organization_id: row.organization_id,
    platform: row.platform,
    action_type: row.action_type,
    target_id: row.target_id,
    suggested_text: (row.final_text ?? row.suggested_text ?? null) as string | null,
    playbook_id: row.playbook_id ?? null,
    discovered_user_id: row.discovered_user_id ?? null,
    acting_user_id: row.acting_user_id ?? null,
    requires_approval: row.requires_approval ?? null,
    requires_human_approval: row.requires_human_approval ?? null,
    risk_level: row.risk_level ?? null,
    execution_mode: row.execution_mode ?? null,
    tone_used: row.tone_used ?? null,
    approved_at: row.approved_at ?? null,
    status: row.status ?? null,
  };
}

const runClaimedRetryAction: RetryActionRunner = async (actionRow) => {
  const { executeAction } = await import('../communityAiActionExecutorRuntime');
  const deferredSource = actionRow?.execution_result?.response?.deferred_source;
  return executeAction(retryRowToExecutorAction(actionRow) as any, true, {
    source: deferredSource === 'manual' ? 'manual' : 'scheduler',
    persist: true,
    expected_from_statuses: ['executing'],
    notify: true,
    webhook: true,
  });
};

/**
 * Unified Playwright-backed handler for every platform. Script selection
 * is delegated to `buildScript(task)`; a platform that has no script for
 * the requested action is surfaced as a structured failure.
 */
const playwrightHandler: RpaHandler = async (task) => {
  const script = buildScript(task);
  if ('error' in script) {
    return { success: false, error: script.error, may_have_acted: false };
  }
  // Chromium execution counts toward the shared in-process heavy-job budget
  // (HEAVY_JOB_CONCURRENCY) alongside ai-heavy + creator-render. buildScript()
  // is cheap and intentionally left outside the slot. Single chokepoint:
  // covers BOTH the scheduler retry path and the executeRpaTask path.
  return withHeavyJobSlot(() => runRpaScript(task, script));
};

const handlers: Record<string, RpaHandler> = {
  facebook:  playwrightHandler,
  instagram: playwrightHandler,
  twitter:   playwrightHandler,
  reddit:    playwrightHandler,
  linkedin:  playwrightHandler,
};

const validateTask = (task: RpaTask) => {
  if (!task?.tenant_id) return { ok: false, error: 'TENANT_ID_REQUIRED' };
  if (!task?.organization_id) return { ok: false, error: 'ORGANIZATION_ID_REQUIRED' };
  if (!task?.platform) return { ok: false, error: 'PLATFORM_REQUIRED' };
  if (!task?.action_type) return { ok: false, error: 'ACTION_TYPE_REQUIRED' };
  if (!task?.target_url) return { ok: false, error: 'TARGET_URL_REQUIRED' };
  if (!task?.action_id) return { ok: false, error: 'ACTION_ID_REQUIRED' };
  if (task.action_type !== 'reply' && task.action_type !== 'like') {
    return { ok: false, error: 'ACTION_TYPE_NOT_SUPPORTED' };
  }
  return { ok: true };
};

/**
 * Defer a provably-not-acted task to the durable retry queue. Only reports
 * `deferred: true` when the row was actually (re)queued; otherwise the task
 * is a plain not-acted failure.
 */
async function deferToRetryQueue(task: RpaTask, error: string, delaySeconds: number): Promise<RpaResult> {
  const queued = await enqueueRpaRetry(task, { error, delaySeconds });
  if (queued.queued) {
    return { success: false, error, deferred: true, may_have_acted: false };
  }
  return {
    success: false,
    error: `${error}|RETRY_NOT_QUEUED:${queued.error || 'UNKNOWN'}`,
    may_have_acted: false,
  };
}

export const executeRpaTask = async (task: RpaTask): Promise<RpaResult> => {
  const validation = validateTask(task);
  if (!validation.ok) {
    return { success: false, error: validation.error, may_have_acted: false };
  }

  // Target-URL policy BEFORE anything is queued or navigated.
  const target = validateRpaTarget(task);
  if (!target.ok) {
    return { success: false, error: target.error, may_have_acted: false };
  }

  // Environment gate: fail fast when Playwright isn't ready rather than
  // draining the queue with identical failures.
  const ready = await rpaEnvReady();
  if (isProbeFailure(ready)) {
    // Defer to the retry buffer so the scheduler's backpressure worker
    // can drain once the env is fixed, rather than losing the task.
    return deferToRetryQueue(task, `RPA_ENV_NOT_READY:${ready.reason}`, 120);
  }

  // Per-org backpressure gate. Each tenant gets its own READY / DEGRADED
  // / BLOCKED state; a noisy org cannot push others into BLOCKED. Applies to
  // the durable-retry path too (it re-enters here through the executor).
  const admission = await admitRpaTask({ organization_id: task.organization_id });
  if (!admission.admit) {
    const deferred = await deferToRetryQueue(task, `RPA_DEFERRED:${admission.reason || admission.status}`, 60);
    return deferred.deferred ? { ...deferred, error: `RPA_DEFERRED:${admission.status}` } : deferred;
  }

  const handler = handlers[normalizePlatform(task.platform)];
  if (!handler) {
    return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED', may_have_acted: false };
  }

  startRpaWorker(async (queuedTask) => {
    const taskHandler = handlers[normalizePlatform(queuedTask.platform)];
    if (!taskHandler) {
      return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED', may_have_acted: false };
    }
    return taskHandler(queuedTask);
  });

  try {
    return await enqueueRpaTask(task);
  } catch (error: any) {
    // The handler threw: unclassified, the browser may have submitted.
    return { success: false, error: error?.message || 'RPA_QUEUE_FAILED', may_have_acted: true };
  }
};
