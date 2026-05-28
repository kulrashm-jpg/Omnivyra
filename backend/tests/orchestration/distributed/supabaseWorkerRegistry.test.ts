/**
 * Phase 21B — SupabaseWorkerRegistry unit tests.
 *
 * Hermetic: mock supabase-js. Validates the same contract as the in-memory
 * DistributedWorkerCoordinator (Phase 20B).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseWorkerRegistry,
} from '../../../services/orchestration/distributed/supabaseWorkerRegistry';

interface MockRow {
  worker_id: string;
  worker_kind: string;
  worker_status: string;
  capabilities_json: Array<{ name: string; weight?: number }>;
  active_execution_count: number;
  recovery_load: number;
  hostname: string | null;
  process_identity: string | null;
  registered_at: string;
  heartbeat_at: string | null;
  drain_started_at: string | null;
  offline_at: string | null;
  process_metadata: Record<string, unknown>;
  updated_at: string;
}

type Op = 'eq' | 'in' | 'lte' | 'lt' | 'not_in' | 'not_eq';
type Filter = { col: string; op: Op; value: unknown };

interface QueryState {
  table: string;
  filters: Filter[];
  orders: Array<{ col: string; ascending: boolean }>;
  limitN?: number;
  mode: 'select' | 'insert' | 'update' | 'delete';
  insertRow?: MockRow;
  updatePatch?: Partial<MockRow>;
}

function buildMockSupabase() {
  const rows: MockRow[] = [];

  function applyFilters(items: MockRow[], state: QueryState): MockRow[] {
    return items.filter((r) =>
      state.filters.every((f) => {
        const v = (r as unknown as Record<string, unknown>)[f.col];
        switch (f.op) {
          case 'eq': return v === f.value;
          case 'not_eq': return v !== f.value;
          case 'in': return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
          case 'not_in': return !(Array.isArray(f.value) && (f.value as unknown[]).includes(v));
          case 'lte': return typeof v === 'string' && v <= (f.value as string);
          case 'lt': return typeof v === 'string' && v < (f.value as string);
          default: return false;
        }
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

  function buildQuery(initial: QueryState) {
    const state: QueryState = { ...initial, filters: [...initial.filters], orders: [...initial.orders] };
    const chain: Record<string, unknown> = {
      eq(col: string, v: unknown) { state.filters.push({ col, op: 'eq', value: v }); return chain; },
      not(col: string, op: string, v: unknown) {
        if (op === 'eq') state.filters.push({ col, op: 'not_eq', value: v });
        else if (op === 'in') {
          const cleaned = typeof v === 'string'
            ? v.replace(/[()]/g, '').split(',').map((s) => s.trim()).filter((s) => s.length > 0)
            : v;
          state.filters.push({ col, op: 'not_in', value: cleaned });
        }
        return chain;
      },
      in(col: string, value: unknown[]) { state.filters.push({ col, op: 'in', value }); return chain; },
      lte(col: string, v: unknown) { state.filters.push({ col, op: 'lte', value: v }); return chain; },
      lt(col: string, v: unknown) { state.filters.push({ col, op: 'lt', value: v }); return chain; },
      order(col: string, opts?: { ascending?: boolean }) {
        state.orders.push({ col, ascending: opts?.ascending !== false });
        return chain;
      },
      limit(n: number) { state.limitN = n; return chain; },
      select(_cols: string) { return chain; },
      async maybeSingle() {
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
        if (state.mode === 'insert') {
          if (rows.find((r) => r.worker_id === state.insertRow!.worker_id)) {
            return Promise.resolve({ data: null, error: { code: '23505', message: 'unique' } }).then(onFulfilled, onRejected);
          }
          rows.push({ ...state.insertRow! });
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        if (state.mode === 'update') {
          const list = applyFilters(rows, state);
          for (const r of list) Object.assign(r, state.updatePatch ?? {});
          return Promise.resolve({ data: list.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
        }
        if (state.mode === 'delete') {
          const list = applyFilters(rows, state);
          for (const r of list) {
            const idx = rows.indexOf(r);
            if (idx >= 0) rows.splice(idx, 1);
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
        select(_cols: string) { return buildQuery({ table, filters: [], orders: [], mode: 'select' }); },
        insert(row: MockRow) { return buildQuery({ table, filters: [], orders: [], mode: 'insert', insertRow: row }); },
        update(patch: Partial<MockRow>) { return buildQuery({ table, filters: [], orders: [], mode: 'update', updatePatch: patch }); },
        delete() { return buildQuery({ table, filters: [], orders: [], mode: 'delete' }); },
      };
    },
  } as unknown as SupabaseClient;

  return { client, rows };
}

function buildRegistry() {
  const mock = buildMockSupabase();
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const r = new SupabaseWorkerRegistry({
    client: mock.client,
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    maxRetries: 0,
    defaultStaleThresholdMs: 50,
  });
  return { r, mock, events };
}

describe('SupabaseWorkerRegistry — register', () => {
  test('register creates an active worker row', async () => {
    const { r, mock } = buildRegistry();
    const w = await r.register({
      workerId: 'w_1', workerKind: 'queue_worker', capabilities: [{ name: 'all' }],
    });
    expect(w.status).toBe('active');
    expect(mock.rows.length).toBe(1);
  });

  test('register is idempotent on same workerId (refreshes)', async () => {
    const { r } = buildRegistry();
    await r.register({ workerId: 'w_1', workerKind: 'queue_worker', capabilities: [] });
    const second = await r.register({
      workerId: 'w_1', workerKind: 'queue_worker',
      capabilities: [{ name: 'updated' }],
    });
    expect(second.capabilities[0]?.name).toBe('updated');
  });
});

describe('SupabaseWorkerRegistry — heartbeat + lifecycle', () => {
  test('heartbeat updates heartbeat_at + counters', async () => {
    const { r, mock } = buildRegistry();
    await r.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    const beat = await r.heartbeat({ workerId: 'w', activeExecutionCount: 3 });
    expect(beat?.activeExecutionCount).toBe(3);
    expect(mock.rows[0].active_execution_count).toBe(3);
  });

  test('drain transitions to draining + sets drain_started_at', async () => {
    const { r } = buildRegistry();
    await r.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    const d = await r.drain('w');
    expect(d?.status).toBe('draining');
    expect(d?.drainStartedAtIso).not.toBeNull();
  });

  test('offline transitions to offline + sets offline_at', async () => {
    const { r } = buildRegistry();
    await r.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    const o = await r.offline('w');
    expect(o?.status).toBe('offline');
    expect(o?.offlineAtIso).not.toBeNull();
  });
});

describe('SupabaseWorkerRegistry — counters', () => {
  test('noteExecutionStarted/Finished tracks count', async () => {
    const { r } = buildRegistry();
    await r.register({ workerId: 'w', workerKind: 'queue_worker', capabilities: [] });
    await r.noteExecutionStarted('w');
    await r.noteExecutionStarted('w');
    expect((await r.get('w'))?.activeExecutionCount).toBe(2);
    await r.noteExecutionFinished('w');
    expect((await r.get('w'))?.activeExecutionCount).toBe(1);
  });
});

describe('SupabaseWorkerRegistry — sweepStale', () => {
  test('sweepStale flips workers whose heartbeat predates cutoff', async () => {
    const { r, mock } = buildRegistry();
    await r.register({ workerId: 'w_old', workerKind: 'queue_worker', capabilities: [] });
    // Backdate the heartbeat.
    mock.rows[0].heartbeat_at = new Date(Date.now() - 60_000).toISOString();
    const result = await r.sweepStale({ staleThresholdMs: 1_000 });
    expect(result.markedStale).toContain('w_old');
    expect((await r.get('w_old'))?.status).toBe('stale');
  });
});

describe('SupabaseWorkerRegistry — list + archival', () => {
  test('list filters by status', async () => {
    const { r } = buildRegistry();
    await r.register({ workerId: 'a', workerKind: 'queue_worker', capabilities: [] });
    await r.register({ workerId: 'b', workerKind: 'queue_worker', capabilities: [] });
    await r.drain('a');
    const draining = await r.list({ status: 'draining' });
    expect(draining.map((w) => w.workerId)).toEqual(['a']);
  });

  test('deleteOfflineOlderThan removes only offline rows past cutoff', async () => {
    const { r, mock } = buildRegistry();
    await r.register({ workerId: 'a', workerKind: 'queue_worker', capabilities: [] });
    await r.register({ workerId: 'b', workerKind: 'queue_worker', capabilities: [] });
    await r.offline('b');
    // Backdate the offline row.
    const bRow = mock.rows.find((row) => row.worker_id === 'b');
    if (bRow) bRow.updated_at = new Date(Date.now() - 60_000).toISOString();
    const cutoff = new Date(Date.now() - 30_000).toISOString();
    const deleted = await r.deleteOfflineOlderThan(cutoff);
    expect(deleted).toBe(1);
    expect(mock.rows.find((row) => row.worker_id === 'b')).toBeUndefined();
  });
});
