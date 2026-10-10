/**
 * Scheduler cycle gate — the lifecycle around ONE scheduler cycle.
 *
 * backend/scheduler/cron.ts used to run a cycle as
 *
 *     if (!(await cronGuard.tryAcquireLock(id))) return;
 *     …cycle body…
 *     void cronGuard.releaseLock(id);
 *
 * which left three restart-sensitive gaps:
 *
 *   1. A cycle that THREW never released the lock (the release was the last
 *      statement, not a `finally`); the next instance waited out the 90 s TTL.
 *   2. Nothing knew a cycle was in flight, so shutdown could not wait for it:
 *      the host's process.exit cut a running cycle off part-way.
 *   3. Nothing stopped a NEW cycle from starting once shutdown had begun (the
 *      boot cycle, or a base tick that fired during the drain), and nothing
 *      stopped the same process overlapping itself once the lock TTL lapsed
 *      under a long cycle.
 *
 * This gate closes all three without changing WHAT a cycle does or WHEN the
 * scheduler wants to run one:
 *
 *   • run() refuses to start once stop() has been called, and refuses to start
 *     while this process already has a cycle in flight;
 *   • the lock is released in a `finally` — only when it was acquired — and a
 *     release failure is reported, never thrown (the TTL is the fallback);
 *   • an acquisition that THROWS (CronGuard's own policy never throws; this is
 *     the unexpected case) skips the cycle and says so. The deliberate
 *     fail-open/fail-closed decision for an UNAVAILABLE lock stays inside
 *     CronGuard (CRON_LOCK_FAIL_CLOSED), unchanged;
 *   • stop(boundMs) waits for the in-flight cycle up to a bound and reports
 *     whether it finished. A cycle that is still running when the bound
 *     elapses is NOT cancelled — there is no safe way to abort it mid-write —
 *     it is reported, and the host's exit ends it.
 *
 * Pure: no Redis, no timers beyond the stop() bound, no process globals.
 */

export type CycleRunResult =
  | 'ran'
  | 'skipped_stopping'
  | 'skipped_in_flight'
  | 'skipped_lock_held'
  | 'skipped_lock_error';

export type CycleStopResult = 'idle' | 'drained' | 'timeout';

/**
 * How long a STANDALONE scheduler (cron.ts run directly, or the Next.js
 * embedding) waits for its in-flight cycle on SIGTERM. A host with its own
 * drain (backend/workers/main.ts) passes its drain deadline instead.
 */
export const DEFAULT_CYCLE_STOP_BOUND_MS = 15_000;

export interface CycleGateDeps {
  /** true = lock held by this instance (or CronGuard's fail-open policy said run). */
  acquire: () => Promise<boolean>;
  release: () => Promise<void>;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

export interface CycleGate {
  run(body: () => Promise<void>): Promise<CycleRunResult>;
  stop(boundMs: number): Promise<CycleStopResult>;
  isStopping(): boolean;
  isCycleInFlight(): boolean;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createCycleGate(deps: CycleGateDeps): CycleGate {
  const log = deps.log ?? ((event: string, detail?: Record<string, unknown>) => {
    console.warn(`[cron-cycle-gate] ${event}`, detail ?? {});
  });
  let stopping = false;
  let inFlight: Promise<void> | null = null;

  async function run(body: () => Promise<void>): Promise<CycleRunResult> {
    if (stopping) {
      log('cycle_skipped_stopping');
      return 'skipped_stopping';
    }
    if (inFlight) {
      log('cycle_skipped_in_flight');
      return 'skipped_in_flight';
    }

    let release: (() => void) | null = null;
    // Claimed synchronously, BEFORE the first await, so two callers in the same
    // tick cannot both pass the in-flight check.
    inFlight = new Promise<void>((resolve) => { release = resolve; });
    try {
      let acquired: boolean;
      try {
        acquired = await deps.acquire();
      } catch (err) {
        log('cycle_skipped_lock_error', { error: message(err) });
        return 'skipped_lock_error';
      }
      if (!acquired) return 'skipped_lock_held';
      // Shutdown may have begun while we waited for the lock: do not start.
      if (stopping) {
        await releaseQuietly();
        log('cycle_skipped_stopping');
        return 'skipped_stopping';
      }
      try {
        await body();
        return 'ran';
      } finally {
        await releaseQuietly();
      }
    } finally {
      inFlight = null;
      if (release) (release as () => void)();
    }
  }

  async function releaseQuietly(): Promise<void> {
    try {
      await deps.release();
    } catch (err) {
      log('cycle_lock_release_failed', { error: message(err), fallback: 'lock expires via TTL' });
    }
  }

  async function stop(boundMs: number): Promise<CycleStopResult> {
    stopping = true;
    const current = inFlight;
    if (!current) return 'idle';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bound = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), boundMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    const outcome = await Promise.race([current.then(() => 'drained' as const), bound]);
    if (timer) clearTimeout(timer);
    if (outcome === 'timeout') log('cycle_still_running_at_stop_bound', { boundMs });
    return outcome;
  }

  return {
    run,
    stop,
    isStopping: () => stopping,
    isCycleInFlight: () => inFlight !== null,
  };
}
