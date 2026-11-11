/**
 * The PostgREST transport replaced with SQL on the harness connection, for suites that
 * drive real services against the real schema. Everything below the transport is real:
 * constraints, triggers, unique indexes and functions.
 *
 * Calls are serialized because one connection serves them all, so interleaved service
 * runs race BETWEEN calls, at the real unique index, instead of corrupting savepoints.
 */

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
const normalize = (row: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
};
/**
 * PostgREST COMPUTED FIELDS: a function taking the table's row type is selectable by name
 * (`.select('…, read_at')`). Plain SQL only resolves that through the qualified form
 * `"table".fn`, so the bare name would fail 42703 here and the caller would fail closed —
 * not what PostgREST does. Rendered as PostgreSQL's own ISO-8601 text of the value (an explicit
 * offset, microseconds kept), as PostgREST's JSON carries it,
 * never a JavaScript re-rendering. Only the functions listed here; anything else is a column.
 *   contact_governance_records.read_at: 20270202000000 (the read's transaction_timestamp()).
 *
 * LITERAL ALLOWLIST, deliberately: a computed field added later does NOT inherit this treatment.
 * Rendered in UTC with an explicit offset regardless of the session TimeZone, so the string
 * never depends on how this harness's session is configured. Microseconds are kept by the
 * TRANSPORT only; callers that Date.parse() it compare at millisecond precision.
 *
 * FIDELITY CAVEAT: this produces read_at by a different mechanism than production (PostgREST's
 * computed field), and the STRING differs in one known way: `.US` pads fractional seconds to six
 * digits (`…:00.100000+00:00`, a whole second as `.000000`), where PostgREST's JSON trims trailing
 * zeros (`…:00.1+00:00`, a whole second with no fraction). The instant is identical and every
 * caller parses it; a test that pins the literal string would break exactly there. A green harness is therefore NOT evidence about PostgREST's behaviour; that is
 * proven by .github/workflows/pi-contact-governance-postgrest.yml (real PostgREST). This shortcut
 * is sound only while that workflow runs on every PR and main push (A2, b13c8964d).
 */
const COMPUTED_FIELDS: Readonly<Record<string, readonly string[]>> = {
  contact_governance_records: ['read_at'],
};
export const renderCols = (table: string, cols: string): string => {
  const computed = COMPUTED_FIELDS[table];
  if (!computed) return cols;
  return cols.split(',').map((c) => {
    const name = c.trim();
    return computed.includes(name)
      ? `to_char("${table}".${name} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') AS "${name}"`
      : c;
  }).join(',');
};
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
      if (f.op === 'is' && f.val === null) return `"${f.col}" IS NULL`;
      if (f.op === 'not_is_null') return `"${f.col}" IS NOT NULL`;
      if (f.op === 'in') {
        const list = (f.val as unknown[]).map((v) => { params.push(v); return `$${params.length}`; });
        return list.length ? `"${f.col}" IN (${list.join(', ')})` : 'false';
      }
      params.push(f.val);
      return `"${f.col}" ${SQL_OP[f.op]} $${params.length}`;
    });
    return ` WHERE ${parts.join(' AND ')}`;
  };
  const exec = async () => {
    const c = client();
    const params: unknown[] = [];
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
      sql += ` RETURNING ${renderCols(table, st.cols)}`;
    } else if (st.op === 'update') {
      const row = (st.payload ?? {}) as Row;
      const sets = Object.keys(row).map((k) => { params.push(render(row[k])); return `"${k}" = $${params.length}`; }).join(', ');
      sql = `UPDATE public."${table}" SET ${sets}${where(params)} RETURNING ${renderCols(table, st.cols)}`;
    } else if (st.op === 'delete') {
      sql = `DELETE FROM public."${table}"${where(params)} RETURNING ${renderCols(table, st.cols)}`;
    } else if (st.count) {
      sql = `SELECT count(*)::int AS n FROM public."${table}"${where(params)}`;
    } else {
      sql = `SELECT ${renderCols(table, st.cols)} FROM public."${table}"${where(params)}`;
      if (st.orders.length) sql += ` ORDER BY ${st.orders.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`;
      if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
      if (st.offset !== null) sql += ` OFFSET ${st.offset}`;
    }
    await c.query('SAVEPOINT pg_adapter');
    try {
      const res = await c.query(sql, params);
      await c.query('RELEASE SAVEPOINT pg_adapter');
      if (st.count) return { data: null, count: Number(res.rows[0].n), error: null };
      const out = res.rows.map(normalize);
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

export function pgRpc(client: () => PgClient) {
  return (fn: string, args: Row) => serial(async () => {
    const c = client();
    if (!/^[a-z_]+$/.test(fn)) throw new Error(`pg adapter: bad function name ${fn}`);
    const keys = Object.keys(args);
    const sql = `SELECT * FROM public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    await c.query('SAVEPOINT pg_rpc');
    try {
      const res = await c.query(sql, keys.map((k) => args[k]));
      await c.query('RELEASE SAVEPOINT pg_rpc');
      return { data: res.rows.map(normalize), error: null };
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT pg_rpc');
      return { data: null, error: err };
    }
  });
}
