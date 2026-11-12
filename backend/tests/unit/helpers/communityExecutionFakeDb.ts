/**
 * In-memory PostgREST-shaped fake for the community execution safety tests.
 *
 * Each awaited query is evaluated synchronously inside `then`, so a single
 * UPDATE ... WHERE ... is atomic exactly like one PostgREST statement, while
 * two flows awaiting in parallel interleave between statements (the race the
 * production compare-and-set claims must survive).
 *
 * Supports the subset used by the code under test: select / insert / update /
 * delete with eq / neq / in / is / not(col,'is',null) / lt / lte / gte /
 * order / limit / maybeSingle / single, and `{ count: 'exact', head: true }`.
 */

type Row = Record<string, any>;
type Filter = (r: Row) => boolean;

export type FakeDb = {
  tables: Record<string, Row[]>;
  from: (table: string) => any;
  /** Optional per-table CHECK on `status` (mirrors the DB constraint). */
  statusCheck: Record<string, Set<string> | undefined>;
  /** Unique columns per table (single-column uniqueness, 23505 on conflict). */
  unique: Record<string, string[] | undefined>;
  /**
   * Composite (optionally PARTIAL) unique indexes per table, 23505 on conflict - e.g.
   * community_ai_actions_one_pending: cols (tenant_id, organization_id, platform, action_type,
   * target_id), where status = 'pending'. NULLS NOT DISTINCT (NULLs compare equal), as the index.
   */
  uniqueIndexes: Record<string, Array<{ cols: string[]; where?: (r: Row) => boolean }> | undefined>;
  ops: Array<{ table: string; op: string; patch?: Row }>;
};

let idSeq = 0;

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: {},
    statusCheck: {},
    unique: {},
    uniqueIndexes: {},
    ops: [],
    from: (table: string) => builder(db, table),
  };
  for (const [t, rows] of Object.entries(seed)) db.tables[t] = rows.map((r) => ({ ...r }));
  return db;
}

function tableOf(db: FakeDb, t: string): Row[] {
  if (!db.tables[t]) db.tables[t] = [];
  return db.tables[t];
}

function cmp(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a < b ? -1 : 1;
}

