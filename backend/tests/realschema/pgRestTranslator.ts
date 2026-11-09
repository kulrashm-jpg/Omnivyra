/**
 * PostgREST-builder -> SQL translator for real-schema suites, as a reusable
 * module.
 *
 * This is the translator `pi_prov_enrichment_scoring.test.ts` carries inline
 * (itself the acceptance suite's translator plus the `alias:col->key` select and
 * `.range()`), lifted verbatim into one function so a suite can install it with
 *
 *   jest.mock('../../db/supabaseClient', () =>
 *     require('./pgRestTranslator').makeSupabaseModule(() => require('./setup').db, 'xx'));
 *
 * Semantics are unchanged: one SAVEPOINT per statement (in production each call
 * is its own request), statements serialised so concurrent builders cannot
 * interleave savepoints, PostgREST-shaped `{ data, error }` results. The suites
 * that already inline their own copy are deliberately left untouched.
 *
 * Not a test file (no `.test.ts` suffix), so the real-schema project never
 * collects it as a suite.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Queryable = { query: (s: string, p?: unknown[]) => Promise<any> };

export function makeSupabaseModule(pg: () => Queryable, savepointPrefix: string) {
  type Row = Record<string, unknown>;
  type Filter =
    | { kind: 'cmp'; col: string; op: string; val: unknown }
    | { kind: 'isnull'; col: string; not: boolean }
    | { kind: 'isbool'; col: string; val: boolean }
    | { kind: 'in'; col: string; val: unknown[] }
    | { kind: 'contains'; col: string; val: unknown };

  // Serialise every statement: a SAVEPOINT released out of order would also
  // release a later one, so two in-flight builders must never interleave.
  let lock: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = lock.then(fn, fn);
    lock = p.catch(() => undefined);
    return p;
  };
  let sp = 0;
  const run = (sql: string, params: unknown[]) => serial(async () => {
    const name = `${savepointPrefix}_sp_${++sp}`;
    await pg().query(`SAVEPOINT ${name}`);
    try {
      const res = await pg().query(sql, params);
      await pg().query(`RELEASE SAVEPOINT ${name}`);
      return { res, error: null as null | Row };
    } catch (e: any) {
      await pg().query(`ROLLBACK TO SAVEPOINT ${name}`);
      return {
        res: null as any,
        error: { code: String(e?.code ?? 'unknown'), message: String(e?.message ?? e), details: e?.detail ?? null, hint: e?.hint ?? null },
      };
    }
  });

  const typeCache = new Map<string, Map<string, string>>();
  const colTypes = async (table: string): Promise<Map<string, string>> => {
    const hit = typeCache.get(table);
    if (hit) return hit;
    const r = await run(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]);
    const m = new Map<string, string>((r.res?.rows ?? []).map((x: Row) => [String(x.column_name), String(x.data_type)]));
    typeCache.set(table, m);
    return m;
  };
  const render = (types: Map<string, string>, col: string, v: unknown): unknown => {
    if (v === null || v === undefined) return null;
    const t = types.get(col) ?? '';
    if (t === 'jsonb' || t === 'json') return JSON.stringify(v);
    if (t === 'ARRAY') return v;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  };
  // PostgREST returns numeric/int8 as JSON numbers and timestamptz as strings.
  const normalize = (fields: Array<{ name: string; dataTypeID: number }>, row: Row): Row => {
    const numeric = new Set(fields.filter((f) => f.dataTypeID === 1700 || f.dataTypeID === 20).map((f) => f.name));
    const out: Row = {};
    for (const [k, v] of Object.entries(row)) {
      if (v instanceof Date) out[k] = v.toISOString();
      else if (numeric.has(k) && typeof v === 'string') out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  };
  // closure C extension: PostgREST's `alias:col->key` JSON-path select (used by
  // listProspects for the scoring marker) is rendered as `"col"->'key' AS "alias"`.
  const cols = (s: string): string => {
    const t = s.trim();
    if (!t || t === '*') return '*';
    if (t.includes('(')) throw new Error(`translator: embedded resources are not supported: ${t}`);
    return t.split(',').map((c) => {
      const m = c.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*):([a-z_][a-z0-9_]*)->([a-zA-Z_][a-zA-Z0-9_]*)$/);
      return m ? `"${m[2]}"->'${m[3]}' AS "${m[1]}"` : `"${c.trim()}"`;
    }).join(', ');
  };

  function from(table: string) {
    const st = {
      op: 'select' as 'select' | 'insert' | 'update' | 'delete' | 'upsert',
      selectCols: '*', selected: false,
      payload: null as Row | Row[] | null,
      onConflict: null as string | null, ignoreDuplicates: false,
      filters: [] as Filter[],
      order: [] as Array<{ col: string; asc: boolean }>,
      limit: null as number | null,
      offset: null as number | null,
      mode: 'many' as 'many' | 'single' | 'maybe',
    };
    const where = (types: Map<string, string>, params: unknown[]): string => {
      if (!st.filters.length) return '';
      return ` WHERE ${st.filters.map((f) => {
        if (f.kind === 'isnull') return `"${f.col}" IS ${f.not ? 'NOT ' : ''}NULL`;
        if (f.kind === 'isbool') return `"${f.col}" IS ${f.val ? 'TRUE' : 'FALSE'}`;
        if (f.kind === 'in') { params.push(f.val); return `"${f.col}" = ANY($${params.length})`; }
        if (f.kind === 'contains') {
          const t = types.get(f.col) ?? '';
          params.push(t === 'ARRAY' ? f.val : JSON.stringify(f.val));
          return `"${f.col}" @> $${params.length}${t === 'ARRAY' ? '' : '::jsonb'}`;
        }
        params.push(f.val);
        return `"${f.col}" ${f.op} $${params.length}`;
      }).join(' AND ')}`;
    };
    const exec = async (): Promise<{ data: unknown; error: unknown }> => {
      const types = await colTypes(table);
      const params: unknown[] = [];
      let sql: string;
      const returning = ` RETURNING ${cols(st.selectCols)}`;
      if (st.op === 'insert' || st.op === 'upsert') {
        const rows = Array.isArray(st.payload) ? st.payload : [st.payload ?? {}];
        const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
        const values = rows.map((r) => `(${keys.map((k) => {
          if (!(k in r)) return 'DEFAULT';
          params.push(render(types, k, r[k])); return `$${params.length}`;
        }).join(', ')})`).join(', ');
        sql = `INSERT INTO public."${table}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES ${values}`;
        if (st.op === 'upsert') {
          const target = st.onConflict ? `(${st.onConflict.split(',').map((c) => `"${c.trim()}"`).join(', ')})` : '';
          sql += st.ignoreDuplicates
            ? ` ON CONFLICT ${target} DO NOTHING`
            : ` ON CONFLICT ${target} DO UPDATE SET ${keys.map((k) => `"${k}" = EXCLUDED."${k}"`).join(', ')}`;
        }
        sql += returning;
      } else if (st.op === 'update') {
        const row = (st.payload ?? {}) as Row;
        const sets = Object.keys(row).map((k) => { params.push(render(types, k, row[k])); return `"${k}" = $${params.length}`; });
        sql = `UPDATE public."${table}" SET ${sets.join(', ')}${where(types, params)}${returning}`;
      } else if (st.op === 'delete') {
        sql = `DELETE FROM public."${table}"${where(types, params)}${returning}`;
      } else {
        sql = `SELECT ${cols(st.selectCols)} FROM public."${table}"${where(types, params)}`;
        if (st.order.length) sql += ` ORDER BY ${st.order.map((o) => `"${o.col}" ${o.asc ? 'ASC' : 'DESC'}`).join(', ')}`;
        if (st.limit !== null) sql += ` LIMIT ${st.limit}`;
        if (st.offset !== null) sql += ` OFFSET ${st.offset}`;
      }
      const r = await run(sql, params);
      if (r.error) return { data: null, error: r.error };
      const rows = (r.res.rows as Row[]).map((x) => normalize(r.res.fields, x));
      if (st.op !== 'select' && !st.selected) return { data: null, error: null };
      if (st.mode === 'many') return { data: rows, error: null };
      if (rows.length > 1 || (st.mode === 'single' && rows.length === 0)) {
        return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `${rows.length} rows`, hint: null } };
      }
      return { data: rows[0] ?? null, error: null };
    };
    const b: Record<string, unknown> = {
      select: (c?: string) => { st.selected = true; if (typeof c === 'string') st.selectCols = c; return b; },
      insert: (p: Row | Row[]) => { st.op = 'insert'; st.payload = p; return b; },
      upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        st.op = 'upsert'; st.payload = p; st.onConflict = o?.onConflict ?? null; st.ignoreDuplicates = !!o?.ignoreDuplicates; return b;
      },
      update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
      delete: () => { st.op = 'delete'; return b; },
      eq: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '=', val: v }); return b; },
      neq: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '<>', val: v }); return b; },
      gt: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '>', val: v }); return b; },
      gte: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '>=', val: v }); return b; },
      lt: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '<', val: v }); return b; },
      lte: (c: string, v: unknown) => { st.filters.push({ kind: 'cmp', col: c, op: '<=', val: v }); return b; },
      is: (c: string, v: unknown) => {
        if (v === null) st.filters.push({ kind: 'isnull', col: c, not: false });
        else if (typeof v === 'boolean') st.filters.push({ kind: 'isbool', col: c, val: v });
        else throw new Error(`translator: is(${c}, ${String(v)}) unsupported`);
        return b;
      },
      not: (c: string, op: string, v: unknown) => {
        if (op === 'is' && v === null) { st.filters.push({ kind: 'isnull', col: c, not: true }); return b; }
        if (op === 'eq') { st.filters.push({ kind: 'cmp', col: c, op: '<>', val: v }); return b; }
        throw new Error(`translator: not(${c}, ${op}) unsupported`);
      },
      in: (c: string, v: unknown[]) => { st.filters.push({ kind: 'in', col: c, val: v }); return b; },
      contains: (c: string, v: unknown) => { st.filters.push({ kind: 'contains', col: c, val: v }); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { st.order.push({ col: c, asc: o?.ascending !== false }); return b; },
      limit: (n: number) => { st.limit = n; return b; },
      // closure C extension: listProspects pages with .range(from, to).
      range: (from: number, to: number) => { st.offset = from; st.limit = to - from + 1; return b; },
      single: () => { st.mode = 'single'; return b; },
      maybeSingle: () => { st.mode = 'maybe'; return b; },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => exec().then(res, rej),
    };
    return new Proxy(b, {
      get(target, prop) {
        if (prop in target) return (target as any)[prop];
        if (typeof prop === 'symbol') return undefined;
        throw new Error(`translator: builder method .${String(prop)}() is not supported (table ${table})`);
      },
    });
  }

  async function rpc(fn: string, args: Record<string, unknown>) {
    const keys = Object.keys(args);
    const params = keys.map((k) => { const v = args[k]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; });
    const r = await run(`SELECT public."${fn}"(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS result`, params);
    if (r.error) return { data: null, error: r.error };
    return { data: r.res.rows[0]?.result ?? null, error: null };
  }

  return {
    __esModule: true,
    supabase: { from, rpc },
    getDbConnectionDiagnostics: () => ({ mode: 'direct', poolerConfigured: false }),
  };
}
