/**
 * S2 tenant-seam tests: a FAITHFUL in-memory stand-in for `ownedDbTable` (backend/db/writeOwner).
 *
 * Unlike a shape-only double it EXECUTES the query: every filter the code (or the seam) applies - eq / neq / is /
 * in / gt / gte / lt / lte / ilike, including `col->>key` JSON paths - narrows the rows; order / limit are applied;
 * maybeSingle() / single() over more than one row answer PGRST116 like PostgREST; single() over zero rows answers
 * PGRST116 too. insert / update / delete / upsert PERSIST into the store and every write is recorded with the
 * filters it ran under, so a test can assert both the outcome and the predicate.
 *
 * Unique keys (per table) make an insert of a duplicate answer 23505, as Postgres would.
 *
 * Use: jest.mock('../../db/writeOwner', () => require('../helpers/s2FaithfulFakeDb').writeOwnerModule());
 */
export type Row = Record<string, any>;
export type Filter = { op: string; col: string; value: unknown };
export type WriteRecord = { table: string; verb: 'insert' | 'update' | 'delete' | 'upsert'; filters: Filter[]; payload: unknown; affected: Row[] };

export const db: Record<string, Row[]> = {};
export const writes: WriteRecord[] = [];
export const reads: Array<{ table: string; filters: Filter[] }> = [];
const uniqueKeys: Record<string, string[][]> = {};
let seq = 0;

export function resetDb(tables: Record<string, Row[]> = {}, unique: Record<string, string[][]> = {}) {
  for (const k of Object.keys(db)) delete db[k];
  for (const k of Object.keys(uniqueKeys)) delete uniqueKeys[k];
  writes.length = 0;
  reads.length = 0;
  for (const [t, rows] of Object.entries(tables)) db[t] = rows.map((r) => ({ ...r }));
  for (const [t, keys] of Object.entries(unique)) uniqueKeys[t] = keys;
}