function builder(db: FakeDb, table: string) {
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let patch: Row | Row[] | null = null;
  const filters: Filter[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limitN: number | null = null;
  let single: 'maybe' | 'one' | null = null;
  let countHead = false;
  let returning = false;

  const q: any = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      if (op === 'select') {
        if (opts?.head) countHead = true;
      } else {
        returning = true;
      }
      return q;
    },
    insert(row: Row | Row[]) { op = 'insert'; patch = row; return q; },
    update(p: Row) { op = 'update'; patch = p; return q; },
    delete() { op = 'delete'; return q; },
    eq(c: string, v: any) { filters.push((r) => r[c] === v); return q; },
    neq(c: string, v: any) { filters.push((r) => r[c] !== v); return q; },
    in(c: string, vs: any[]) { filters.push((r) => vs.includes(r[c])); return q; },
    is(c: string, v: any) { filters.push((r) => (v === null ? r[c] === null || r[c] === undefined : r[c] === v)); return q; },
    not(c: string, operator: string, v: any) {
      if (operator === 'is' && v === null) filters.push((r) => r[c] !== null && r[c] !== undefined);
      else filters.push((r) => r[c] !== v);
      return q;
    },
    lt(c: string, v: any) { filters.push((r) => r[c] !== null && r[c] !== undefined && cmp(r[c], v) < 0); return q; },
    lte(c: string, v: any) { filters.push((r) => r[c] !== null && r[c] !== undefined && cmp(r[c], v) <= 0); return q; },
    gte(c: string, v: any) { filters.push((r) => r[c] !== null && r[c] !== undefined && cmp(r[c], v) >= 0); return q; },
    order(c: string, o?: { ascending?: boolean }) { order = { col: c, asc: o?.ascending !== false }; return q; },
    limit(n: number) { limitN = n; return q; },
    maybeSingle() { single = 'maybe'; return q; },
    single() { single = 'one'; return q; },
    then(resolve: (v: any) => any, reject?: (e: any) => any) {
      try {
        return Promise.resolve(execute()).then(resolve, reject);
      } catch (e) {
        return Promise.reject(e).then(resolve, reject);
      }
    },
  };

  const matches = (r: Row) => filters.every((f) => f(r));

  function shape(rows: Row[]) {
    if (single) {
      if (rows.length === 0) return { data: null, error: null };
      if (rows.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } };
      return { data: { ...rows[0] }, error: null };
    }
    return { data: rows.map((r) => ({ ...r })), error: null };
  }

  function checkRow(r: Row): { message: string; code: string } | null {
    const allowed = db.statusCheck[table];
    if (allowed && r.status !== undefined && r.status !== null && !allowed.has(r.status)) {
      return { message: `new row violates check constraint "${table}_status_check"`, code: '23514' };
    }
    return null;
  }

  function uniqueViolation(candidate: Row, self: Row | null, also: Row[] = []): boolean {
    const others = [...tableOf(db, table), ...also].filter((o) => o !== self);
    const cols = db.unique[table] || [];
    if (cols.some((c) =>
      candidate[c] !== null && candidate[c] !== undefined &&
      others.some((o) => o[c] === candidate[c]))) return true;
    for (const idx of db.uniqueIndexes[table] || []) {
      if (idx.where && !idx.where(candidate)) continue;
      const norm = (v: unknown) => (v === undefined ? null : v);
      if (others.some((o) => (!idx.where || idx.where(o)) && idx.cols.every((c) => norm(o[c]) === norm(candidate[c])))) return true;
    }
    return false;
  }

  function execute() {
    const rows = tableOf(db, table);
    if (op === 'select') {
      let out = rows.filter(matches);
      if (order) {
        const { col, asc } = order;
        out = [...out].sort((a, b) => (asc ? cmp(a[col], b[col]) : cmp(b[col], a[col])));
      }
      if (limitN !== null) out = out.slice(0, limitN);
      if (countHead) return { data: null, error: null, count: out.length };
      return shape(out);
    }
    if (op === 'insert') {
      // ALL-OR-NOTHING, as one INSERT statement: every row is checked (against the table AND the
      // rows before it in this batch) before any is written.
      const list = Array.isArray(patch) ? patch : [patch as Row];
      const accepted: Row[] = [];
      for (const r of list) {
        const row = { id: r.id ?? `fake-${++idSeq}`, ...r };
        const bad = checkRow(row);
        if (bad) return { data: null, error: bad };
        if (uniqueViolation(row, null, accepted) || [...rows, ...accepted].some((o) => o.id === row.id)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
        }
        accepted.push(row);
      }
      for (const row of accepted) {
        rows.push(row);
        db.ops.push({ table, op: 'insert', patch: row });
      }
      return { data: returning ? accepted.map((r) => ({ ...r })) : null, error: null };
    }
    if (op === 'update') {
      const hit = rows.filter(matches);
      for (const r of hit) {
        const next = { ...r, ...(patch as Row) };
        const bad = checkRow(next);
        if (bad) return { data: null, error: bad };
        if (uniqueViolation(next, r)) {
          return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
        }
      }
      for (const r of hit) Object.assign(r, patch as Row);
      db.ops.push({ table, op: 'update', patch: patch as Row });
      return returning ? shape(hit) : { data: null, error: null };
    }
    // delete
    const keep = rows.filter((r) => !matches(r));
    const removed = rows.length - keep.length;
    db.tables[table] = keep;
    db.ops.push({ table, op: 'delete', patch: { removed } });
    return { data: null, error: null };
  }

  return q;
}

/** Production status vocabulary after 20261231000002 (see the migration). */
export const COMMUNITY_STATUS_VOCABULARY = new Set([
  'pending', 'approved', 'scheduled', 'dispatched', 'acknowledged', 'executing',
  'executed', 'sent_unverified', 'failed', 'skipped', 'blocked', 'uncertain',
]);
