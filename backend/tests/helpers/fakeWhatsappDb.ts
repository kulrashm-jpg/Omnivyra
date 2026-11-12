/**
 * An in-memory stand-in for the PostgREST builder, for the WhatsApp engine's unit
 * suites. It models what those suites depend on: filters, ordering, paging, `single`
 * refusing anything but one row, conflict keys on upsert, and returned errors.
 *
 * It is a FAKE. It proves control flow, not the schema: constraints, triggers and real
 * column types are only exercised by backend/tests/realschema/orch_engines_real.test.ts.
 */

export type Row = Record<string, unknown>;

export const fakeDb = {
  tables: {} as Record<string, Row[]>,
  /** Every `table:op` issued, so a suite can prove a read did not happen. */
  calls: [] as string[],
  rpcs: [] as Array<{ fn: string; args: Row }>,
  /** `table:op` keys that return an error: after how many more calls, and how many times. */
  failures: new Map<string, { skip: number; times: number }>(),
  nextId: 1,
};

export function resetFakeDb(tables: Record<string, Row[]> = {}): void {
  fakeDb.tables = tables;
  fakeDb.calls = [];
  fakeDb.rpcs = [];
  fakeDb.failures = new Map();
  fakeDb.nextId = 1;
}

/** The next call of `op` on `table`, after `skip` that succeed, returns a database error. */
export function failNext(table: string, op: 'select' | 'update' | 'upsert' | 'insert', skip = 0): void {
  fakeDb.failures.set(`${table}:${op}`, { skip, times: 1 });
}

type Op = 'select' | 'update' | 'upsert' | 'insert';

export function fakeTable(table: string): Row {
  const st = {
    op: 'select' as Op,
    payload: null as Row | Row[] | null,
    conflict: [] as string[],
    ignoreDuplicates: false,
    tests: [] as Array<(r: Row) => boolean>,
    order: null as { col: string; asc: boolean } | null,
    from: 0,
    limit: null as number | null,
    mode: 'many' as 'many' | 'one' | 'single',
    head: false,
  };
  const rows = (): Row[] => (fakeDb.tables[table] ??= []);
  const cmp = (test: (a: string, b: string) => boolean) => (col: string, v: unknown) => {
    st.tests.push((r) => r[col] != null && test(String(r[col]), String(v)));
    return b;
  };

  const exec = async () => {
    fakeDb.calls.push(`${table}:${st.op}`);
    const key = `${table}:${st.op}`;
    const failure = fakeDb.failures.get(key);
    if (failure && failure.skip > 0) {
      failure.skip -= 1;
    } else if (failure && failure.times > 0) {
      failure.times -= 1;
      return { data: null, count: null, error: { code: '08006', message: `fake failure on ${key}` } };
    }

    let out: Row[];
    if (st.op === 'insert' || st.op === 'upsert') {
      out = [];
      for (const incoming of (Array.isArray(st.payload) ? st.payload : [st.payload as Row])) {
        const existing = st.op === 'upsert' ? rows().find((r) => st.conflict.every((c) => r[c] === incoming[c])) : undefined;
        if (existing) {
          if (!st.ignoreDuplicates) { Object.assign(existing, incoming); out.push(existing); }
        } else {
          const row = { id: `row-${fakeDb.nextId++}`, ...incoming };
          rows().push(row);
          out.push(row);
        }
      }
    } else {
      out = rows().filter((r) => st.tests.every((t) => t(r)));
      if (st.op === 'update') out.forEach((r) => Object.assign(r, st.payload));
    }

    if (st.head) return { data: null, count: out.length, error: null };
    if (st.order) {
      const { col, asc } = st.order;
      out = [...out].sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : String(x[col]) > String(y[col]) ? 1 : 0) * (asc ? 1 : -1));
    }
    out = out.slice(st.from, st.limit === null ? undefined : st.from + st.limit);
    if (st.mode === 'single' && out.length !== 1) {
      return { data: null, count: null, error: { code: 'PGRST116', message: `expected one row, got ${out.length}` } };
    }
    // A COPY, as PostgREST returns: handing back the live row let a later write (or a test's
    // concurrent change) silently rewrite a value the caller had already read. SHALLOW, like the
    // `many` path below: a jsonb column (an object or array value) still aliases the stored row.
    if (st.mode !== 'many') return { data: out[0] ? { ...out[0] } : null, count: null, error: null };
    return { data: out.map((r) => ({ ...r })), count: null, error: null };
  };

  const b: Row = {
    select: (_cols?: string, opts?: { head?: boolean }) => { if (opts?.head) st.head = true; return b; },
    insert: (p: Row | Row[]) => { st.op = 'insert'; st.payload = p; return b; },
    upsert: (p: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      st.op = 'upsert'; st.payload = p;
      st.conflict = String(o?.onConflict ?? '').split(',').map((c) => c.trim());
      st.ignoreDuplicates = o?.ignoreDuplicates === true;
      return b;
    },
    update: (p: Row) => { st.op = 'update'; st.payload = p; return b; },
    eq: (col: string, v: unknown) => { st.tests.push((r) => r[col] === v); return b; },
    neq: (col: string, v: unknown) => { st.tests.push((r) => r[col] !== v); return b; },
    in: (col: string, vs: unknown[]) => { st.tests.push((r) => vs.includes(r[col])); return b; },
    is: (col: string, v: unknown) => { st.tests.push((r) => (v === null ? r[col] == null : r[col] === v)); return b; },
    not: (col: string) => { st.tests.push((r) => r[col] != null); return b; },
    gt: cmp((x, y) => x > y),
    gte: cmp((x, y) => x >= y),
    lt: cmp((x, y) => x < y),
    lte: cmp((x, y) => x <= y),
    order: (col: string, o?: { ascending?: boolean }) => { st.order = { col, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { st.limit = n; return b; },
    range: (from: number, to: number) => { st.from = from; st.limit = to - from + 1; return b; },
    single: () => { st.mode = 'single'; return b; },
    maybeSingle: () => { st.mode = 'one'; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => exec().then(res, rej),
  };
  return b;
}

/** `supabase.rpc` for functions that exist nowhere: recorded, and answered with an error. */
export async function fakeRpc(fn: string, args: Row): Promise<{ data: null; error: { message: string } }> {
  fakeDb.rpcs.push({ fn, args });
  return { data: null, error: { message: `function ${fn} does not exist` } };
}
