/**
 * Heartbeat substage emitter.
 *
 * Each long-running planner phase (drafting, alignment, repair) wraps its
 * work with `withPhaseHeartbeat(...)` which fires `onSubStage('still-…')`
 * every `intervalMs` (default 15s) while the work is in progress. The
 * heartbeat stops as soon as the wrapped work resolves or rejects.
 *
 * Properties:
 *   - No spam: at most one heartbeat per interval, gated by a single
 *     `setInterval` per call.
 *   - Clean teardown: `clearInterval` runs in `finally`, so a thrown work
 *     promise still releases the timer.
 *   - Survives retries: the wrapped function may itself retry — heartbeat
 *     keeps firing for as long as the wrapper is pending.
 *   - Observable: the substage emitter is a free-form callback so the same
 *     mechanism feeds both `bolt_execution_runs.current_stage` updates and
 *     structured logs.
 *   - Cancellable: when `signal.aborted`, no further heartbeats are emitted
 *     even before the work resolves.
 */

export interface PhaseHeartbeatOptions {
  /** Substage to emit on every tick (e.g. `'still-drafting'`). */
  substage: string;
  /** Callback used by the orchestrator to surface progress to the UI. */
  onSubStage?: (substage: string) => void;
  /** Heartbeat interval. Defaults to 15s. Minimum 1s. */
  intervalMs?: number;
  /** Abort signal — when fired, no further heartbeats are emitted. */
  signal?: AbortSignal;
}

/**
 * Wraps a phase promise with a heartbeat. The wrapped phase function is
 * invoked synchronously and its returned promise is awaited; the heartbeat
 * timer is started before the await and torn down in `finally`.
 */
export async function withPhaseHeartbeat<T>(
  phase: () => Promise<T>,
  opts: PhaseHeartbeatOptions,
): Promise<T> {
  const intervalMs = Math.max(1000, opts.intervalMs ?? 15_000);
  let timer: ReturnType<typeof setInterval> | null = null;
  let tickCount = 0;
  const tick = (): void => {
    if (opts.signal?.aborted) return;
    tickCount++;
    try { opts.onSubStage?.(opts.substage); } catch { /* observer errors are swallowed */ }
  };
  try {
    timer = setInterval(tick, intervalMs);
    return await phase();
  } finally {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    // Surface tick count for tests / forensics via a side-effect free read.
    (withPhaseHeartbeat as any).__lastTickCount = tickCount;
  }
}
