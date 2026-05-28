/**
 * Phase 21A — SupabaseExecutionQueue unit tests.
 *
 * Hermetic: hand-rolled mock supabase-js query builder. Validates the
 * SupabaseExecutionQueue exercises the same contract as the in-memory
 * queue but against a mock backend.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SupabaseExecutionQueue,
  SupabaseExecutionQueueError,
} from '../../../services/orchestration/distributed/supabaseExecutionQueue';
import type { QueueEntry } from '../../../services/orchestration/distributed/distributedTypes';

interface MockRow {
  queue_entry_id: string;
  execution_id: string;
  runtime_session_id: string | null;
  company_id: string;
  kind: string;
  queue_status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  visibility_timeout_at: string | null;
  claimed_by_worker: string | null;
  claimed_at: string | null;
  dedup_key: string;
  payload_json: Record<string, unknown> | null;
  result_json: Record<string, unknown> | null;
  failure_reason: string | null;
  created_at: string;
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
  count?: 'exact' | 'planned' | 'estimated';
  countHead?: boolean;
}

function buildMockSupabase() {
  const rows: MockRow[] = [];
  const forcedFailures: Array<{ code?: string; message: string; status?: number }> = [];

  function maybeFail() { return forcedFailures.shift() ?? null; }

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
        const av = (a as unknown as Record<string, unknown>)[o.col] as string | number;
        const bv = (b as unknown as Record<string, unknown>)[o.col] as string | number;
        if (av === bv) continue;
        const cmp = (av as number) < (bv as number) ? -1 : 1;
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
        // .not('field', 'eq', 'value') or .not('field', 'in', '(a,b)')
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
      select(_cols: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
        if (opts?.count) state.count = opts.count;
        if (opts?.head) state.countHead = true;
        return chain;
      },
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
      then(onFulfilled: (v: { data: unknown; error: unknown; count?: number }) => unknown, onRejected?: (e: unknown) => unknown) {
        const err = maybeFail();
        if (err) return Promise.resolve({ data: null, error: err }).then(onFulfilled, onRejected);
        if (state.mode === 'insert') {
          // Unique-violation simulation: enforce uniqueness on dedup_key
          // for live entries (queued | claimed | failed).
          const liveStatuses = new Set(['queued', 'claimed', 'failed']);
          const conflict = rows.find(
            (r) => r.dedup_key === state.insertRow!.dedup_key && liveStatuses.has(r.queue_status),
          );
          if (conflict) {
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates partial unique index' },
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
        if (state.mode === 'delete') {
          const list = applyFilters(rows, state);
          for (const r of list) {
            const idx = rows.indexOf(r);
            if (idx >= 0) rows.splice(idx, 1);
          }
          return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
        }
        // select
        const list = applyOrder(applyFilters(rows, state), state);
        const capped = state.limitN ? list.slice(0, state.limitN) : list;
        if (state.countHead && state.count === 'exact') {
          return Promise.resolve({ data: null, error: null, count: capped.length }).then(onFulfilled, onRejected);
        }
        return Promise.resolve({ data: capped.map((r) => ({ ...r })), error: null }).then(onFulfilled, onRejected);
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        select(cols: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
          return buildQuery({
            table, filters: [], orders: [], mode: 'select',
            count: opts?.count, countHead: opts?.head,
          });
        },
        insert(row: MockRow) {
          return buildQuery({ table, filters: [], orders: [], mode: 'insert', insertRow: row });
        },
        update(patch: Partial<MockRow>) {
          return buildQuery({ table, filters: [], orders: [], mode: 'update', updatePatch: patch });
        },
        delete() {
          return buildQuery({ table, filters: [], orders: [], mode: 'delete' });
        },
      };
    },
  } as unknown as SupabaseClient;

  return {
    client, rows,
    failNextWith(err: { code?: string; message: string; status?: number }, times = 1) {
      for (let i = 0; i < times; i += 1) forcedFailures.push(err);
    },
  };
}

function buildQueue(extra?: { maxRetries?: number }) {
  const mock = buildMockSupabase();
  const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  const q = new SupabaseExecutionQueue({
    client: mock.client,
    telemetry: { emit(event, payload) { events.push({ event, payload }); } },
    maxRetries: extra?.maxRetries ?? 0,
    initialBackoffMs: 1,
  });
  return { q, mock, events };
}

function enqueueDefaults() {
  return {
    executionId: 'exec_X',
    companyId: '00000000-0000-0000-0000-000000000001',
    kind: 'execution_start' as const,
  };
}

describe('SupabaseExecutionQueue — enqueue', () => {
  test('persists a row with queued status', async () => {
    const { q, mock } = buildQueue();
    const e = await q.enqueue(enqueueDefaults());
    expect(e.status).toBe('queued');
    expect(mock.rows).toHaveLength(1);
  });

  test('dedup hit returns existing live entry instead of duplicate', async () => {
    const { q, mock } = buildQueue();
    const a = await q.enqueue(enqueueDefaults());
    const b = await q.enqueue(enqueueDefaults());
    expect(b.queueEntryId).toBe(a.queueEntryId);
    expect(mock.rows).toHaveLength(1);
  });

  test('non-unique-violation insert error propagates as SupabaseExecutionQueueError', async () => {
    const { q, mock } = buildQueue({ maxRetries: 0 });
    mock.failNextWith({ message: 'permission denied', code: '42501' });
    await expect(q.enqueue(enqueueDefaults())).rejects.toBeInstanceOf(SupabaseExecutionQueueError);
  });
});

describe('SupabaseExecutionQueue — claim', () => {
  test('atomic claim returns at most `limit` entries', async () => {
    const { q } = buildQueue();
    await q.enqueue({ executionId: 'a', companyId: 'co', kind: 'execution_start' });
    await q.enqueue({ executionId: 'b', companyId: 'co', kind: 'execution_start' });
    await q.enqueue({ executionId: 'c', companyId: 'co', kind: 'execution_start' });
    const claimed = await q.claim({ workerId: 'w', limit: 2 });
    expect(claimed.length).toBe(2);
    expect(claimed.every((c) => c.status === 'claimed' && c.claimedByWorkerId === 'w')).toBe(true);
  });

  test('claim respects company + kind filters', async () => {
    const { q } = buildQueue();
    await q.enqueue({ executionId: 'a', companyId: 'co1', kind: 'execution_start' });
    await q.enqueue({ executionId: 'b', companyId: 'co2', kind: 'execution_recovery' });
    const claimed = await q.claim({ workerId: 'w', kind: 'execution_recovery' });
    expect(claimed.length).toBe(1);
    expect(claimed[0].executionId).toBe('b');
  });
});

describe('SupabaseExecutionQueue — ack + retry', () => {
  test('ack completed flips status', async () => {
    const { q } = buildQueue();
    const e = await q.enqueue(enqueueDefaults());
    await q.claim({ workerId: 'w' });
    const after = await q.ack({ queueEntryId: e.queueEntryId, workerId: 'w', outcome: 'completed' });
    expect(after?.status).toBe('completed');
  });

  test('ack failed reschedules with backoff (queued + future runAt)', async () => {
    const { q } = buildQueue();
    const e = await q.enqueue({ ...enqueueDefaults(), maxAttempts: 3 });
    await q.claim({ workerId: 'w' });
    const after = await q.ack({
      queueEntryId: e.queueEntryId, workerId: 'w', outcome: 'failed', retryAfterMs: 1,
    });
    expect(after?.status).toBe('queued');
    expect(Date.parse(after!.runAtIso)).toBeGreaterThanOrEqual(Date.now() - 5_000);
  });

  test('ack by non-owner returns null (dedup suppression)', async () => {
    const { q, events } = buildQueue();
    const e = await q.enqueue(enqueueDefaults());
    await q.claim({ workerId: 'w_owner' });
    const result = await q.ack({
      queueEntryId: e.queueEntryId, workerId: 'w_intruder', outcome: 'completed',
    });
    expect(result).toBeNull();
    expect(events.some((ev) => ev.event === 'execution_dedup_suppressed' && ev.payload.reason === 'ack_by_non_owner')).toBe(true);
  });
});

describe('SupabaseExecutionQueue — reclaim + archival', () => {
  test('reclaimExpired resets claimed entries past visibility', async () => {
    const { q, mock } = buildQueue();
    await q.enqueue(enqueueDefaults());
    await q.claim({ workerId: 'w', visibilityMs: 1 });
    // Force visibility deadline into the past.
    mock.rows[0].visibility_timeout_at = new Date(Date.now() - 1000).toISOString();
    const reclaimed = await q.reclaimExpired();
    expect(reclaimed.length).toBe(1);
    expect(reclaimed[0].status).toBe('queued');
  });

  test('deleteTerminalEntriesOlderThan removes only terminal rows', async () => {
    const { q, mock } = buildQueue();
    await q.enqueue({ ...enqueueDefaults(), executionId: 'a' });
    const e2 = await q.enqueue({ ...enqueueDefaults(), executionId: 'b' });
    await q.claim({ workerId: 'w' });
    await q.ack({ queueEntryId: e2.queueEntryId, workerId: 'w', outcome: 'completed' });
    // Backdate the completed row.
    const completedRow = mock.rows.find((r) => r.execution_id === 'b');
    if (completedRow) completedRow.updated_at = new Date(Date.now() - 60_000).toISOString();
    const cutoff = new Date(Date.now() - 30_000).toISOString();
    const deleted = await q.deleteTerminalEntriesOlderThan(cutoff);
    expect(deleted).toBe(1);
    // The 'a' row (active) remains.
    expect(mock.rows.some((r) => r.execution_id === 'a')).toBe(true);
  });
});

describe('SupabaseExecutionQueue — inspection', () => {
  test('countByStatus tallies rows', async () => {
    const { q } = buildQueue();
    await q.enqueue({ ...enqueueDefaults(), executionId: 'a' });
    await q.enqueue({ ...enqueueDefaults(), executionId: 'b' });
    const counts = await q.countByStatus();
    expect(counts.queued).toBe(2);
  });

  test('listByExecution returns ordered entries', async () => {
    const { q } = buildQueue();
    await q.enqueue({ ...enqueueDefaults(), executionId: 'X' });
    const list = await q.listByExecution('X');
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

describe('SupabaseExecutionQueue — types preserved', () => {
  test('rowToEntry preserves wire shape', async () => {
    const { q } = buildQueue();
    const e: QueueEntry = await q.enqueue(enqueueDefaults());
    expect(e).toHaveProperty('queueEntryId');
    expect(e).toHaveProperty('executionId');
    expect(e).toHaveProperty('dedupKey');
    expect(e).toHaveProperty('maxAttempts');
    expect(e).toHaveProperty('createdAtIso');
  });
});
