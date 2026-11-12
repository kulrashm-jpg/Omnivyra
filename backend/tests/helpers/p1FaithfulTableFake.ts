/**
 * Small FAITHFUL in-memory stand-in for the supabase-js query builder, used by
 * the P1 (GoTrue-bypass hardening) suites.
 *
 * Hostile by default: every filter in the chain is applied to the stored rows
 * (an unsupported filter THROWS instead of being ignored), unknown tables are
 * empty, and a read-error can be injected per table. Nothing defaults to an
 * "allowed" answer.
 */

type Row = Record<string, any>;
type Result = { data: any; error: { message: string; code?: string } | null };

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Inject an error for SELECTs on a table (writes unaffected). */
  failSelect: Record<string, { message: string; code?: string }>;
  /** Every operation issued, in order: `${op}:${table}`. */
  log: string[];
  client: { from: (table: string) => any; rpc: (fn: string, args?: unknown) => Promise<Result> };
}

let idSeq = 0;

function parseOr(expr: string): (r: Row) => boolean {
  const parts = expr.split(',').map((p) => p.trim()).filter(Boolean);
  const preds = parts.map((p) => {
    const m = /^([a-z_]+)\.eq\.(.*)$/.exec(p);
    if (!m) throw new Error(`fake: unsupported .or() clause ${p}`);
    const [, col, val] = m;
    return (r: Row) => String(r[col] ?? '') === val;
  });
  return (r) => preds.some((fn) => fn(r));
}

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables: JSON.parse(JSON.stringify(seed)),
    failSelect: {},
    log: [],
    client: null as any,
  };

  function from(table: string) {
    let op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
    let payload: any = null;
    let limitN: number | null = null;
    const filters: Array<(r: Row) => boolean> = [];

    const exec = async (mode: 'many' | 'maybe' | 'single'): Promise<Result> => {
      db.log.push(`${op}:${table}`);
      const rows = (db.tables[table] = db.tables[table] || []);
      let out: Row[];
      if (op === 'select') {
        const err = db.failSelect[table];
        if (err) return { data: null, error: err };
        out = rows.filter((r) => filters.every((f) => f(r)));
      } else if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((p) => ({
          id: p.id ?? `row-${++idSeq}`,
          ...p,
        }));
        rows.push(...list);
        out = list;
      } else if (op === 'update') {
        out = rows.filter((r) => filters.every((f) => f(r)));
        for (const r of out) Object.assign(r, payload);
      } else {
        throw new Error('fake: upsert not supported');
      }
      if (limitN !== null) out = out.slice(0, limitN);
      const copy = out.map((r) => ({ ...r }));
      if (mode === 'many') return { data: copy, error: null };
      if (copy.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } };
      if (mode === 'single' && copy.length === 0) {
        return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      }
      return { data: copy[0] ?? null, error: null };
    };

    const b: any = {
      select: () => b,
      insert: (p: any) => { op = 'insert'; payload = p; return b; },
      update: (p: any) => { op = 'update'; payload = p; return b; },
      upsert: () => { op = 'upsert'; return b; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
      neq: (c: string, v: unknown) => { filters.push((r) => r[c] !== v); return b; },
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b; },
      gt: (c: string, v: any) => { filters.push((r) => r[c] > v); return b; },
      or: (expr: string) => { filters.push(parseOr(expr)); return b; },
      order: () => b,
      limit: (n: number) => { limitN = n; return b; },
      maybeSingle: () => exec('maybe'),
      single: () => exec('single'),
      then: (res: any, rej: any) => exec('many').then(res, rej),
    };
    return b;
  }

  db.client = {
    from,
    rpc: async (fn: string) => {
      db.log.push(`rpc:${fn}`);
      return { data: false, error: null };
    },
  };
  return db;
}
