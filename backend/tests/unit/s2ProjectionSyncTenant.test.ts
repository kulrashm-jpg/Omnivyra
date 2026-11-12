/**
 * S2 tenant seam (e1-b) - projectionSyncService: every projection_sync_state read / insert / update goes through
 * tenantTable with the caller's TenantContext. Company B holds a row of the SAME projection_kind (the only
 * non-tenant filter ensureSyncRow uses). Also covers the two replay callers' projection reads.
 */
export {};
type Row = Record<string, any>;
type Filter = [string, string, unknown];
const mockDb: Record<string, Row[]> = {};
/** Column DEFAULTs of the real schema, applied on insert (faithful: Postgres fills them, the service relies on them). */
const mockDefaults: Record<string, Row> = {
  projection_sync_state: { cursor_position: null, pending_retry_count: 0, metadata: {} },
};
const mockWrites: Array<{ table: string; op: string; filters: Filter[]; payload: any }> = [];
let mockSeq = 0;
/** Faithful in-memory PostgREST double: every filter is APPLIED, every write persisted and recorded with its filters. */
function mockTable(table: string) {
  const filters: Filter[] = [];
  const tests: Array<(r: Row) => boolean> = [];
  let op = 'select'; let payload: any = null; let mode: 'many' | 'single' | 'maybe' = 'many';
  let lim = Infinity; let ord: [string, boolean] | null = null;
  const add = (kind: string, c: string, v: unknown, t: (r: Row) => boolean) => { filters.push([kind, c, v]); tests.push(t); return b; };
  const run = () => {
    const rows = (mockDb[table] = mockDb[table] ?? []);
    let out: Row[];
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      out = list.map((p) => { const r = { id: p.id ?? `${table}-${++mockSeq}`, ...(mockDefaults[table] ?? {}), ...p }; rows.push(r); return { ...r }; });
      mockWrites.push({ table, op, filters: [...filters], payload });
    } else {
      const hit = rows.filter((r) => tests.every((t) => t(r)));
      if (op === 'update') { hit.forEach((r) => Object.assign(r, payload)); mockWrites.push({ table, op, filters: [...filters], payload }); }
      if (op === 'delete') { for (const h of hit) rows.splice(rows.indexOf(h), 1); mockWrites.push({ table, op, filters: [...filters], payload: null }); }
      out = hit.map((r) => ({ ...r }));
      if (ord) { const [c, asc] = ord; out.sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1)); }
      out = out.slice(0, lim);
    }
    if (mode === 'many') return { data: out, error: null };
    if (out.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
    if (out.length === 0) return mode === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    return { data: out[0], error: null };
  };
  const b: any = {
    select: () => b,
    eq: (c: string, v: unknown) => add('eq', c, v, (r) => r[c] === v),
    neq: (c: string, v: unknown) => add('neq', c, v, (r) => r[c] !== v),
    in: (c: string, v: unknown[]) => add('in', c, v, (r) => v.includes(r[c])),
    is: (c: string, v: unknown) => add('is', c, v, (r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)),
    gt: (c: string, v: any) => add('gt', c, v, (r) => r[c] > v),
    gte: (c: string, v: any) => add('gte', c, v, (r) => r[c] >= v),
    lt: (c: string, v: any) => add('lt', c, v, (r) => r[c] < v),
    lte: (c: string, v: any) => add('lte', c, v, (r) => r[c] <= v),
    or: () => { throw new Error('or() not modelled by this fake'); },
    order: (c: string, o?: { ascending?: boolean }) => { ord = [c, o?.ascending !== false]; return b; },
    limit: (n: number) => { lim = n; return b; },
    insert: (p: any) => { op = 'insert'; payload = p; return b; },
    upsert: (p: any) => { op = 'upsert'; payload = p; return b; },
    update: (p: any) => { op = 'update'; payload = p; return b; },
    delete: () => { op = 'delete'; return b; },
    single: () => { mode = 'single'; return b; },
    maybeSingle: () => { mode = 'maybe'; return b; },
    then: (ok: any, ko: any) => Promise.resolve(run()).then(ok, ko),
  };
  return b;
}
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => mockTable(t), ownedDbRpc: async () => ({ data: null, error: null }) }));
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => mockTable(t) } }));
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const writes = (t: string) => mockWrites.filter((w) => w.table === t);
/** Every write on `t` carries the tenant predicate for A (update/delete) or is stamped with A (insert/upsert). */
const pinnedTo = (t: string, col: string, id: string) => writes(t).every((w) =>
  (w.op === 'insert' || w.op === 'upsert')
    ? (Array.isArray(w.payload) ? w.payload : [w.payload]).every((p: Row) => p[col] === id)
    : w.filters.some(([k, c, v]) => k === 'eq' && c === col && v === id));
