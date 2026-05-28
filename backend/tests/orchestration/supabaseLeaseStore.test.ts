/**
 * Phase 18B — SupabaseLeaseStore unit tests.
 *
 * Hermetic: in-memory mock supabase-js. The mock simulates the partial
 * unique index `uniq_thread_runtime_leases_active` by checking for any
 * existing released=false row on the same execution_id at insert time.
 *
 * Coverage:
 *   - acquire (success, ALREADY_ACTIVE on contention, retry on transient)
 *   - renew (success, null on released/missing)
 *   - release (idempotent)
 *   - getLease / currentLeaseForExecution / listActiveLeases / detectExpiredLeases
 *   - input validation
 *   - telemetry events fire for success + failure + contention
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseLeaseStore,
  SupabaseLeaseStoreError,
  UNIQUE_VIOLATION_SQLSTATE,
  type LeaseStoreTelemetrySink,
} from '../../services/orchestration/persistence/supabaseLeaseStore';

// ── Mock supabase-js ────────────────────────────────────────────────

interface MockLeaseRow {
  lease_id: string;
  execution_id: string;
  owner_worker_id: string;
  acquired_at: string;
  expires_at: string;
  released: boolean;
}

type Filter = { col: string; op: 'eq' | 'lte' | 'gt'; value: unknown };

interface QueryState {
  table: string;
  filters: Filter[];
  orders: Array<{ col: string; ascending: boolean }>;
  limitN?: number;
  mode: 'select' | 'insert' | 'update';
  insertRow?: MockLeaseRow;
  updatePatch?: Partial<MockLeaseRow>;
}

interface MockSupabase {
  client: SupabaseClient;
  rows: MockLeaseRow[];
  failNextWith(err: { code?: string; message: string; status?: number }, times?: number): void;
}

function buildMockSupabase(): MockSupabase {
  const rows: MockLeaseRow[] = [];
  const forcedFailures: Array<{ code?: string; message: string; status?: number }> = [];
  function maybeFail() { return forcedFailures.shift() ?? null; }

  function applyFilters(items: MockLeaseRow[], state: QueryState): MockLeaseRow[] {
    return items.filter((r) =>
      state.filters.every((f) => {
        const v = (r as unknown as Record<string, unknown>)[f.col];
        if (f.op === 'eq') return v === f.value;
        if (f.op === 'lte') return typeof v === 'string' && v <= (f.value as string);
        if (f.op === 'gt') return typeof v === 'string' && v > (f.value as string);
        return false;
      }),
    );
  }
  function applyOrder(items: MockLeaseRow[], state: QueryState): MockLeaseRow[] {
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
      lte(col: string, value: unknown) { state.filters.push({ col, op: 'lte', value }); return chain; },
      gt(col: string, value: unknown) { state.filters.push({ col, op: 'gt', value }); return chain; },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orders.push({ col, ascending: opts?.ascending !== false }); return chain;
      },
      limit(n: number) { state.limitN = n; return chain; },
      select(_cols: string) { return chain; },
      async maybeSingle() {
        const err = maybeFail();
        if (err) return { data: null, error: err };
        if (state.mode === 'update') {
          const list = applyFilters(rows, state);
          if (list.length === 0) return { data: null, error: null };
          const target = list[0];
          Object.assign(target, state.updatePatch ?? {});
          return { data: { ...target }, error: null };
        }
        const list = applyOrder(applyFilters(rows, state), state);
        return { data: list[0] ? { ...list[0] } : null, error: null };
      },
      then(onFulfilled: (v: { data: unknown; error: unknown }) => unknown, onRejected?: (e: unknown) => unknown) {
        const err = maybeFail();
        if (err) return Promise.resolve({ data: null, error: err }).then(onFulfilled, onRejected);
        if (state.mode === 'insert') {
          // Simulate partial unique index `uniq_thread_runtime_leases_active`:
          // forbid INSERT when a released=false row exists for the same execution_id.
          const conflict = rows.find(
            (r) => r.execution_id === state.insertRow!.execution_id && !r.released,
          );
          if (conflict) {
            return Promise.resolve({
              data: null,
              error: { code: UNIQUE_VIOLATION_SQLSTATE, message: 'duplicate key value violates unique constraint' },
            }).then(onFulfilled, onRejected);
          }
          rows.push({ ...state.insertRow! });
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        if (state.mode === 'update') {
          const list = applyFilters(rows, state);
          for (const r of list) Object.assign(r, state.updatePatch ?? {});
          return Promise.resolve({ data: list.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
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
        insert(row: MockLeaseRow) {
          return buildQuery({ table, filters: [], orders: [], mode: 'insert', insertRow: row });
        },
        update(patch: Partial<MockLeaseRow>) {
          return buildQuery({ table, filters: [], orders: [], mode: 'update', updatePatch: patch });
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

interface RecordingSink extends LeaseStoreTelemetrySink {
  events: Array<{ event: string; payload: Record<string, unknown> }>;
}
function buildSink(): RecordingSink {
  const events: RecordingSink['events'] = [];
  return { events, emit(event, payload) { events.push({ event, payload }); } };
}

function buildStore(extra?: { maxRetries?: number; initialBackoffMs?: number }) {
  const mock = buildMockSupabase();
  const sink = buildSink();
  const store = new SupabaseLeaseStore({
    client: mock.client, telemetry: sink,
    maxRetries: extra?.maxRetries ?? 3,
    initialBackoffMs: extra?.initialBackoffMs ?? 1,
  });
  return { store, mock, sink };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('SupabaseLeaseStore — acquire', () => {
  test('first acquire succeeds and emits success telemetry', async () => {
    const { store, mock, sink } = buildStore();
    const lease = await store.acquireLease({ executionId: 'exec_1', workerId: 'w1', durationMs: 5000 });
    expect(lease).not.toBeNull();
    expect(lease!.ownerWorkerId).toBe('w1');
    expect(mock.rows).toHaveLength(1);
    expect(sink.events.some((e) => e.event === 'lease_acquire_success')).toBe(true);
  });

  test('second acquire on same execution returns null (ALREADY_ACTIVE)', async () => {
    const { store, sink } = buildStore();
    const first = await store.acquireLease({ executionId: 'exec_1', workerId: 'w1', durationMs: 5000 });
    expect(first).not.toBeNull();
    const second = await store.acquireLease({ executionId: 'exec_1', workerId: 'w2', durationMs: 5000 });
    expect(second).toBeNull();
    const failure = sink.events.find((e) => e.event === 'lease_acquire_failure');
    expect(failure).toBeDefined();
    expect((failure!.payload as { reason?: string }).reason).toBe('ALREADY_ACTIVE');
  });

  test('rejects malformed input', async () => {
    const { store } = buildStore();
    await expect(store.acquireLease({ executionId: '', workerId: 'w', durationMs: 100 } as never)).rejects.toBeInstanceOf(SupabaseLeaseStoreError);
    await expect(store.acquireLease({ executionId: 'e', workerId: '', durationMs: 100 } as never)).rejects.toBeInstanceOf(SupabaseLeaseStoreError);
    await expect(store.acquireLease({ executionId: 'e', workerId: 'w', durationMs: 0 } as never)).rejects.toBeInstanceOf(SupabaseLeaseStoreError);
  });

  test('retries on transient pg sqlstate 40001', async () => {
    const { store, mock } = buildStore({ maxRetries: 2, initialBackoffMs: 1 });
    mock.failNextWith({ message: 'serialization', code: '40001' }, 1);
    const lease = await store.acquireLease({ executionId: 'exec_x', workerId: 'w1', durationMs: 1000 });
    expect(lease).not.toBeNull();
  });
});

describe('SupabaseLeaseStore — renew + release', () => {
  test('renewLease extends expires_at on active lease', async () => {
    const { store } = buildStore();
    const lease = await store.acquireLease({
      executionId: 'exec_1', workerId: 'w1', durationMs: 1000, nowMs: 1000,
    });
    expect(lease).not.toBeNull();
    const renewed = await store.renewLease({
      leaseId: lease!.leaseId, durationMs: 10_000, nowMs: 5000,
    });
    expect(renewed).not.toBeNull();
    expect(Date.parse(renewed!.expiresAt)).toBe(15000);
  });

  test('renewLease returns null after release', async () => {
    const { store } = buildStore();
    const lease = await store.acquireLease({ executionId: 'exec_1', workerId: 'w1', durationMs: 1000 });
    await store.releaseLease(lease!.leaseId);
    const renewed = await store.renewLease({ leaseId: lease!.leaseId, durationMs: 1000 });
    expect(renewed).toBeNull();
  });

  test('release makes the execution acquirable again', async () => {
    const { store } = buildStore();
    const first = await store.acquireLease({ executionId: 'exec_1', workerId: 'w1', durationMs: 1000 });
    await store.releaseLease(first!.leaseId);
    const second = await store.acquireLease({ executionId: 'exec_1', workerId: 'w2', durationMs: 1000 });
    expect(second).not.toBeNull();
    expect(second!.ownerWorkerId).toBe('w2');
  });

  test('release of unknown id is a no-op (does not throw)', async () => {
    const { store } = buildStore();
    await expect(store.releaseLease('unknown_lease')).resolves.toBeUndefined();
  });
});

describe('SupabaseLeaseStore — lookups', () => {
  test('getLease fetches by leaseId; missing returns null', async () => {
    const { store } = buildStore();
    const lease = await store.acquireLease({ executionId: 'exec_1', workerId: 'w1', durationMs: 1000 });
    expect((await store.getLease(lease!.leaseId))?.leaseId).toBe(lease!.leaseId);
    expect(await store.getLease('missing')).toBeNull();
  });

  test('currentLeaseForExecution returns the live one', async () => {
    const { store } = buildStore();
    const lease = await store.acquireLease({
      executionId: 'exec_1', workerId: 'w1', durationMs: 10_000, nowMs: 1000,
    });
    const cur = await store.currentLeaseForExecution('exec_1', { nowMs: 2000 });
    expect(cur?.leaseId).toBe(lease!.leaseId);
  });

  test('listActiveLeases excludes released and expired', async () => {
    const { store } = buildStore();
    await store.acquireLease({ executionId: 'exec_a', workerId: 'w1', durationMs: 1_000, nowMs: 1000 });
    const dead = await store.acquireLease({ executionId: 'exec_b', workerId: 'w2', durationMs: 100, nowMs: 1000 });
    await store.releaseLease(dead!.leaseId);
    const active = await store.listActiveLeases({ nowMs: 1500 });
    expect(active.map((l) => l.executionId)).toEqual(['exec_a']);
  });

  test('detectExpiredLeases returns released=false AND expires_at<=now', async () => {
    const { store } = buildStore();
    await store.acquireLease({ executionId: 'exec_a', workerId: 'w1', durationMs: 100, nowMs: 1000 });
    await store.acquireLease({ executionId: 'exec_b', workerId: 'w2', durationMs: 100_000, nowMs: 1000 });
    const expired = await store.detectExpiredLeases({ nowMs: 5000 });
    expect(expired.map((l) => l.executionId)).toEqual(['exec_a']);
  });
});
