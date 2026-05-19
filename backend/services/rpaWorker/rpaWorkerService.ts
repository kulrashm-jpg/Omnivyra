import { enqueueRpaTask, startRpaWorker } from './rpaTaskQueue';
import { buildScript } from './rpaPlatformScripts';
import { runRpaScript } from './rpaPlaywrightRunner';
import { rpaEnvReady, assertRpaEnvReady, isProbeFailure } from './rpaEnv';
import { admitRpaTask, observeAllActiveOrgs } from './rpaQueueState';
import { enqueueRpaRetry, flushRpaRetryQueueRoundRobin } from './rpaRetryQueue';
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
};

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
    return flushRpaRetryQueueRoundRobin({
      handler: async (task) => {
        // Retry path bypasses the admission gate to avoid infinite
        // deferral during partial outages. Env readiness is still
        // enforced downstream by the playwright runner.
        const h = handlers[normalizePlatform(task.platform)];
        if (!h) return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED' };
        return h(task);
      },
      limitPerOrg: opts?.limit_per_org,
      maxOrgs: opts?.max_orgs,
    });
  },
};

/**
 * Unified Playwright-backed handler for every platform. Script selection
 * is delegated to `buildScript(task)`; a platform that has no script for
 * the requested action is surfaced as a structured failure.
 */
const playwrightHandler: RpaHandler = async (task) => {
  const script = buildScript(task);
  if ('error' in script) {
    return { success: false, error: script.error };
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

export const executeRpaTask = async (task: RpaTask): Promise<RpaResult> => {
  const validation = validateTask(task);
  if (!validation.ok) {
    return { success: false, error: validation.error };
  }

  // Environment gate: fail fast when Playwright isn't ready rather than
  // draining the queue with identical failures.
  const ready = await rpaEnvReady();
  if (isProbeFailure(ready)) {
    // Defer to the retry buffer so the scheduler's backpressure worker
    // can drain once the env is fixed, rather than losing the task.
    await enqueueRpaRetry(task, {
      error: `RPA_ENV_NOT_READY:${ready.reason}`,
      delaySeconds: 120,
    });
    return { success: false, error: `RPA_ENV_NOT_READY:${ready.reason}` };
  }

  // Per-org backpressure gate. Each tenant gets its own READY / DEGRADED
  // / BLOCKED state; a noisy org cannot push others into BLOCKED.
  const admission = await admitRpaTask({ organization_id: task.organization_id });
  if (!admission.admit) {
    await enqueueRpaRetry(task, { error: `RPA_DEFERRED:${admission.reason || admission.status}`, delaySeconds: 60 });
    return { success: false, error: `RPA_DEFERRED:${admission.status}` };
  }

  const handler = handlers[normalizePlatform(task.platform)];
  if (!handler) {
    return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED' };
  }

  startRpaWorker(async (queuedTask) => {
    const taskHandler = handlers[normalizePlatform(queuedTask.platform)];
    if (!taskHandler) {
      return { success: false, error: 'RPA_PLATFORM_NOT_SUPPORTED' };
    }
    return taskHandler(queuedTask);
  });

  try {
    return await enqueueRpaTask(task);
  } catch (error: any) {
    return { success: false, error: error?.message || 'RPA_QUEUE_FAILED' };
  }
};
