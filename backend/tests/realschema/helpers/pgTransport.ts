/**
 * The PostgREST transport replaced with SQL on the harness connection, for suites that
 * drive real services against the real schema. Everything below the transport is real:
 * constraints, triggers, unique indexes and functions.
 *
 * Calls are serialized because one connection serves them all, so interleaved service
 * runs race BETWEEN calls, at the real unique index, instead of corrupting savepoints.
 *
 * ROWS ARRIVE AS POSTGREST SENDS THEM (2026-11-13, 6f; 83 review). PostgREST builds its response
 * with to_json, so a timestamptz keeps its MICROSECONDS ("...10:00:00.123456+00:00"), numerics are
 * JSON numbers and json columns are objects. node-pg instead returned Date objects, which
 * `toISOString()` cut to milliseconds: a value read back and used as a compare-and-set token
 * (`.eq('updated_at', token)`, the C3 claim fence) could then never match - the fake was HARSHER than
 * PostgREST. Every row is now rendered with to_jsonb:
 *   - SELECT: `to_jsonb(x)` over `CROSS JOIN LATERAL (SELECT <select list>) x`, so WHERE / ORDER BY /
 *     LIMIT / OFFSET stay on the outer query exactly as before (row order is unchanged, guaranteed).
 *   - INSERT / UPDATE / DELETE ... RETURNING: wrapped in a CTE and rendered the same way.
 * RPC answers follow PostgREST too: a scalar function returns the bare value, a non-set composite one
 * object, a SETOF / TABLE function an array of objects, a void function null.
 */

import { selectList } from './computedFields';

type Row = Record<string, unknown>;
type Filter = { col: string; op: string; val: unknown };

export interface PgClient { query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[]; rowCount?: number | null }> }

let tail: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.catch(() => undefined);
  return run;
}

const SQL_OP: Record<string, string> = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<', neq: '<>' };
/** The select list as a row source inside LATERAL: a bare `*` must name the table there. */
const lateralList = (sel: string, table: string): string =>
  sel.split(',').map((item) => (item.trim() === '*' ? `"${table}".*` : item)).join(',');
/** What PostgREST does with a JSON body value: objects and arrays arrive as JSON. */
const render = (v: unknown): unknown => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

