/**
 * WS-1 (STEP 3AH-132) — the bounded shutdown primitives.
 *
 * Unit-level, no Redis and no BullMQ: this pins the DRAIN CONTRACT that used to
 * be an inline `Promise.race([deadline, Promise.allSettled([...])])` in
 * backend/workers/main.ts, where the outcome was thrown away — a consumer that
 * hung and a clean drain produced the same "[main] shutdown complete" line.
 */
import {
  DEFAULT_DRAIN_TIMEOUT_MS,
  POST_DRAIN_STEP_TIMEOUT_MS,
  HARD_EXIT_GRACE_MS,
  closeWithin,
  drainConsumers,
  once,
  postDrainBudgetMs,
  resolveDrainDeadlineMs,
  type ShutdownConsumer,
} from '../../workers/workerShutdown';

const never = (): Promise<never> => new Promise<never>(() => { /* hangs for the whole test */ });
const consumer = (name: string, close: () => Promise<unknown>): ShutdownConsumer => ({ name, close });

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('resolveDrainDeadlineMs — the WORKER_DRAIN_TIMEOUT_MS contract is unchanged', () => {
  it('defaults to 15 000 ms', () => {
    expect(resolveDrainDeadlineMs(undefined)).toBe(15_000);
    expect(DEFAULT_DRAIN_TIMEOUT_MS).toBe(15_000);
  });

  it.each([['', 15_000], ['abc', 15_000], ['0', 15_000], ['999', 15_000], ['120001', 15_000],
    ['-5000', 15_000], ['1000', 1000], ['15000', 15_000], ['120000', 120_000], ['30000', 30_000]])(
    'WORKER_DRAIN_TIMEOUT_MS=%s → %s ms', (raw, expected) => {
      expect(resolveDrainDeadlineMs(raw as string)).toBe(expected);
    },
  );

  it('the hard-exit backstop stays 10 s beyond the drain deadline (25 s at the default)', () => {
    expect(HARD_EXIT_GRACE_MS).toBe(10_000);
    expect(resolveDrainDeadlineMs(undefined) + HARD_EXIT_GRACE_MS).toBe(25_000);
  });

  // INVARIANT 7 — shutdown completes BEFORE the hard-exit backstop, by
  // construction rather than by luck: worst case is the drain deadline plus
  // three capped post-drain steps, which must leave head-room in the grace.
  it('the three post-drain steps fit inside the hard-exit grace, with margin', () => {
    expect(POST_DRAIN_STEP_TIMEOUT_MS).toBe(3_000);
    expect(postDrainBudgetMs()).toBe(9_000);
    expect(postDrainBudgetMs()).toBeLessThan(HARD_EXIT_GRACE_MS);
    // Worst case at the highest permitted drain deadline is still bounded.
    const worstCase = resolveDrainDeadlineMs('120000') + postDrainBudgetMs();
    expect(worstCase).toBeLessThan(resolveDrainDeadlineMs('120000') + HARD_EXIT_GRACE_MS);
  });
});

describe('drainConsumers', () => {
  it('closes EVERY consumer and reports a clean drain', async () => {
    const closed: string[] = [];
    const consumers = ['a', 'b', 'c'].map((n) => consumer(n, async () => { closed.push(n); }));
    const outcome = await drainConsumers(consumers, 5_000);
    expect(closed.sort()).toEqual(['a', 'b', 'c']);
    expect(outcome).toEqual({ drained: true, closed: expect.arrayContaining(['a', 'b', 'c']), pending: [], failed: [] });
  });

  it('closes them CONCURRENTLY — one slow consumer does not serialise the rest', async () => {
    let resolveSlow: () => void = () => {};
    const started: string[] = [];
    const consumers = [
      consumer('slow', () => { started.push('slow'); return new Promise<void>((r) => { resolveSlow = r; }); }),
      consumer('fast', async () => { started.push('fast'); }),
    ];
    const drain = drainConsumers(consumers, 5_000);
    await Promise.resolve();
    expect(started).toEqual(['slow', 'fast']); // both close() calls issued before either settled
    resolveSlow();
    await expect(drain).resolves.toMatchObject({ drained: true });
  });

  it('returns at the deadline and names the consumers still closing', async () => {
    const outcome = await drainConsumers(
      [consumer('fast', async () => undefined), consumer('hung', never), consumer('also-hung', never)],
      25,
    );
    expect(outcome.drained).toBe(false);
    expect(outcome.closed).toEqual(['fast']);
    expect(outcome.pending.sort()).toEqual(['also-hung', 'hung']);
    expect(outcome.failed).toEqual([]);
  });

  it('a rejecting consumer is reported by name and never stops the others', async () => {
    const closed: string[] = [];
    const outcome = await drainConsumers([
      consumer('ok-1', async () => { closed.push('ok-1'); }),
      consumer('broken', async () => { throw new Error('connection gone'); }),
      consumer('ok-2', async () => { closed.push('ok-2'); }),
    ], 5_000);
    expect(closed.sort()).toEqual(['ok-1', 'ok-2']);
    expect(outcome.failed).toEqual(['broken']);
    expect(outcome.pending).toEqual([]);
    expect(outcome.drained).toBe(false); // a failed close is NOT a clean drain
  });

  it('a close() that throws synchronously is caught, not propagated', async () => {
    const outcome = await drainConsumers([
      consumer('sync-throw', (() => { throw new Error('boom'); }) as unknown as () => Promise<unknown>),
      consumer('ok', async () => undefined),
    ], 5_000);
    expect(outcome.failed).toEqual(['sync-throw']);
    expect(outcome.closed).toEqual(['ok']);
  });

  it('an empty consumer set drains immediately', async () => {
    await expect(drainConsumers([], 5_000)).resolves.toEqual({ drained: true, closed: [], pending: [], failed: [] });
  });
});

describe('closeWithin — bounded post-drain steps', () => {
  it('reports "closed" for a step that finishes', async () => {
    await expect(closeWithin('step', 1_000, async () => undefined)).resolves.toBe('closed');
  });

  it('gives up on a hanging step instead of riding the hard-exit backstop', async () => {
    await expect(closeWithin('hanging step', 25, never)).resolves.toBe('timeout');
  });

  it('reports "failed" for a rejecting step and never throws', async () => {
    await expect(closeWithin('bad step', 1_000, async () => { throw new Error('nope'); })).resolves.toBe('failed');
  });

  it('each post-drain step gets the same 3 s teardown cap', () => {
    expect(POST_DRAIN_STEP_TIMEOUT_MS).toBe(3_000);
  });
});

describe('once — SIGTERM/SIGINT determinism', () => {
  it('runs the shutdown exactly once; later signals join the in-flight one', async () => {
    const runs: string[] = [];
    let release: () => void = () => {};
    const guarded = once(async (signal: string) => {
      runs.push(signal);
      await new Promise<void>((r) => { release = r; });
      return signal;
    });

    const first = guarded('SIGTERM');
    const second = guarded('SIGINT');
    const third = guarded('SIGTERM');
    expect(runs).toEqual(['SIGTERM']);
    release();
    await expect(Promise.all([first, second, third])).resolves.toEqual(['SIGTERM', 'SIGTERM', 'SIGTERM']);
    expect(runs).toEqual(['SIGTERM']);
  });

  it('SIGINT and SIGTERM take the SAME path (whichever arrives first wins)', async () => {
    const runs: string[] = [];
    const guarded = once(async (signal: string) => { runs.push(signal); return signal; });
    await guarded('SIGINT');
    await guarded('SIGTERM');
    expect(runs).toEqual(['SIGINT']);
  });
});
