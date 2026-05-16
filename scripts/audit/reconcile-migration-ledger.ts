/**
 * Read-only migration-ledger reconciliation classifier.
 *
 * For every migration FILE not in supabase_migrations.schema_migrations,
 * extract the objects it CREATEs (tables / views / functions) and check
 * whether they already exist in production. Classify:
 *
 *   APPLIED   — every created object already exists  → safe to
 *               `supabase migration repair --status applied <v>`
 *   ABSENT    — no created object exists             → must be pushed
 *   PARTIAL   — some exist, some don't               → MANUAL REVIEW
 *   NO_DDL    — file creates no detectable object    → MANUAL REVIEW
 *               (ALTER/INSERT/policy-only; cannot infer from objects)
 *
 * Zero writes. Emits a reconciliation plan to stdout.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { buildBillingSchemaReport } from '../../backend/services/billing/bootstrap/billingSchemaSpec';

interface Obj { kind: 'table' | 'view' | 'function'; name: string }

function extractObjects(sql: string): Obj[] {
  const out: Obj[] = [];
  const norm = sql.replace(/\r/g, '');
  const push = (kind: Obj['kind'], name: string) => {
    const n = name.replace(/^public\./i, '').replace(/"/g, '').toLowerCase();
    if (n && !out.some(o => o.kind === kind && o.name === n)) out.push({ kind, name: n });
  };
  for (const m of norm.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/gi)) push('table', m[1]);
  for (const m of norm.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/gi)) push('view', m[1]);
  for (const m of norm.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-zA-Z0-9_."]+)\s*\(/gi)) push('function', m[1]);
  return out;
}

async function main() {
  await buildBillingSchemaReport().catch(() => {});
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!url) { console.error('NO SUPABASE_DB_URL'); process.exit(2); }
  const c = new Client({ connectionString: url });
  await c.connect();

  const led = await c.query(`SELECT version FROM supabase_migrations.schema_migrations;`);
  const applied = new Set<string>(led.rows.map(r => String(r.version)));

  const dir = path.resolve(__dirname, '..', '..', 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+.*\.sql$/.test(f)).sort();

  const relCache = new Map<string, boolean>();
  const fnCache = new Map<string, boolean>();
  async function relExists(n: string) {
    if (relCache.has(n)) return relCache.get(n)!;
    const r = await c.query(`SELECT to_regclass($1) IS NOT NULL AS e`, [`public.${n}`]);
    const e = !!r.rows[0].e; relCache.set(n, e); return e;
  }
  async function fnExists(n: string) {
    if (fnCache.has(n)) return fnCache.get(n)!;
    const r = await c.query(
      `SELECT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
        WHERE s.nspname='public' AND p.proname=$1) AS e`, [n]);
    const e = !!r.rows[0].e; fnCache.set(n, e); return e;
  }

  const plan = { APPLIED: [] as string[], ABSENT: [] as string[], PARTIAL: [] as string[], NO_DDL: [] as string[] };
  const detail: string[] = [];

  for (const f of files) {
    const version = f.split('_')[0];
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const objs = extractObjects(sql);
    if (objs.length === 0) { plan.NO_DDL.push(version); detail.push(`NO_DDL   ${f}`); continue; }
    let present = 0;
    const miss: string[] = [];
    for (const o of objs) {
      const ex = o.kind === 'function' ? await fnExists(o.name) : await relExists(o.name);
      if (ex) present++; else miss.push(`${o.kind}:${o.name}`);
    }
    let cls: keyof typeof plan;
    if (present === objs.length) cls = 'APPLIED';
    else if (present === 0) cls = 'ABSENT';
    else cls = 'PARTIAL';
    plan[cls].push(version);
    if (cls !== 'APPLIED') detail.push(`${cls.padEnd(8)} ${f}  missing=[${miss.join(', ')}]`);
  }
  await c.end();

  console.log('=== RECONCILIATION SUMMARY ===');
  console.log(`APPLIED (mark applied): ${plan.APPLIED.length}`);
  console.log(`ABSENT  (push):         ${plan.ABSENT.length}  -> ${plan.ABSENT.join(', ')}`);
  console.log(`PARTIAL (REVIEW):       ${plan.PARTIAL.length} -> ${plan.PARTIAL.join(', ')}`);
  console.log(`NO_DDL  (REVIEW):       ${plan.NO_DDL.length}`);
  console.log('\n=== NON-APPLIED DETAIL ===');
  for (const d of detail) console.log(d);
  console.log('\n=== REPAIR COMMANDS (APPLIED set) ===');
  console.log(plan.APPLIED.map(v => `supabase migration repair --status applied ${v}`).join('\n'));
  console.log('\n=== NO_DDL versions (decide per-file) ===');
  console.log(plan.NO_DDL.join(', '));
}
main().catch(e => { console.error('ERR', e?.message || e); process.exit(1); });