export function pgTable(client: () => PgClient, table: string): Row {
  const st = {
    op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    cols: '*', payload: null as Row | Row[] | null, filters: [] as Filter[], conflict: null as string | null, ignoreDuplicates: false,
    orders: [] as Array<{ col: string; asc: boolean }>, limit: null as number | null, offset: null as number | null,
    mode: 'many' as 'many' | 'one' | 'single', count: false,
  };
  const where = (params: unknown[]): string => {
    if (st.filters.length === 0) return '';
    const parts = st.filters.map((f) => {
      // Qualified with the table: the SELECT's LATERAL row repeats the column names.
      const col = `"${table}"."${f.col}"`;
      if (f.op === 'is' && f.val === null) return `${col} IS NULL`;
      if (f.op === 'not_is_null') return `${col} IS NOT NULL`;
      if (f.op === 'in') {
        const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
        return list.length ? `${col} IN (${list.join(', ')})` : 'false';
      }
      params.push(f.val);
      return `${col} ${SQL_OP[f.op]} $${params.length}`;
    });
    return ` WHERE ${parts.join(' AND ')}`;
  };
  const exec = async () => {
    const c = client();
    const params: unknown[] = [];
    const sel = await selectList(c, table, st.cols);
    let sql: string;
    if (st.op === 'insert' || st.op === 'upsert') {
      const rows = (Array.isArray(st.payload) ? st.payload : [st.payload ?? {}]) as Row[];
      const keys = Object.keys(rows[0]);
      const values = rows.map((row) => `(${keys.map((k) => { params.push(render(row[k])); return `$${params.length}`; }).join(', ')})`).join(', ');
      sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES ${values}`;
      if (st.op === 'upsert') {
        const target = String(st.conflict ?? '').split(',').map((s) => s.trim());
        const sets = keys.filter((k) => !target.includes(k)).map((k) => `"${k}" = EXCLUDED."${k}"`).join(', ');
        sql += ` ON CONFLICT (${target.map((k) => `"${k}"`).join(', ')}) DO ${sets && !st.ignoreDuplicates ? `UPDATE SET ${sets}` : 'NOTHING'}`;
      }
      sql = `WITH q AS (${sql} RETURNING ${sel}) SELECT to_jsonb(q) AS __row FROM q`;
    } else if (st.op === 'update') {
      const row = (st.payload ?? {}) as Row;
      const sets = Object.keys(row).map((k) => { params.push(render(row[k])); return `"${k}" = $${params.length}`; }).join(', ');
      sql = `WITH q AS (UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${sel}) SELECT to_jsonb(q) AS __row FROM q`;
    } else if (st.op === 'delete') {
      sql = `WITH q AS (DELETE FROM public."${table}"${where(params)} RETURNING ${sel}) SELECT to_jsonb(q) AS __row FROM q`;
    } else if (st.count) {
      sql = `SELECT count(*)::int AS n FROM public."${table}"${where(params)}`;
    } else {
      sql = `SELECT to_jsonb(x) AS __row FROM public."${table}" CROSS JOIN LATERAL (SELECT ${lateralList(sel, table)}) x${where(params)}`;
      if (st.orders.length) sql += ` ORDER BY ${st.orders.map((o) => `"${table}"."${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`;
      if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      if (st.offset !== null) sql += ` OFFSET ${st.offset}`;
    }
    await c.query('SAVEPOINT pg_adapter');
    try {
      const res = await c.query(sql, params);
      await c.query('RELEASE SAVEPOINT pg_adapter');
      if (st.count) return { data: null, count: Number(res.rows[0].n), error: null };
      const out = res.rows.map((r) => r.__row as Row);
      if (st.mode === 'single' && out.length !== 1) return { data: null, error: { code: 'PGRST116', message: `expected one row, got ${out.length}` } };
      if (st.mode !== 'many') return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT pg_adapter');
      return { data: null, error: err };
    }
  };
  const filter = (op: string) => (col: string, val: unknown) => { st.filters.push({ col, op, val }); return b; };
  const b: Row = {
    select: (cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (cols) st.cols = cols;
      if (opts?.head) st.count = true;
      return b;
    },
    insert: (row: Row | Row[]) => { st.op = 'insert'; st.payload = row; return b; },
    upsert: (row: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => { st.op = 'upsert'; st.payload = row; st.conflict = opts?.onConflict ?? null; st.ignoreDuplicates = opts?.ignoreDuplicates === true; return b; },
    update: (row: Row) => { st.op = 'update'; st.payload = row; return b; },
    delete: () => { st.op = 'delete'; return b; },
    eq: filter('eq'), gte: filter('gte'), lte: filter('lte'), gt: filter('gt'), lt: filter('lt'), neq: filter('neq'),
    is: filter('is'), in: filter('in'),
    not: (col: string) => { st.filters.push({ col, op: 'not_is_null', val: null }); return b; },
    order: (col: string, opts?: { ascending?: boolean }) => { st.orders.push({ col, asc: opts?.ascending !== false }); return b; },
    limit: (n: number) => { st.limit = n; return b; },
    range: (from: number, to: number) => { st.offset = from; st.limit = to - from + 1; return b; },
    single: () => { st.mode = 'single'; return b; },
    maybeSingle: () => { st.mode = 'one'; return b; },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => serial(exec).then(res, rej),
  };
  return b;
}

type RpcShape = 'scalar' | 'composite' | 'set' | 'void';
const rpcShapeCache = new Map<string, RpcShape>();
/** PostgREST's answer shape for public.<fn>: from pg_proc (SETOF / TABLE -> set; row type -> composite). */
async function rpcShape(c: PgClient, fn: string): Promise<RpcShape> {
  const hit = rpcShapeCache.get(fn);
  if (hit) return hit;
  const r = await c.query(
    `SELECT p.proretset AS set, t.typtype AS kind, t.typname AS name
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_type t ON t.oid = p.prorettype
      WHERE n.nspname = 'public' AND p.proname = $1 ORDER BY p.oid LIMIT 1`, [fn]);
  const row = r.rows[0] as { set?: boolean; kind?: string; name?: string } | undefined;
  const shape: RpcShape = !row ? 'set'
    : row.set ? 'set'
      : row.name === 'void' ? 'void'
        : (row.kind === 'c' || row.name === 'record') ? 'composite' : 'scalar';
  rpcShapeCache.set(fn, shape);
  return shape;
}

export function pgRpc(client: () => PgClient) {
  return (fn: string, args: Row) => serial(async () => {
    const c = client();
    if (!/^[a-z_]+$/.test(fn)) throw new Error(`pg adapter: bad function name ${fn}`);
    const keys = Object.keys(args);
    const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    await c.query('SAVEPOINT pg_rpc');
    try {
      const shape = await rpcShape(c, fn);
      const sql = shape === 'scalar' || shape === 'void' ? `SELECT to_jsonb(${call}) AS __v`
        : `SELECT to_jsonb(r) AS __row FROM ${call} r`;
      const res = await c.query(sql, keys.map((k) => args[k]));
      await c.query('RELEASE SAVEPOINT pg_rpc');
      if (shape === 'void') return { data: null, error: null };
      if (shape === 'scalar') return { data: (res.rows[0] as Row | undefined)?.__v ?? null, error: null };
      const rows = res.rows.map((x) => x.__row as Row);
      return { data: shape === 'composite' ? (rows[0] ?? null) : rows, error: null };
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT pg_rpc');
      return { data: null, error: err };
    }
  });
}
