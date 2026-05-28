/**
 * Phase 16 — SupabaseExecutionStore unit tests.
 *
 * Location note: the user spec asked for
 *   tests/orchestration/supabaseExecutionStore.test.ts
 * The repo's jest config (jest.config.js) is rooted at `<rootDir>/backend`,
 * so a file outside backend/ would never be picked up by `npm test`. We
 * placed the file at backend/tests/orchestration/ so it actually runs.
 *
 * All tests use a hand-rolled in-memory mock of the supabase-js query
 * builder so they touch ZERO network and ZERO real database. They cover
 * the contract:
 *   - create (idempotent)
 *   - update (partial, safe)
 *   - markExecutionCompleted / markExecutionFailed
 *   - getExecutionById / getExecutionByThreadId
 *   - listExecutions / listActiveExecutions
 *   - concurrent update safety
 *   - transient failure retry
 *   - malformed payload handling
 *   - unsupported (checkpoint/lease) throws
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseExecutionStore,
  SupabaseExecutionStoreError,
  UnsupportedOperationError,
  type ExecutionStoreTelemetrySink,
} from '../../services/orchestration/persistence/supabaseExecutionStore';
import type { ExecutionRecord } from '../../services/threadRuntime/threadRuntimeTypes';

// ─── Mock supabase-js client ────────────────────────────────────────

interface MockRow {
  execution_id: string;
  runtime_session_id: string;
  thread_id: string;
  company_id: string;
  orchestration_phase: string;
  execution_status: string;
  execution_owner: string | null;
  retry_count: number;
  recovery_state: string;
  started_at: string;
  heartbeat_at: string | null;
  completed_at: string | null;
  failure_reason: string | null;
  replay_checkpoint_id: string | null;
  updated_at?: string;
  metadata_json?: Record<string, unknown> | null;
}

type Filter = { col: string; op: 'eq' | 'in'; value: unknown };

interface QueryState {
  table: string;
  selectCols: string;
  filters: Filter[];
  orderBy?: { col: string; ascending: boolean };
  limitN?: number;
  mode: 'select' | 'update' | 'upsert';
  upsertRow?: MockRow;
  upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean };
  updatePatch?: Record<string, unknown>;
}

interface MockSupabase {
  client: SupabaseClient;
  rows: MockRow[];
  /** Forces the next operation to fail with the given error. */
  failNextWith(err: { code?: string; message: string; status?: number }, times?: number): void;
}