function valueAt(row: Row, col: string): unknown {
  const m = col.match(/^([a-z_0-9]+)->>?([A-Za-z_0-9]+)$/);
  if (!m) return row[col];
  const base = row[m[1]];
  if (!base || typeof base !== 'object') return null;
  const v = (base as Row)[m[2]];
  if (v === undefined || v === null) return null;
  return col.includes('->>') ? String(v) : v;
}
function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return (a as any) < (b as any) ? -1 : 1;
}
function test(f: Filter, row: Row): boolean {
  const v = valueAt(row, f.col);
  switch (f.op) {
    case 'eq': return v !== null && v !== undefined && String(v) === String(f.value);
    case 'neq': return v !== null && v !== undefined && String(v) !== String(f.value);
    case 'is': return f.value === null ? v === null || v === undefined : v === f.value;
    case 'in': return (f.value as unknown[]).some((x) => String(x) === String(v));
    case 'gt': return v !== null && v !== undefined && cmp(v, f.value) > 0;
    case 'gte': return v !== null && v !== undefined && cmp(v, f.value) >= 0;
    case 'lt': return v !== null && v !== undefined && cmp(v, f.value) < 0;
    case 'lte': return v !== null && v !== undefined && cmp(v, f.value) <= 0;
    case 'ilike': {
      const re = new RegExp('^' + String(f.value).split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      return typeof v === 'string' && re.test(v);
    }
    default: throw new Error(`fake db: unsupported filter ${f.op}`);
  }
}
function project(row: Row, columns: string | undefined): Row {
  if (!columns || columns.trim() === '*') return { ...row };
  const out: Row = {};
  for (const c of columns.split(',').map((x) => x.trim()).filter(Boolean)) out[c] = row[c];
  return out;
}

function violatesUnique(table: string, candidate: Row, ignore?: Row): boolean {
  for (const key of uniqueKeys[table] ?? []) {
    if (key.some((k) => candidate[k] === undefined || candidate[k] === null)) continue;
    if ((db[table] ?? []).some((r) => r !== ignore && key.every((k) => String(r[k]) === String(candidate[k])))) return true;
  }
  return false;
}

export function fakeTable(table: string) {
  const filters: Filter[] = [];
  const orders: Array<{ col: string; asc: boolean }> = [];
  let limitN: number | null = null;
  let verb: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  let payload: unknown = null;
  let options: Row | undefined;
  let returning = false;
  let returnCols: string | undefined;
  let mode: 'many' | 'maybe' | 'single' = 'many';

  const matching = () => {
    let rows = (db[table] ?? []).filter((r) => filters.every((f) => test(f, r)));
    for (const o of [...orders].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(valueAt(a, o.col), valueAt(b, o.col)));
    if (limitN !== null) rows = rows.slice(0, limitN);
    return rows;
  };
  const shape = (rows: Row[]) => {
    const projected = rows.map((r) => project(r, returnCols));
    if (mode === 'many') return { data: projected, error: null };
    if (projected.length > 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
    if (projected.length === 0) {
      return mode === 'single'
        ? { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
        : { data: null, error: null };
    }
    return { data: projected[0], error: null };
  };
  const execute = () => {
    if (verb === 'select') {
      reads.push({ table, filters: [...filters] });
      return shape(matching());
    }
    db[table] = db[table] ?? [];
    if (verb === 'insert' || verb === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
      const affected: Row[] = [];
      for (const p of list) {
        if (verb === 'upsert') {
          const key = String((options?.onConflict as string) ?? 'id').split(',').map((x) => x.trim());
          const existing = db[table].find((r) => key.every((k) => String(r[k]) === String(p[k])));
          if (existing) {
            if (options?.ignoreDuplicates) continue;
            Object.assign(existing, p);
            affected.push(existing);
            continue;
          }
        }
        const row: Row = { id: p.id ?? `gen-${++seq}`, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(), ...p };
        if (violatesUnique(table, row)) {
          writes.push({ table, verb, filters: [...filters], payload, affected: [] });
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        db[table].push(row);
        affected.push(row);
      }
      writes.push({ table, verb, filters: [...filters], payload, affected });
      return returning ? shape(affected) : { data: null, error: null };
    }
    const hit = (db[table] ?? []).filter((r) => filters.every((f) => test(f, r)));
    if (verb === 'update') {
      for (const r of hit) Object.assign(r, payload as Row);
    } else {
      db[table] = db[table].filter((r) => !hit.includes(r));
    }
    writes.push({ table, verb, filters: [...filters], payload, affected: hit.map((r) => ({ ...r })) });
    return returning ? shape(hit) : { data: null, error: null };
  };

  const b: any = {
    select(cols?: string) {
      if (verb === 'select') returnCols = cols; else { returning = true; returnCols = cols; }
      return b;
    },
    insert(p: unknown, o?: Row) { verb = 'insert'; payload = p; options = o; return b; },
    upsert(p: unknown, o?: Row) { verb = 'upsert'; payload = p; options = o; return b; },
    update(p: unknown, o?: Row) { verb = 'update'; payload = p; options = o; return b; },
    delete(o?: Row) { verb = 'delete'; options = o; return b; },
    eq(col: string, value: unknown) { filters.push({ op: 'eq', col, value }); return b; },
    neq(col: string, value: unknown) { filters.push({ op: 'neq', col, value }); return b; },
    is(col: string, value: unknown) { filters.push({ op: 'is', col, value }); return b; },
    in(col: string, value: unknown[]) { filters.push({ op: 'in', col, value }); return b; },
    gt(col: string, value: unknown) { filters.push({ op: 'gt', col, value }); return b; },
    gte(col: string, value: unknown) { filters.push({ op: 'gte', col, value }); return b; },
    lt(col: string, value: unknown) { filters.push({ op: 'lt', col, value }); return b; },
    lte(col: string, value: unknown) { filters.push({ op: 'lte', col, value }); return b; },
    ilike(col: string, value: unknown) { filters.push({ op: 'ilike', col, value }); return b; },
    order(col: string, o?: { ascending?: boolean }) { orders.push({ col, asc: o?.ascending !== false }); return b; },
    limit(n: number) { limitN = n; return b; },
    maybeSingle() { mode = 'maybe'; return Promise.resolve(execute()); },
    single() { mode = 'single'; return Promise.resolve(execute()); },
    then(ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve(execute()).then(ok, ko); },
  };
  return b;
}

export function writeOwnerModule() {
  return {
    ownedDbTable: (t: string) => fakeTable(t),
    ownedDbRpc: async () => ({ data: null, error: null }),
  };
}
