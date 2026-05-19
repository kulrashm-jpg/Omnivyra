/**
 * aiAssetGenerationQueue — Phase-2 Step-19.
 *
 * Process-local generation safety: per-campaign lock (no concurrent runs
 * for the same campaign), short-window dedupe (a repeated trigger inside
 * the window joins the in-flight run instead of starting a second), bounded
 * retry with failure isolation, and rollback continuity (a failed/locked
 * run NEVER throws to the caller — the campaign keeps its prior state).
 *
 * HONEST SCOPE: this is an in-process guard, not a distributed queue. It
 * dedupes/locks within a single Node worker. Cross-process coordination is
 * out of scope for an additive orchestration step and is called out in the
 * report's KNOWN REMAINING GAPS.
 */

import { aiAssetGenerationDiagnostics } from './aiAssetGenerationDiagnostics';

type InFlight<T> = { promise: Promise<T>; startedAt: number };

const inflight = new Map<string, InFlight<unknown>>();
const lastCompletedAt = new Map<string, number>();

const DEDUPE_WINDOW_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

export interface QueueGuardResult<T> {
  ran: boolean;
  deduped: boolean;
  retries: number;
  result: T | null;
  error: string | null;
}

/**
 * Run `fn` for `campaignId` under the per-campaign lock + dedupe window
 * with bounded retry. Never throws — failure is isolated into the result.
 */
export async function withGenerationGuard<T>(
  campaignId: string,
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; dedupeWindowMs?: number },
): Promise<QueueGuardResult<T>> {
  const now = Date.now();
  const dedupeWindow = opts?.dedupeWindowMs ?? DEDUPE_WINDOW_MS;

  // Join an in-flight run for the same campaign (lock + dedupe).
  const existing = inflight.get(campaignId) as InFlight<QueueGuardResult<T>> | undefined;
  if (existing) {
    aiAssetGenerationDiagnostics.queue({
      campaign_id: campaignId, queue_state: 'deduped_inflight',
      age_ms: now - existing.startedAt,
    });
    try {
      const joined = await existing.promise;
      return { ...joined, deduped: true };
    } catch {
      return { ran: false, deduped: true, retries: 0, result: null, error: 'joined_run_failed' };
    }
  }

  // Short-window dedupe after a recent completion.
  const last = lastCompletedAt.get(campaignId);
  if (last != null && now - last < dedupeWindow) {
    aiAssetGenerationDiagnostics.queue({
      campaign_id: campaignId, queue_state: 'deduped_window',
      since_last_ms: now - last,
    });
    return { ran: false, deduped: true, retries: 0, result: null, error: null };
  }

  const maxRetries = Math.max(0, opts?.maxRetries ?? DEFAULT_MAX_RETRIES);

  const exec = (async (): Promise<QueueGuardResult<T>> => {
    let retries = 0;
    let lastErr: string | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        aiAssetGenerationDiagnostics.queue({
          campaign_id: campaignId, queue_state: 'running', retry_count: attempt,
        });
        const result = await fn();
        return { ran: true, deduped: false, retries: attempt, result, error: null };
      } catch (e) {
        retries = attempt;
        lastErr = e instanceof Error ? e.message : String(e);
        aiAssetGenerationDiagnostics.queue({
          campaign_id: campaignId, queue_state: 'retry', retry_count: attempt,
          failure_reason: lastErr,
        });
      }
    }
    // Failure isolation: rollback continuity — caller keeps prior state.
    return { ran: true, deduped: false, retries, result: null, error: lastErr };
  })();

  inflight.set(campaignId, { promise: exec, startedAt: now });
  try {
    return await exec;
  } finally {
    inflight.delete(campaignId);
    lastCompletedAt.set(campaignId, Date.now());
  }
}

/** Test/operational hook — clear all process-local guard state. */
export function __resetGenerationGuard(): void {
  inflight.clear();
  lastCompletedAt.clear();
}
