/**
 * A small SCHEMA-AWARE PostgREST fake for unit tests (55, 2026-11-13).
 *
 * Unlike a permissive fake, it knows each table's columns and foreign keys, and answers the way PostgREST does when a
 * query names something that does not exist:
 *   - an unknown column (in a select, a filter, an order, an insert)   -> error { code: '42703' }
 *   - an embed with no foreign-key path between the two tables         -> error { code: 'PGRST200' }
 * and applies the documented embed semantics: a filter on an embedded column filters only the embedded rows unless
 * every embed on the path is `!inner`, in which case it filters the top-level rows.
 *
 * Supported: select (nested embeds, `!inner`, `*`, aliasless), eq / gte / lte / in, order, range, limit, maybeSingle,
 * single, { count: 'exact' }, insert(...).select().single() / plain insert. Enough for the routes under test; it is a
 * model of documented behaviour, not PostgREST itself.
 */
export type Row = Record<string, any>;
export type TableSchema = { columns: string[]; fks?: Record<string, { table: string; local: string; remote?: string }> };
export type Schema = Record<string, TableSchema>;

type Embed = { name: string; inner: boolean; cols: string[]; children: Embed[] };

function parseSelect(s: string): { cols: string[]; embeds: Embed[] } {
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  const cols: string[] = [];
  const embeds: Embed[] = [];
  for (const raw of items) {
    const it = raw.trim().replace(/\s+/g, ' ');
    const m = it.match(/^([A-Za-z_][A-Za-z0-9_]*)(![A-Za-z0-9_]+)?\s*\(([\s\S]*)\)$/);
    if (!m) { if (it) cols.push(it); continue; }
    const inner = parseSelect(m[3]);
    embeds.push({ name: m[1], inner: m[2] === '!inner', cols: inner.cols, children: inner.embeds });
  }
  return { cols, embeds };
}

