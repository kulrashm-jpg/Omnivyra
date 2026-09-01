/**
 * PHASE 168 — BOLT execution recovery state machine.
 *
 * These tests exercise the ACTUAL guarded UPDATE semantics, not just the
 * helpers' return values. The fake below evaluates every filter the production
 * code applies (`.eq`, `.in`, `.is`, `.or`) against the PRE-update rows, exactly
 * as Postgres does, and returns the rows the statement genuinely changed. A
 * guard that is written but not enforced therefore fails here.
 *
 * The invariant under test:
 *   NO execution may remain `running` once its worker has ceased ownership,
 *   and NO execution may be reconciled while a live worker still owns it.
 */

type Row = Record<string, unknown>;

const rows: Row[] = [];
const capturedUpdates: Array<{ patch: Row; affected: number }> = [];
let forcedError: { message: string } | null = null;

/** Parse the `.or()` forms this codebase uses: `col.is.null` / `col.lt.<iso>`. */
function orMatches(row: Row, expr: string): boolean {
  return expr.split(',').some((clause) => {
    const [col, op, ...rest] = clause.split('.');
    const value = rest.join('.');
    const cell = row[col];
    if (op === 'is' && value === 'null') return cell === null || cell === undefined;
    if (op === 'lt') return cell != null && String(cell) < value;
    return false;
  });
}

function makeBuilder() {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  const isNulls: string[] = [];
  const ors: string[] = [];
  let patch: Row | null = null;

  const matches = (row: Row): boolean =>
    eqs.every(([c, v]) => row[c] === v) &&
    ins.every(([c, vs]) => vs.includes(row[c] as never)) &&
    isNulls.every((c) => row[c] === null || row[c] === undefined) &&
    ors.every((o) => orMatches(row, o));

  const b: Record<string, (...a: any[]) => any> = {
    update: (v: Row) => { patch = v; return b; },
    eq: (c: string, v: unknown) => { eqs.push([c, v]); return b; },
    in: (c: string, v: unknown[]) => { ins.push([c, v]); return b; },
    is: (c: string, v: unknown) => { if (v === null) isNulls.push(c); return b; },
    or: (e: string) => { ors.push(e); return b; },
    select: () => {
      if (forcedError) return Promise.resolve({ data: null, error: forcedError });
      // Postgres evaluates WHERE against pre-update rows and returns exactly
      // those as the affected set.
      const targets = rows.filter(matches);
      if (patch) {
        for (const r of targets) Object.assign(r, patch);
        capturedUpdates.push({ patch, affected: targets.length });
      }
      return Promise.resolve({ data: targets.map((r) => ({ id: r.id })), error: null });
    },
  };
  return b;
}

jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn(() => makeBuilder()) }));

import {
  reconcileAbandonedBoltRun,
  releaseBoltRunClaimOnShutdown,
  isTerminalBoltJobFailure,
  boltRunIdFromJob,
  attachBoltRunReconciliation,
  BOLT_STALLED_INTERVAL_MS,
} from '../../services/boltExecutionRecovery';

const PAST = new Date(Date.now() - 10 * 60_000).toISOString();
const FUTURE = new Date(Date.now() + 10 * 60_000).toISOString();

