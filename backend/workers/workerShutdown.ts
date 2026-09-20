/**
 * WS-1 (STEP 3AH-132) — the worker process's bounded shutdown primitives.
 *
 * Pure and dependency-free: no Redis, no BullMQ, no process globals beyond the
 * `exit` a caller hands in. The bootstraps (backend/workers/main.ts, and the
 * dev bootstrap backend/queue/startWorkers.ts) own WHICH consumers exist; this
 * module owns HOW they are closed and what is reported.
 *
 * The contract, unchanged from the inline implementation it replaces:
 *   • WORKER_DRAIN_TIMEOUT_MS, valid range 1000–120000 ms, default 15 000.
 *   • `close()` waits for in-flight jobs, which is right — but a BOLT run takes
 *     minutes and no container grace period is that long, so an unbounded wait
 *     guarantees a SIGKILL mid-await and the post-drain steps (BOLT claim
 *     release, producer-queue close, connection close) never run. Capping the
 *     wait trades "finish the job" (unachievable) for "record that the job was
 *     interrupted" (achievable).
 *
 * What is NEW: the outcome is honest. A deadline that elapsed, or a consumer
 * whose close() rejected, is reported by NAME and never logged as a clean
 * shutdown — the previous `Promise.race([deadline, allSettled([...])])` threw
 * that information away, so a hung consumer looked exactly like a clean drain.
 */

export interface ShutdownConsumer {
  /** Queue name — what appears in the pending/failed report. */
  name: string;
  close: () => Promise<unknown>;
}

export interface DrainOutcome {
  /** True only when EVERY consumer closed successfully before the deadline. */
  drained: boolean;
  /** Consumers that closed cleanly. */
  closed: string[];
  /** Consumers still closing when the deadline elapsed. */
  pending: string[];
  /** Consumers whose close() rejected. */
  failed: string[];
}

export const DEFAULT_DRAIN_TIMEOUT_MS = 15_000;
/**
 * Head-room between the drain deadline and the SEC-C6 hard-exit backstop, for
 * the post-drain steps. Named here so the 25 s total (15 000 + 10 000) has ONE
 * definition; backend/workers/main.ts spells the sum literally because the
 * SEC-C6 lock test pins that expression.
 */
export const HARD_EXIT_GRACE_MS = 10_000;
/**
 * Cap for ONE post-drain teardown step (BOLT claim release, producer-queue
 * close, connection close). Each is a teardown, not a job drain.
 *
 * The three of them must fit inside HARD_EXIT_GRACE_MS: 3 × 3 000 = 9 000 ms,
 * so the worst-case shutdown is drainDeadline + 9 s and finishes ~1 s BEFORE
 * the backstop fires. That is what makes the backstop a backstop rather than
 * the normal exit path — with the 5 s cap the earlier WS-1 candidate used, two
 * hung steps alone would have consumed the whole grace window.
 * postDrainBudgetMs() asserts the relationship; a test pins it.
 */
export const POST_DRAIN_STEP_TIMEOUT_MS = 3_000;
/** How long the post-drain phase can take in the worst case. */
export function postDrainBudgetMs(steps = 3): number {
  return steps * POST_DRAIN_STEP_TIMEOUT_MS;
}

/** WORKER_DRAIN_TIMEOUT_MS when valid (1000–120000), else 15000 — unchanged. */
export function resolveDrainDeadlineMs(raw: string | undefined): number {
  const o = Number(raw);
  return Number.isFinite(o) && o >= 1000 && o <= 120_000 ? o : DEFAULT_DRAIN_TIMEOUT_MS;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolves after `ms`, unref'd so it never holds the process open. */
function deadlineAfter(ms: number): { promise: Promise<'deadline'>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return { promise, cancel: () => { if (timer) clearTimeout(timer); } };
}

/**
 * Close every consumer concurrently under ONE deadline, and report by name.
 * Never rejects: a consumer that throws synchronously or rejects is recorded,
 * not propagated — one bad handle must not skip the rest of the shutdown.
 */
export async function drainConsumers(
  consumers: ShutdownConsumer[],
  drainDeadlineMs: number,
): Promise<DrainOutcome> {
  const open = new Set(consumers.map((_, i) => i));
  const closed: string[] = [];
  const failed: string[] = [];

  const closes = consumers.map((consumer, i) =>
    Promise.resolve()
      .then(() => consumer.close())
      .then(
        () => { open.delete(i); closed.push(consumer.name); },
        (err) => {
          open.delete(i);
          failed.push(consumer.name);
          console.warn(`[worker-shutdown] consumer close failed: ${consumer.name}`, errorMessage(err));
        },
      ));

  const deadline = deadlineAfter(drainDeadlineMs);
  const winner = await Promise.race([
    deadline.promise,
    Promise.all(closes).then(() => 'drained' as const),
  ]);
  deadline.cancel();

  const pending = [...open].map((i) => consumers[i].name);
  if (winner === 'deadline') {
    console.warn(
      `[worker-shutdown] drain deadline (${drainDeadlineMs}ms) elapsed — ${pending.length} consumer(s) still closing`,
      { pending },
    );
  }

  return { drained: winner === 'drained' && failed.length === 0, closed, pending, failed };
}

/**
 * Run one post-drain teardown step under its own cap. The BOLT-claim release
 * and the producer-queue close both talk to Redis/Postgres and can hang when
 * the backend is already gone; without a cap they push the process onto the
 * hard-exit backstop (or, before that backstop existed, onto SIGKILL).
 */
export async function closeWithin(
  label: string,
  timeoutMs: number,
  run: () => Promise<unknown>,
): Promise<'closed' | 'timeout' | 'failed'> {
  const bound = deadlineAfter(timeoutMs);
  try {
    const result = await Promise.race([
      Promise.resolve().then(run).then(() => 'closed' as const),
      bound.promise,
    ]);
    if (result === 'deadline') {
      console.warn(`[worker-shutdown] ${label} did not finish within ${timeoutMs}ms`);
      return 'timeout';
    }
    return 'closed';
  } catch (err) {
    console.error(`[worker-shutdown] ${label} failed:`, errorMessage(err));
    return 'failed';
  } finally {
    bound.cancel();
  }
}

/**
 * Second-signal idempotence. Railway sends SIGTERM and, if the process is still
 * alive, can follow with more; an ordinary async handler would start a second
 * shutdown that closes already-closing handles and races the first to exit.
 * Every later signal joins the in-flight shutdown instead.
 */
export function once<T>(run: (signal: string) => Promise<T>): (signal: string) => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return (signal: string) => {
    if (inFlight) {
      console.info(`[worker-shutdown] ${signal} received while already shutting down — ignored`);
      return inFlight;
    }
    inFlight = run(signal);
    return inFlight;
  };
}
