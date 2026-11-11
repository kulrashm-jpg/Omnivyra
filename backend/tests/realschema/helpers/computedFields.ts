/**
 * PostgREST computed fields for the real-schema SQL transports.
 *
 * PostgREST resolves a select item that is not a column of the table as a computed
 * field when `public.<name>(public.<table>)` exists, and calls it with the row. The
 * harness transports render the select list as raw SQL, so without this a computed
 * field (e.g. `read_at`, migration 20270202000000) reached Postgres as a column and
 * failed with 42703 "column read_at does not exist", although real PostgREST serves it.
 *
 * Rules (same as PostgREST): a bare identifier that IS a column passes through; one
 * that is not a column but has a one-argument function over the table's row type is
 * rendered `to_json(public."<name>"("<table>")) AS "<name>"`; anything else passes through
 * unchanged, so an unknown name still fails exactly as before (42703).
 *
 * The value goes through to_json because PostgREST builds its response with to_json: a
 * timestamptz arrives as PostgREST sends it (ISO, microseconds kept, "+00:00" under the UTC
 * server zone), NOT as node-pg Date -> toISOString ("Z", milliseconds), which would lose the
 * sub-millisecond part of a database instant.
 */
type Queryable = { query: Function };

const columnCache = new Map<string, Set<string>>();
const computedCache = new Map<string, boolean>();

export async function selectList(client: Queryable, table: string, cols: string): Promise<string> {
  const t = (cols ?? '').trim();
  if (t === '' || t === '*') return t || '*';
  let known = columnCache.get(table);
  if (!known) {
    const r = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
    known = new Set<string>((r.rows as Array<{ column_name: unknown }>).map((x) => String(x.column_name)));
    columnCache.set(table, known);
  }
  const out: string[] = [];
  for (const raw of t.split(',')) {
    const name = raw.trim();
    if (!/^[a-z_][a-z0-9_]*$/.test(name) || known.has(name)) { out.push(name); continue; }
    const key = `${table}.${name}`;
    let isComputed = computedCache.get(key);
    if (isComputed === undefined) {
      const r = await client.query(`SELECT to_regprocedure($1) IS NOT NULL AS ok`, [`public.${name}(public.${table})`]);
      isComputed = (r.rows as Array<{ ok: unknown }>)[0]?.ok === true;
      computedCache.set(key, isComputed);
    }
    out.push(isComputed ? `to_json(public."${name}"("${table}")) AS "${name}"` : name);
  }
  return out.join(', ');
}