function seed(overrides: Row = {}): Row {
  const row: Row = {
    id: 'run-1',
    status: 'running',
    lock_owner: 'token-a',
    lock_expires_at: PAST,
    abandonment_detected_at: null,
    abandonment_reason: null,
    error_message: null,
    raw_error_message: null,
    failed_stage: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

beforeEach(() => {
  rows.length = 0;
  capturedUpdates.length = 0;
  forcedError = null;
});

describe('A. stale execution is discovered and terminated', () => {
  test('a running run whose lock expired is transitioned to failed', async () => {
    const row = seed();
    const result = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(result).toEqual({ ok: true, reconciled: 1 });
    expect(row.status).toBe('failed');
    expect(row.abandonment_reason).toBe('worker_job_failed_terminal');
    expect(row.abandonment_detected_at).not.toBeNull();
  });

  test('a run still owned by a LIVE worker is never touched', async () => {
    const row = seed({ lock_expires_at: FUTURE });
    const result = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(result).toEqual({ ok: true, reconciled: 0 });
    expect(row.status).toBe('running');
  });

  test('a run with no lock at all is reclaimable', async () => {
    seed({ lock_owner: null, lock_expires_at: null });
    expect(await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal'))
      .toEqual({ ok: true, reconciled: 1 });
  });
});

describe('B. terminal states and other runs are protected', () => {
  test.each(['completed', 'failed', 'cancelled'])('a %s run is not re-reconciled', async (status) => {
    const row = seed({ status });
    const result = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(result).toEqual({ ok: true, reconciled: 0 });
    expect(row.status).toBe(status);
  });

  test('only the addressed run is affected', async () => {
    seed({ id: 'run-1' });
    const other = seed({ id: 'run-2' });
    await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(other.status).toBe('running');
  });

  test('the forensic contract holds — error_message/failed_stage untouched', async () => {
    const row = seed({ error_message: 'real cause', failed_stage: 'ai/plan' });
    await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(row.error_message).toBe('real cause');
    expect(row.failed_stage).toBe('ai/plan');
    expect(row.abandonment_reason).toBe('worker_job_failed_terminal');
    for (const u of capturedUpdates) {
      expect(Object.keys(u.patch)).not.toContain('error_message');
      expect(Object.keys(u.patch)).not.toContain('raw_error_message');
      expect(Object.keys(u.patch)).not.toContain('failed_stage');
    }
  });
});

describe('C. recovery is idempotent', () => {
  test('a second sweep of the same run reconciles zero rows', async () => {
    seed();
    const first = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    const second = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(first).toEqual({ ok: true, reconciled: 1 });
    expect(second).toEqual({ ok: true, reconciled: 0 });
  });

  test('an already-abandoned run is not restamped even if its status reads running', async () => {
    // Defence in depth, and NOT covered by the status predicate: this is the
    // one state where the two guards diverge. A row carrying an abandonment
    // stamp while still reading `running` must keep its ORIGINAL forensic
    // record — the first detection is the true one, and overwriting it would
    // destroy when the platform actually lost the run.
    const row = seed({
      status: 'running',
      abandonment_detected_at: '2026-01-01T00:00:00.000Z',
      abandonment_reason: 'cron_stale_execution_sweep',
    });
    const result = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(result).toEqual({ ok: true, reconciled: 0 });
    expect(row.abandonment_detected_at).toBe('2026-01-01T00:00:00.000Z');
    expect(row.abandonment_reason).toBe('cron_stale_execution_sweep');
  });

  test('the original abandonment timestamp is not restamped', async () => {
    const row = seed();
    await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    const stampedAt = row.abandonment_detected_at;
    await reconcileAbandonedBoltRun('run-1', 'worker_shutdown_interrupted');
    expect(row.abandonment_detected_at).toBe(stampedAt);
    expect(row.abandonment_reason).toBe('worker_job_failed_terminal');
  });
});

describe('D. database errors are surfaced, never read as "nothing to do"', () => {
  test('a failed UPDATE returns ok:false with the message', async () => {
    seed();
    forcedError = { message: 'connection reset' };
    const result = await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(result).toEqual({ ok: false, error: 'connection reset' });
  });

  test('a failed release returns ok:false', async () => {
    seed();
    forcedError = { message: 'timeout' };
    expect(await releaseBoltRunClaimOnShutdown('run-1', 'token-a'))
      .toEqual({ ok: false, error: 'timeout' });
  });

  test('a missing runId is rejected rather than sweeping everything', async () => {
    seed();
    const result = await reconcileAbandonedBoltRun('', 'worker_job_failed_terminal');
    expect(result.ok).toBe(false);
    expect(rows[0].status).toBe('running');
  });
});

describe('E. retry semantics are preserved — only terminal failures reconcile', () => {
  test('a retryable failure (attempts remain) is NOT terminal', () => {
    expect(isTerminalBoltJobFailure(
      { data: { run_id: 'r' }, attemptsMade: 1, opts: { attempts: 3 } },
      new Error('boom'),
    )).toBe(false);
  });

  test('the final attempt IS terminal', () => {
    expect(isTerminalBoltJobFailure(
      { data: { run_id: 'r' }, attemptsMade: 3, opts: { attempts: 3 } },
      new Error('boom'),
    )).toBe(true);
  });

  test('a stalled-limit failure is terminal regardless of attempts', () => {
    expect(isTerminalBoltJobFailure(
      { data: { run_id: 'r' }, attemptsMade: 0, opts: { attempts: 5 } },
      new Error('job stalled more than allowable limit'),
    )).toBe(true);
  });

  test('default attempts of 1 makes the first failure terminal', () => {
    expect(isTerminalBoltJobFailure({ data: { run_id: 'r' }, attemptsMade: 1 }, new Error('x'))).toBe(true);
  });

  test('run id is extracted only when present and well-formed', () => {
    expect(boltRunIdFromJob({ data: { run_id: 'run-9' } })).toBe('run-9');
    expect(boltRunIdFromJob({ data: { run_id: 42 } })).toBeNull();
    expect(boltRunIdFromJob(null)).toBeNull();
  });
});

describe('F. worker wiring reconciles exactly once, on terminal failure only', () => {
  function fakeWorker() {
    const listeners: Array<(job: unknown, err: Error) => void> = [];
    return {
      on: (_e: 'failed', cb: (job: unknown, err: Error) => void) => { listeners.push(cb); },
      emitFailed: (job: unknown, err: Error) => listeners.forEach((l) => l(job, err)),
    };
  }

  test('a retryable failure leaves the run running for the retry', async () => {
    const row = seed();
    const w = fakeWorker();
    attachBoltRunReconciliation(w as never);
    w.emitFailed({ data: { run_id: 'run-1' }, attemptsMade: 1, opts: { attempts: 3 } }, new Error('transient'));
    await new Promise((r) => setImmediate(r));
    expect(row.status).toBe('running');
  });

  test('a terminal failure transitions the run', async () => {
    const row = seed();
    const w = fakeWorker();
    attachBoltRunReconciliation(w as never);
    w.emitFailed({ data: { run_id: 'run-1' }, attemptsMade: 1, opts: { attempts: 1 } }, new Error('dead'));
    await new Promise((r) => setImmediate(r));
    expect(row.status).toBe('failed');
    expect(row.abandonment_reason).toBe('worker_job_failed_terminal');
  });

  test('a failure carrying no run id is ignored without throwing', async () => {
    const w = fakeWorker();
    attachBoltRunReconciliation(w as never);
    expect(() => w.emitFailed({ attemptsMade: 1, opts: { attempts: 1 } }, new Error('x'))).not.toThrow();
  });
});

describe('G. shutdown releases only claims this process owns', () => {
  test('a claim held by this process is released without declaring failure', async () => {
    const row = seed({ lock_expires_at: FUTURE });
    const result = await releaseBoltRunClaimOnShutdown('run-1', 'token-a');
    expect(result).toEqual({ ok: true, reconciled: 1 });
    expect(row.lock_owner).toBeNull();
    expect(row.lock_expires_at).toBeNull();
    // Status untouched so a BullMQ retry can still resume the run.
    expect(row.status).toBe('running');
  });

  test('a claim taken over by ANOTHER worker is left alone', async () => {
    const row = seed({ lock_owner: 'token-successor', lock_expires_at: FUTURE });
    const result = await releaseBoltRunClaimOnShutdown('run-1', 'token-a');
    expect(result).toEqual({ ok: true, reconciled: 0 });
    expect(row.lock_owner).toBe('token-successor');
  });

  test('a terminal run is not resurrected by a late shutdown release', async () => {
    const row = seed({ status: 'completed' });
    expect(await releaseBoltRunClaimOnShutdown('run-1', 'token-a'))
      .toEqual({ ok: true, reconciled: 0 });
    expect(row.status).toBe('completed');
  });
});

describe('H. only columns that actually exist are written', () => {
  // Verified against production on 2026-09-01. PostgREST rejects the WHOLE
  // statement on an unknown column, so a single phantom name silently converts
  // recovery into a no-op — the exact failure mode of Phases 160/161.
  const DEPLOYED_COLUMNS = new Set([
    'id', 'company_id', 'campaign_id', 'user_id', 'current_stage', 'status',
    'progress_percentage', 'payload', 'result_campaign_id', 'target_campaign_id',
    'error_message', 'weeks_generated', 'daily_slots_created', 'scheduled_posts_created',
    'created_at', 'updated_at', 'themes_generated', 'weekly_plan_items',
    'content_variants_generated', 'expected_content_items', 'actual_posts_published',
    'engagement_score', 'conversion_score', 'ai_calls_total', 'ai_tokens_input',
    'ai_tokens_output', 'distribution_batches', 'variant_batches', 'ai_cost_usd',
    'blueprint_cache_hits', 'blueprint_cache_misses', 'cache_hit_ratio',
    'stage_campaign_plan_cost', 'stage_distribution_cost', 'stage_blueprint_cost',
    'stage_variant_cost', 'strategy_learning_applied', 'strategy_learning_confidence',
    'strategy_profile_cache_hits', 'strategy_profile_cache_misses', 'content_jobs_total',
    'content_jobs_done', 'content_jobs_failed', 'posts_scheduled', 'posts_skipped',
    'raw_error_message', 'error_stack', 'failed_stage', 'failed_after_ms', 'lock_owner',
    'lock_acquired_at', 'lock_expires_at', 'cancel_requested', 'cancel_requested_at',
    'cancel_requested_by', 'heartbeat_at', 'abandonment_reason', 'abandonment_detected_at',
  ]);

  test('reconciliation writes no phantom column', async () => {
    seed();
    await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    expect(capturedUpdates.length).toBeGreaterThan(0);
    for (const u of capturedUpdates) {
      for (const key of Object.keys(u.patch)) expect(DEPLOYED_COLUMNS.has(key)).toBe(true);
    }
  });

  test('shutdown release writes no phantom column', async () => {
    seed({ lock_expires_at: FUTURE });
    await releaseBoltRunClaimOnShutdown('run-1', 'token-a');
    expect(capturedUpdates.length).toBeGreaterThan(0);
    for (const u of capturedUpdates) {
      for (const key of Object.keys(u.patch)) expect(DEPLOYED_COLUMNS.has(key)).toBe(true);
    }
  });

  test('completed_at is specifically NOT written — it does not exist on this table', async () => {
    seed();
    await reconcileAbandonedBoltRun('run-1', 'worker_job_failed_terminal');
    for (const u of capturedUpdates) expect(Object.keys(u.patch)).not.toContain('completed_at');
  });
});

describe('I. queue cadence', () => {
  test('bolt stalled interval is aligned with the 2-minute lock refresh window', () => {
    expect(BOLT_STALLED_INTERVAL_MS).toBe(120_000);
    // Must be far below the 30-minute global default it overrides.
    expect(BOLT_STALLED_INTERVAL_MS).toBeLessThan(1_800_000);
  });
});