export function createSchemaFake(schema: Schema, data: Record<string, Row[]>) {
  const calls: Array<{ table: string; op: string; payload?: Row }> = [];
  const err = (code: string, message: string) => ({ data: null, count: null, error: { code, message } });

  function checkCols(table: string, cols: string[]): string | null {
    const known = schema[table]?.columns ?? [];
    for (const c of cols) if (c !== '*' && !known.includes(c)) return `column ${table}.${c} does not exist`;
    return null;
  }
  function relation(parent: string, child: string) {
    return schema[parent]?.fks?.[child] ?? null;
  }
  function validateTree(table: string, cols: string[], embeds: Embed[]): { code: string; msg: string } | null {
    const c = checkCols(table, cols);
    if (c) return { code: '42703', msg: c };
    for (const e of embeds) {
      const rel = relation(table, e.name);
      if (!rel) return { code: 'PGRST200', msg: `Could not find a relationship between '${table}' and '${e.name}'` };
      const v = validateTree(rel.table, e.cols, e.children);
      if (v) return v;
    }
    return null;
  }

  function from(table: string) {
    if (!schema[table]) throw new Error(`hostile fake: table ${table} not in schema`);
    let sel: { cols: string[]; embeds: Embed[] } = { cols: ['*'], embeds: [] };
    const filters: Array<{ path: string[]; op: 'eq' | 'gte' | 'lte' | 'in'; v: any }> = [];
    const orders: string[] = [];
    let range: [number, number] | null = null;
    let lim: number | null = null;
    let wantCount = false;
    let insertPayload: Row | Row[] | null = null;

    const q: any = {};
    q.select = (s?: string, opts?: { count?: string }) => { if (s !== undefined && insertPayload === null) sel = parseSelect(s); if (opts?.count) wantCount = true; return q; };
    for (const op of ['eq', 'gte', 'lte', 'in'] as const) q[op] = (c: string, v: any) => { filters.push({ path: c.split('.'), op, v }); return q; };
    q.order = (c: string) => { orders.push(c); return q; };
    q.range = (a: number, b: number) => { range = [a, b]; return q; };
    q.limit = (n: number) => { lim = n; return q; };
    q.insert = (p: Row | Row[]) => { insertPayload = p; return q; };

    const pass = (row: Row, op: string, col: string, v: any) =>
      op === 'eq' ? row[col] === v : op === 'gte' ? row[col] >= v : op === 'lte' ? row[col] <= v : (v as any[]).includes(row[col]);

    function buildEmbed(parentTable: string, parentRow: Row, e: Embed, path: string[]): { value: Row | Row[] | null; exclude: boolean } {
      const rel = relation(parentTable, e.name)!;
      const remote = rel.remote ?? 'id';
      // to-one when the FK column is on the parent; to-many when the child references the parent.
      const toMany = rel.local === '__child__';
      const candidates = toMany
        ? (data[rel.table] ?? []).filter((r) => r[remote] === parentRow.id)
        : (data[rel.table] ?? []).filter((r) => r[remote] === parentRow[rel.local]);
      const here = [...path, e.name];
      const own = filters.filter((f) => f.path.length === here.length + 1 && f.path.slice(0, here.length).join('.') === here.join('.'));
      const kept: Row[] = [];
      for (const child of candidates) {
        if (!own.every((f) => pass(child, f.op, f.path[f.path.length - 1], f.v))) continue;
        const out: Row = e.cols.includes('*') ? { ...child } : Object.fromEntries(e.cols.map((c) => [c, child[c]]));
        let drop = false;
        for (const k of e.children) {
          const r = buildEmbed(rel.table, child, k, here);
          if (r.exclude) { drop = true; break; }
          out[k.name] = r.value;
        }
        if (!drop) kept.push(out);
      }
      const value = toMany ? kept : kept[0] ?? null;
      const empty = toMany ? kept.length === 0 : value === null;
      return { value, exclude: e.inner && empty };
    }

    function settle() {
      if (insertPayload !== null) {
        const rows = Array.isArray(insertPayload) ? insertPayload : [insertPayload];
        for (const r of rows) { const c = checkCols(table, Object.keys(r)); if (c) return err('42703', c); }
        const stored = rows.map((r, i) => ({ id: r.id ?? `${table}-${(data[table] ?? []).length + i + 1}`, ...r }));
        (data[table] ??= []).push(...stored);
        calls.push({ table, op: 'insert', payload: stored[0] });
        return { data: Array.isArray(insertPayload) ? stored : stored[0], count: null, error: null };
      }
      const v = validateTree(table, sel.cols, sel.embeds);
      if (v) return err(v.code, v.msg);
      for (const f of filters) if (f.path.length === 1) { const c = checkCols(table, [f.path[0]]); if (c) return err('42703', c); }
      for (const o of orders) { const c = checkCols(table, [o]); if (c) return err('42703', c); }
      // a filter on an embedded column must name a column that exists on that embedded table
      for (const f of filters.filter((x) => x.path.length > 1)) {
        let t = table;
        for (const seg of f.path.slice(0, -1)) { const rel = relation(t, seg); if (!rel) return err('PGRST200', `no relationship ${t}.${seg}`); t = rel.table; }
        const c = checkCols(t, [f.path[f.path.length - 1]]); if (c) return err('42703', c);
      }
      let rows: Row[] = [];
      for (const r of data[table] ?? []) {
        if (!filters.filter((f) => f.path.length === 1).every((f) => pass(r, f.op, f.path[0], f.v))) continue;
        const out: Row = sel.cols.includes('*') ? { ...r } : Object.fromEntries(sel.cols.map((c) => [c, r[c]]));
        let keep = true;
        for (const e of sel.embeds) {
          const b = buildEmbed(table, r, e, []);
          if (b.exclude) { keep = false; break; }
          out[e.name] = b.value;
        }
        if (keep) rows.push(out);
      }
      const count = rows.length;
      if (range) rows = rows.slice(range[0], range[1] + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      calls.push({ table, op: 'select' });
      return { data: rows, count: wantCount ? count : null, error: null };
    }
    q.maybeSingle = async () => { const r: any = settle(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; };
    q.single = async () => {
      const r: any = settle();
      if (r.error) return r;
      if (Array.isArray(r.data)) return r.data.length === 1 ? { ...r, data: r.data[0] } : { data: null, error: { code: 'PGRST116', message: 'not a single row' } };
      return r;
    };
    q.then = (ok: any, ko: any) => Promise.resolve(settle()).then(ok, ko);
    return q;
  }
  return { from, calls };
}
