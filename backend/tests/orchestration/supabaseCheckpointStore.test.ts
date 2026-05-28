/**
 * Phase 18A — SupabaseCheckpointStore unit tests.
 *
 * Hermetic: a tiny in-memory mock of the supabase-js query builder
 * (mirrors the pattern in supabaseExecutionStore.test.ts). No network,
 * no real database.
 *
 * Coverage:
 *   - append (success + idempotent collision + retry)
 *   - getLatest / list (ordering)
 *   - restoreCheckpointState coalesces correctly
 *   - getCheckpointById / checkpointExists
 *   - validation rejects malformed payloads
 *   - 256KB size guard rejects oversized
 *   - telemetry events fire on success + failure
 *   - structured error wrapping
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseCheckpointStore,
  SupabaseCheckpointStoreError,
  MAX_PAYLOAD_BYTES,
  type CheckpointStoreTelemetrySink,
} from '../../services/orchestration/persistence/supabaseCheckpointStore';
import type { ExecutionCheckpoint } from '../../services/threadRuntime/threadRuntimeTypes';

// ── Mock supabase-js ────────────────────────────────────────────────

interface MockRow {
  checkpoint_id: string;
  execution_id: string;
  taken_at: string;
  phase: string;
  completed_node_operation_ids: string[];
  pending_node_operation_ids: string[];
  pending_topology_mutation_ids: string[];
  recovery_progress: Record<string, unknown> | null;
  replay_continuity: Record<string, unknown> | null;
}

type Filter = { col: string; op: 'eq'; value: unknown };

interface QueryState {
  table: string;
  filters: Filter[];
  orders: Array<{ col: string; ascending: boolean }>;
  limitN?: number;
  mode: 'select' | 'upsert';
  upsertRow?: MockRow;
  upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean };
}

interface MockSupabase {
  client: SupabaseClient;
  rows: MockRow[];
  failNextWith(err: { code?: string; message: string; status?: number }, times?: number): void;
}

function buildMockSupabase(): MockSupabase {
  const rows: MockRow[] = [];
  const forcedFailures: Array<{ code?: string; message: string; status?: number }> = [];

  function maybeFail() { return forcedFailures.shift() ?? null; }
  function applyFilters(items: MockRow[], state: QueryState): MockRow[] {
    return items.filter((r) =>
      state.filters.every((f) => {
        const v = (r as unknown as Record<string, unknown>)[f.col];
        return v === f.value;
      }),
    );
  }
  function applyOrder(items: MockRow[], state: QueryState): MockRow[] {
    if (state.orders.length === 0) return items;
    return [...items].sort((a, b) => {
      for (const o of state.orders) {
        const av = (a as unknown as Record<string, unknown>)[o.col] as string;
        const bv = (b as unknown as Record<string, unknown>)[o.col] as string;
        if (av === bv) continue;
        const cmp = av < bv ? -1 : 1;
        return o.ascending ? cmp : -cmp;
      }
      return 0;
    });
  }

  function buildQuery(initialState: QueryState) {
    const state = { ...initialState, filters: [...initialState.filters], orders: [...initialState.orders] };
    const chain: Record<string, unknown> = {
      eq(col: string, value: unknown) { state.filters.push({ col, op: 'eq', value }); return chain; },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orders.push({ col, ascending: opts?.ascending !== false });
        return chain;
      },
      limit(n: number) { state.limitN = n; return chain; },
      select(_cols: string) { return chain; },
      async maybeSingle() {
        const err = maybeFail();
        if (err) return { data: null, error: err };
        const list = applyOrder(applyFilters(rows, state), state);
        return { data: list[0] ? { ...list[0] } : null, error: null };
      },
      then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
        const err = maybeFail();
        if (err) return Promise.resolve({ data: null, error: err }).then(onFulfilled, onRejected);
        if (state.mode === 'upsert') {
          const row = state.upsertRow!;
          const exists = rows.find((r) => r.checkpoint_id === row.checkpoint_id);
          if (exists) {
            if (!(state.upsertOpts?.ignoreDuplicates)) Object.assign(exists, row);
          } else {
            rows.push({ ...row });
          }
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        const list = applyOrder(applyFilters(rows, state), state);
        const capped = state.limitN ? list.slice(0, state.limitN) : list;
        return Promise.resolve({ data: capped.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select(_cols: string) {
          return buildQuery({ table, filters: [], orders: [], mode: 'select' });
        },
        upsert(row: MockRow, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          return buildQuery({ table, filters: [], orders: [], mode: 'upsert', upsertRow: row, upsertOpts: opts });
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client, rows,
    failNextWith(err, times = 1) {
      for (let i = 0; i < times; i += 1) forcedFailures.push(err);
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function checkpoint(overrides: Partial<ExecutionCheckpoint> = {}): ExecutionCheckpoint {
  return {
    checkpointId: 'cp_1',
    executionId: 'exec_1',
    takenAt: '2026-05-26T00:00:00.000Z',
    phase: 'generation',
    completedNodeOperationIds: [],
    pendingNodeOperationIds: [],
    pendingTopologyMutationIds: [],
    recoveryProgress: null,
    replayContinuity: null,
    ...overrides,
  };
}

interface RecordingSink extends CheckpointStoreTelemetrySink {
  events: Array<{ event: string; payload: Record<string, unknown> }>;
}
function buildSink(): RecordingSink {
  const events: RecordingSink['events'] = [];
  return { events, emit(event, payload) { events.push({ event, payload }); } };
}

function buildStore(extra?: { maxRetries?: number; initialBackoffMs?: number }) {
  const mock = buildMockSupabase();
  const sink = buildSink();
  const store = new SupabaseCheckpointStore({
    client: mock.client,
    telemetry: sink,
    maxRetries: extra?.maxRetries ?? 3,
    initialBackoffMs: extra?.initialBackoffMs ?? 1,
  });
  return { store, mock, sink };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SupabaseCheckpointStore — append', () => {
  test('inserts a checkpoint and reads it back', async () => {
    const { store, mock, sink } = buildStore();
    const out = await store.appendCheckpoint(checkpoint());
    expect(out.checkpointId).toBe('cp_1');
    expect(mock.rows).toHaveLength(1);
    expect(sink.events.some((e) => e.event === 'checkpoint_store_write_success')).toBe(true);
  });

  test('idempotent: re-appending same checkpoint_id is a no-op', async () => {
    const { store, mock } = buildStore();
    await store.appendCheckpoint(checkpoint());
    const second = await store.appendCheckpoint(checkpoint({ phase: 'finalize' }));
    expect(mock.rows).toHaveLength(1);
    // existing row wins due to ignoreDuplicates
    expect(second.phase).toBe('generation');
  });

  test('rejects malformed payloads', async () => {
    const { store } = buildStore();
    await expect(store.appendCheckpoint(checkpoint({ checkpointId: '' }))).rejects.toBeInstanceOf(SupabaseCheckpointStoreError);
    await expect(store.appendCheckpoint(checkpoint({ executionId: '' }))).rejects.toBeInstanceOf(SupabaseCheckpointStoreError);
    await expect(store.appendCheckpoint(checkpoint({ phase: 'bogus' as never }))).rejects.toBeInstanceOf(SupabaseCheckpointStoreError);
    await expect(store.appendCheckpoint(checkpoint({ completedNodeOperationIds: 'nope' as never }))).rejects.toBeInstanceOf(SupabaseCheckpointStoreError);
  });

  test('size guard rejects oversized payloads', async () => {
    const { store } = buildStore();
    const huge = 'x'.repeat(MAX_PAYLOAD_BYTES + 1);
    await expect(
      store.appendCheckpoint(checkpoint({ recoveryProgress: { huge } })),
    ).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  test('retries on transient pg sqlstate 40001', async () => {
    const { store, mock } = buildStore({ maxRetries: 2, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'serialization failure', code: '40001' }, 1);
    const out = await store.appendCheckpoint(checkpoint());
    expect(out.checkpointId).toBe('cp_1');
  });

  test('emits failure telemetry on non-transient error', async () => {
    const { store, mock, sink } = buildStore({ maxRetries: 1, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'check constraint', code: '23514' }, 99);
    await expect(store.appendCheckpoint(checkpoint())).rejects.toBeInstanceOf(SupabaseCheckpointStoreError);
    expect(sink.events.some((e) => e.event === 'checkpoint_store_write_failure')).toBe(true);
  });
});

describe('SupabaseCheckpointStore — list + getLatest', () => {
  test('listExecutionCheckpoints returns deterministic order', async () => {
    const { store } = buildStore();
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_b', takenAt: '2026-05-26T02:00:00.000Z' }));
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_a', takenAt: '2026-05-26T01:00:00.000Z' }));
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_c', takenAt: '2026-05-26T03:00:00.000Z' }));
    const list = await store.listExecutionCheckpoints('exec_1');
    expect(list.map((c) => c.checkpointId)).toEqual(['cp_a', 'cp_b', 'cp_c']);
  });

  test('getLatestCheckpoint returns the newest by taken_at', async () => {
    const { store } = buildStore();
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_a', takenAt: '2026-05-26T01:00:00.000Z' }));
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_b', takenAt: '2026-05-26T02:00:00.000Z' }));
    const latest = await store.getLatestCheckpoint('exec_1');
    expect(latest?.checkpointId).toBe('cp_b');
  });

  test('getCheckpointById fetches a single row by PK', async () => {
    const { store } = buildStore();
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_target' }));
    const got = await store.getCheckpointById('cp_target');
    expect(got?.checkpointId).toBe('cp_target');
    const missing = await store.getCheckpointById('nope');
    expect(missing).toBeNull();
  });

  test('checkpointExists is true / false correctly', async () => {
    const { store } = buildStore();
    await store.appendCheckpoint(checkpoint({ checkpointId: 'cp_exist' }));
    expect(await store.checkpointExists('cp_exist')).toBe(true);
    expect(await store.checkpointExists('cp_missing')).toBe(false);
  });
});

describe('SupabaseCheckpointStore — restoreCheckpointState', () => {
  test('coalesces completed ids across the chain; pending = latest minus completed', async () => {
    const { store } = buildStore();
    await store.appendCheckpoint(checkpoint({
      checkpointId: 'cp_a', takenAt: '2026-05-26T01:00:00.000Z',
      completedNodeOperationIds: ['n1'],
      pendingNodeOperationIds: ['n2', 'n3'],
    }));
    await store.appendCheckpoint(checkpoint({
      checkpointId: 'cp_b', takenAt: '2026-05-26T02:00:00.000Z',
      completedNodeOperationIds: ['n2'],
      pendingNodeOperationIds: ['n3', 'n4'],
    }));
    const view = await store.restoreCheckpointState('exec_1');
    expect(view.phase).toBe('generation');
    expect(view.completedNodeOperationIds.sort()).toEqual(['n1', 'n2']);
    // pending = latest.pending minus completed = ['n3','n4'] minus ['n1','n2'] = ['n3','n4']
    expect(view.pendingNodeOperationIds).toEqual(['n3', 'n4']);
  });

  test('returns empty view when no checkpoints exist', async () => {
    const { store } = buildStore();
    const view = await store.restoreCheckpointState('exec_empty');
    expect(view.phase).toBeNull();
    expect(view.completedNodeOperationIds).toEqual([]);
    expect(view.pendingNodeOperationIds).toEqual([]);
  });
});