const resetDb = () => { for (const k of Object.keys(mockDb)) delete mockDb[k]; mockWrites.length = 0; mockSeq = 0; };
jest.mock('../../services/realtimePublisherService', () => ({ publishRealtime: async () => undefined }));

import { systemTenantContext } from '../../db/tenantTable';
import {
  advanceProjectionCursor,
  listProjectionSyncStates,
  markProjectionReplayed,
  recordProjectionRetry,
} from '../../services/projectionSyncService';
import { executeReplay } from '../../services/dlqReplayService';

const tA = systemTenantContext(A, 's2 projection sync test');
const bRow = () => mockDb.projection_sync_state.find((r) => r.organization_id === B)!;

beforeEach(() => {
  resetDb();
  mockDb.projection_sync_state = [{ id: 'ps-b', organization_id: B, projection_kind: 'opportunity_feed', cursor_position: 'zzzz', pending_retry_count: 2, metadata: {} }];
});

describe('projectionSyncService through the tenant seam', () => {
  it("advance(A) creates A's own row (stamped A) and never moves B's cursor", async () => {
    const s = await advanceProjectionCursor({ tenant: tA, projectionKind: 'opportunity_feed', cursor: 'aaaa' });
    expect(s).toMatchObject({ organization_id: A, cursor_position: 'aaaa', pending_retry_count: 0 });
    expect(writes('projection_sync_state').find((w) => w.op === 'insert')!.payload.organization_id).toBe(A);
    expect(pinnedTo('projection_sync_state', 'organization_id', A)).toBe(true);
    expect(bRow()).toMatchObject({ cursor_position: 'zzzz', pending_retry_count: 2 });
  });
  it('retry / replay touch only A', async () => {
    const r = await recordProjectionRetry({ tenant: tA, projectionKind: 'opportunity_feed', reason: 'x' });
    expect(r.state).toMatchObject({ organization_id: A, pending_retry_count: 1 });
    const m = await markProjectionReplayed({ tenant: tA, projectionKind: 'opportunity_feed', cursor: 'bbbb' });
    expect(m).toMatchObject({ organization_id: A, cursor_position: 'bbbb', pending_retry_count: 0 });
    expect(pinnedTo('projection_sync_state', 'organization_id', A)).toBe(true);
    expect(bRow()).toMatchObject({ cursor_position: 'zzzz', pending_retry_count: 2 });
  });
  it("list(A) excludes B's rows", async () => {
    expect(await listProjectionSyncStates(tA)).toEqual([]);
  });
});

describe('dlqReplayService.executeReplay (caller) through the seam', () => {
  it("an A replay naming B's projection row skips it; B's cursor is never advanced", async () => {
    mockDb.replay_operations = [{ id: 'op-a', organization_id: A, status: 'approved', target_kind: 'projection', requested_items: ['ps-b'] }];
    const op = await executeReplay({ tenant: tA, replayId: 'op-a', executorUserId: 'user-a' });
    expect(op.result_summary).toMatchObject({ processed: 0, skipped: 1 });
    expect(writes('projection_sync_state')).toHaveLength(0);
    expect(bRow()).toMatchObject({ cursor_position: 'zzzz', pending_retry_count: 2 });
  });
});