function buildMockSupabase(): MockSupabase {
  const rows: MockRow[] = [];
  let forcedFailures: Array<{ code?: string; message: string; status?: number }> = [];

  function applyFilters(items: MockRow[], state: QueryState): MockRow[] {
    return items.filter((r) =>
      state.filters.every((f) => {
        const v = (r as unknown as Record<string, unknown>)[f.col];
        if (f.op === 'eq') return v === f.value;
        if (f.op === 'in') return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
        return false;
      }),
    );
  }

  function maybeFail(): { code?: string; message: string; status?: number } | null {
    if (forcedFailures.length === 0) return null;
    return forcedFailures.shift()!;
  }

  function buildQuery(initialState: QueryState) {
    const state = { ...initialState };
    const chain: Record<string, unknown> = {
      eq(col: string, value: unknown) { state.filters.push({ col, op: 'eq', value }); return chain; },
      in(col: string, value: unknown[]) { state.filters.push({ col, op: 'in', value }); return chain; },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orderBy = { col, ascending: opts?.ascending !== false };
        return chain;
      },
      limit(n: number) { state.limitN = n; return chain; },
      select(cols: string) {
        // Trailing .select('*') on an update is the standard supabase-js
        // pattern; switch state to a passthrough that resolves to the
        // matching rows.
        state.selectCols = cols ?? '*';
        return chain;
      },
      async maybeSingle() {
        const err = maybeFail();
        if (err) return { data: null, error: err };
        if (state.mode === 'upsert') {
          // upsert already executed below in then() — this branch
          // shouldn't be hit for upserts, but defensively return.
          return { data: null, error: null };
        }
        if (state.mode === 'update') {
          const list = applyFilters(rows, state);
          if (list.length === 0) return { data: null, error: null };
          const target = list[0];
          Object.assign(target, state.updatePatch ?? {});
          return { data: { ...target }, error: null };
        }
        // select path
        const list = applyFilters(rows, state);
        if (state.orderBy) {
          list.sort((a, b) => {
            const av = (a as unknown as Record<string, unknown>)[state.orderBy!.col] as string;
            const bv = (b as unknown as Record<string, unknown>)[state.orderBy!.col] as string;
            if (av === bv) return 0;
            const order = av < bv ? -1 : 1;
            return state.orderBy!.ascending ? order : -order;
          });
        }
        return { data: list[0] ?? null, error: null };
      },
      // thenable so `await query` and `await query.select('*').limit(N)` both work
      then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
        const err = maybeFail();
        if (err) return Promise.resolve({ data: null, error: err }).then(onFulfilled, onRejected);
        if (state.mode === 'upsert') {
          const row = state.upsertRow!;
          const exists = rows.find((r) => r.execution_id === row.execution_id);
          if (exists) {
            if (!(state.upsertOpts?.ignoreDuplicates)) {
              Object.assign(exists, row);
            }
          } else {
            rows.push({ ...row });
          }
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        if (state.mode === 'update') {
          const list = applyFilters(rows, state);
          for (const r of list) Object.assign(r, state.updatePatch ?? {});
          return Promise.resolve({ data: list.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
        }
        // select
        const list = applyFilters(rows, state);
        if (state.orderBy) {
          list.sort((a, b) => {
            const av = (a as unknown as Record<string, unknown>)[state.orderBy!.col] as string;
            const bv = (b as unknown as Record<string, unknown>)[state.orderBy!.col] as string;
            if (av === bv) return 0;
            const order = av < bv ? -1 : 1;
            return state.orderBy!.ascending ? order : -order;
          });
        }
        const capped = state.limitN ? list.slice(0, state.limitN) : list;
        return Promise.resolve({ data: capped.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select(cols: string) {
          return buildQuery({ table, selectCols: cols, filters: [], mode: 'select' });
        },
        update(patch: Record<string, unknown>) {
          return buildQuery({ table, selectCols: '*', filters: [], mode: 'update', updatePatch: patch });
        },
        upsert(row: MockRow, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          return buildQuery({ table, selectCols: '*', filters: [], mode: 'upsert', upsertRow: row, upsertOpts: opts });
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client,
    rows,
    failNextWith(err, times = 1) {
      for (let i = 0; i < times; i += 1) forcedFailures.push(err);
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

function record(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    executionId: 'exec_test_1',
    runtimeSessionId: 'rs_1',
    threadId: 'thr_1',
    companyId: '00000000-0000-0000-0000-000000000001',
    orchestrationPhase: 'precheck',
    executionStatus: 'pending',
    executionOwner: null,
    retryCount: 0,
    recoveryState: 'idle',
    startedAt: '2026-05-26T00:00:00.000Z',
    heartbeatAt: null,
    completedAt: null,
    failureReason: null,
    replayCheckpointId: null,
    ...overrides,
  };
}

interface RecordingSink extends ExecutionStoreTelemetrySink {
  events: Array<{ event: string; payload: Record<string, unknown> }>;
}
function buildSink(): RecordingSink {
  const events: RecordingSink['events'] = [];
  return {
    events,
    emit(event, payload) { events.push({ event, payload }); },
  };
}

function buildStore(extra?: { maxRetries?: number; initialBackoffMs?: number }) {
  const mock = buildMockSupabase();
  const sink = buildSink();
  const store = new SupabaseExecutionStore({
    client: mock.client,
    telemetry: sink,
    maxRetries: extra?.maxRetries ?? 3,
    initialBackoffMs: extra?.initialBackoffMs ?? 1,
  });
  return { store, mock, sink };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('SupabaseExecutionStore — create', () => {
  test('inserts a new row and returns it', async () => {
    const { store, mock, sink } = buildStore();
    const result = await store.createExecution(record());
    expect(result.executionId).toBe('exec_test_1');
    expect(mock.rows).toHaveLength(1);
    const successCount = sink.events.filter((e) => e.event === 'execution_store_write_success').length;
    expect(successCount).toBeGreaterThanOrEqual(1);
  });

  test('idempotent: second create with same executionId returns existing row', async () => {
    const { store, mock } = buildStore();
    await store.createExecution(record());
    const second = await store.createExecution(record({ executionStatus: 'running' }));
    // ignoreDuplicates → the existing row wins
    expect(second.executionStatus).toBe('pending');
    expect(mock.rows).toHaveLength(1);
  });

  test('rejects malformed payload', async () => {
    const { store } = buildStore();
    await expect(store.createExecution(record({ executionId: '' }))).rejects.toBeInstanceOf(SupabaseExecutionStoreError);
    await expect(store.createExecution(record({ companyId: '' }))).rejects.toBeInstanceOf(SupabaseExecutionStoreError);
  });
});

describe('SupabaseExecutionStore — update', () => {
  test('partial update writes only supplied fields', async () => {
    const { store, mock } = buildStore();
    await store.createExecution(record());
    const updated = await store.updateExecution('exec_test_1', { executionStatus: 'running', executionOwner: 'worker_1' });
    expect(updated?.executionStatus).toBe('running');
    expect(updated?.executionOwner).toBe('worker_1');
    expect(updated?.threadId).toBe('thr_1'); // unchanged
    expect(mock.rows[0].updated_at).toBeDefined();
  });

  test('update with empty patch returns current state without writing', async () => {
    const { store } = buildStore();
    await store.createExecution(record());
    const out = await store.updateExecution('exec_test_1', {});
    expect(out?.executionStatus).toBe('pending');
  });

  test('updateExecutionState convenience helper drives the right columns', async () => {
    const { store, mock } = buildStore();
    await store.createExecution(record());
    const r = await store.updateExecutionState({
      executionId: 'exec_test_1', status: 'running', phase: 'generation',
      owner: 'w1', retryCount: 1, heartbeatAtIso: '2026-05-26T01:00:00.000Z',
    });
    expect(r?.executionStatus).toBe('running');
    expect(r?.orchestrationPhase).toBe('generation');
    expect(r?.executionOwner).toBe('w1');
    expect(r?.retryCount).toBe(1);
    expect(r?.heartbeatAt).toBe('2026-05-26T01:00:00.000Z');
    expect(mock.rows[0].execution_status).toBe('running');
  });
});

describe('SupabaseExecutionStore — terminal transitions', () => {
  test('markExecutionCompleted sets status + completed_at', async () => {
    const { store } = buildStore();
    await store.createExecution(record());
    const out = await store.markExecutionCompleted('exec_test_1', { completedAtIso: '2026-05-26T02:00:00.000Z' });
    expect(out?.executionStatus).toBe('completed');
    expect(out?.completedAt).toBe('2026-05-26T02:00:00.000Z');
  });

  test('markExecutionFailed sets status, reason, and completed_at', async () => {
    const { store } = buildStore();
    await store.createExecution(record());
    const out = await store.markExecutionFailed('exec_test_1', { reason: 'persist_failure', completedAtIso: '2026-05-26T03:00:00.000Z' });
    expect(out?.executionStatus).toBe('failed');
    expect(out?.failureReason).toBe('persist_failure');
    expect(out?.completedAt).toBe('2026-05-26T03:00:00.000Z');
  });
});

describe('SupabaseExecutionStore — lookups', () => {
  test('getExecutionById returns null for missing id', async () => {
    const { store } = buildStore();
    expect(await store.getExecutionById('nope')).toBeNull();
  });

  test('getExecutionByThreadId returns the latest by started_at', async () => {
    const { store } = buildStore();
    await store.createExecution(record({ executionId: 'exec_a', threadId: 'thr_x', startedAt: '2026-05-26T00:00:00.000Z' }));
    await store.createExecution(record({ executionId: 'exec_b', threadId: 'thr_x', startedAt: '2026-05-26T05:00:00.000Z' }));
    const got = await store.getExecutionByThreadId({ companyId: '00000000-0000-0000-0000-000000000001', threadId: 'thr_x' });
    expect(got?.executionId).toBe('exec_b');
  });

  test('listActiveExecutions excludes terminal statuses', async () => {
    const { store } = buildStore();
    await store.createExecution(record({ executionId: 'a', executionStatus: 'running' }));
    await store.createExecution(record({ executionId: 'b', executionStatus: 'completed' }));
    await store.createExecution(record({ executionId: 'c', executionStatus: 'failed' }));
    await store.createExecution(record({ executionId: 'd', executionStatus: 'recovering' }));
    const active = await store.listActiveExecutions({ companyId: '00000000-0000-0000-0000-000000000001' });
    const ids = active.map((e) => e.executionId).sort();
    expect(ids).toEqual(['a', 'd']);
  });
});

describe('SupabaseExecutionStore — concurrent update safety', () => {
  test('two concurrent updates both succeed and last-write-wins is monotonic', async () => {
    const { store, mock } = buildStore();
    await store.createExecution(record());
    const r = await Promise.all([
      store.updateExecution('exec_test_1', { retryCount: 5 }),
      store.updateExecution('exec_test_1', { executionStatus: 'running' }),
    ]);
    // both calls succeeded
    expect(r.every((x) => x !== null)).toBe(true);
    // final row reflects both writes (the mock applies them sequentially)
    expect(mock.rows[0].retry_count).toBe(5);
    expect(mock.rows[0].execution_status).toBe('running');
  });
});

describe('SupabaseExecutionStore — transient failure retry', () => {
  test('retries on 503 status and eventually succeeds', async () => {
    const { store, mock, sink } = buildStore({ maxRetries: 3, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'service unavailable', status: 503 }, 2);
    await store.createExecution(record());
    const success = sink.events.find((e) => e.event === 'execution_store_write_success' && (e.payload.attempt as number) >= 2);
    expect(success).toBeDefined();
  });

  test('retries on transient pg sqlstate 40001 (serialization failure)', async () => {
    const { store, mock } = buildStore({ maxRetries: 2, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'serialization failure', code: '40001' }, 1);
    const result = await store.createExecution(record());
    expect(result.executionId).toBe('exec_test_1');
  });

  test('does NOT retry on non-transient errors (e.g. constraint violation)', async () => {
    const { store, mock, sink } = buildStore({ maxRetries: 3, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'check constraint violated', code: '23514' }, 99);
    await expect(store.createExecution(record())).rejects.toBeInstanceOf(SupabaseExecutionStoreError);
    const failure = sink.events.find((e) => e.event === 'execution_store_write_failure');
    expect(failure).toBeDefined();
    // attempt should be 0 because no retry happened
    expect((failure!.payload as { attempt: number }).attempt).toBe(0);
  });

  test('exhausts retries and throws structured error', async () => {
    const { store, mock } = buildStore({ maxRetries: 2, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'down', status: 503 }, 99);
    await expect(store.createExecution(record())).rejects.toMatchObject({
      name: 'SupabaseExecutionStoreError',
      retried: 2,
    });
  });
});

describe('SupabaseExecutionStore — unsupported operations (Phase 16 non-goals)', () => {
  test('recordCheckpoint throws UnsupportedOperationError', async () => {
    const { store } = buildStore();
    await expect(store.recordCheckpoint({} as never)).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  test('acquireLease throws UnsupportedOperationError', async () => {
    const { store } = buildStore();
    await expect(store.acquireLease({ executionId: 'x', workerId: 'w', durationMs: 1000 })).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  test('listExpiredLeases throws UnsupportedOperationError', async () => {
    const { store } = buildStore();
    await expect(store.listExpiredLeases({ nowMs: Date.now() })).rejects.toBeInstanceOf(UnsupportedOperationError);
  });
});

describe('SupabaseExecutionStore — appendExecutionMetadata tolerance', () => {
  test('reports metadata_column_absent when row has no metadata_json column', async () => {
    const { store } = buildStore();
    await store.createExecution(record());
    const out = await store.appendExecutionMetadata({ executionId: 'exec_test_1', metadata: { k: 'v' } });
    expect(out.appended).toBe(false);
    expect(out.reason).toBe('metadata_column_absent');
  });

  test('reports execution_not_found when id is missing', async () => {
    const { store } = buildStore();
    const out = await store.appendExecutionMetadata({ executionId: 'nope', metadata: { k: 'v' } });
    expect(out.appended).toBe(false);
    expect(out.reason).toBe('execution_not_found');
  });
});
