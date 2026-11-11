/**
 * `scripts/verify-schema-parity.js` — ORCH-STACK manifest COVERAGE.
 *
 * The orchestration-engine-adapters release (20261127000000 and
 * 20261226000000 … 20261231000010) shipped with zero schema-parity coverage:
 * not one of its tables, indexes, functions or triggers was in the manifest,
 * so a database with the stack unapplied passed the gate. This test parses the
 * migration FILES and fails when an object they create is not in the manifest,
 * so coverage cannot silently fall behind the migrations again.
 *
 * No database, no network: the verifier exports its manifests and only
 * connects when executed directly.
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(REPO, 'supabase', 'migrations');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parity = require(path.join(REPO, 'scripts', 'verify-schema-parity.js'));

/** The release series: 20261127000000, 20261231000010, the GD-4 band 20270111100000 … 20270111100016, the journey decision record and the email content evidence. */
const inSeries = (f: string): boolean => {
  const m = f.match(/^(\d{14})_.*\.sql$/);
  if (!m) return false;
  const v = m[1];
  return v === '20261127000000' || v === '20270120000000' || v === '20270120000001' || v === '20270120000002' || (v >= '20270111100000' && v <= '20270111100016');
};

const seriesFiles = fs.readdirSync(MIGRATIONS).filter(inSeries).sort();

/** Full-line `--` comments removed; statements otherwise untouched. */
const stripComments = (sql: string): string =>
  sql.split('\n').map((l) => (/^\s*--/.test(l) ? '' : l.replace(/\s--\s.*$/, ''))).join('\n');

interface Inventory {
  tables: Map<string, { file: string; columns: string[] }>;
  addedColumns: Array<{ file: string; table: string; column: string }>;
  indexes: Array<{ file: string; index: string; unique: boolean; table: string }>;
  functions: Array<{ file: string; name: string; secdef: boolean }>;
  triggers: Array<{ file: string; trigger: string; table: string }>;
  rls: Set<string>;
  revokedFromAuthenticated: Set<string>;
}

function inventory(): Inventory {
  const inv: Inventory = {
    tables: new Map(), addedColumns: [], indexes: [], functions: [], triggers: [],
    rls: new Set(), revokedFromAuthenticated: new Set(),
  };
  for (const file of seriesFiles) {
    const sql = stripComments(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'));

    for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      const columns: string[] = [];
      for (const line of m[2].split('\n')) {
        const c = line.match(/^\s{2}([a-z_][a-z0-9_]*)\s+(uuid|text|integer|bigint|boolean|timestamptz|jsonb|double precision|smallint|numeric|date)\b/);
        if (c && !/^(constraint|check|primary|unique|foreign)$/i.test(c[1])) columns.push(c[1]);
      }
      inv.tables.set(m[1], { file, columns });
    }
    // ADD COLUMN, attributed to the ALTER TABLE it belongs to.
    for (const stmt of sql.split(';')) {
      const t = stmt.match(/ALTER TABLE public\.(\w+)/);
      if (!t) continue;
      for (const c of stmt.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)) {
        inv.addedColumns.push({ file, table: t[1], column: c[1] });
      }
    }
    for (const m of sql.matchAll(/CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON public\.(\w+)/g)) {
      inv.indexes.push({ file, index: m[2], unique: Boolean(m[1]), table: m[3] });
    }
    for (const m of sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\s*\([\s\S]*?\bAS \$\$/g)) {
      inv.functions.push({ file, name: m[1], secdef: /SECURITY DEFINER/.test(m[0]) });
    }
    for (const m of sql.matchAll(/CREATE (?:OR REPLACE )?TRIGGER (\w+)\s+[\s\S]*?\bON public\.(\w+)/g)) {
      inv.triggers.push({ file, trigger: m[1], table: m[2] });
    }
    for (const m of sql.matchAll(/ALTER TABLE public\.(\w+)\s+ENABLE ROW LEVEL SECURITY/g)) inv.rls.add(m[1]);
    for (const m of sql.matchAll(/REVOKE ALL ON (?:TABLE )?public\.(\w+) FROM ([^;']+)/g)) {
      if (/\bauthenticated\b/.test(m[2])) inv.revokedFromAuthenticated.add(m[1]);
    }
  }
  return inv;
}

const inv = inventory();

describe('ORCH-STACK — the migration series the manifest is checked against', () => {
  it('is exactly the 21 release migrations, and the verifier names the same list', () => {
    // 21: 20261231000010 is held out of S per 83 ruling 2026-11-11 (restored with RPA sealing).
    expect(seriesFiles).toHaveLength(21);
    expect(parity.STACK_MIGRATIONS).toEqual(seriesFiles);
  });

  it('parses a non-trivial inventory (an empty parse would pass every check below)', () => {
    expect(inv.tables.size).toBe(19);
    expect(inv.indexes.length).toBeGreaterThanOrEqual(45);
    expect(inv.functions.length).toBeGreaterThanOrEqual(27);
    expect(inv.triggers.length).toBe(19);
    expect(inv.addedColumns.length).toBeGreaterThanOrEqual(13);
    for (const t of inv.tables.values()) expect(t.columns.length).toBeGreaterThan(0);
  });
});

describe('ORCH-STACK — every object the series creates is in the manifest', () => {
  const manifestTables = new Map<string, any>(parity.STACK_TABLES.map((t: any) => [t.table, t]));
  const requiredColumns = new Set<string>(parity.REQUIRED_COLUMNS.map((r: any) => `${r.table}.${r.column}`));
  const requiredIndexes = new Map<string, any>(parity.REQUIRED_INDEXES.map((r: any) => [r.index, r]));
  const functionNames = new Map<string, any>(parity.STACK_FUNCTIONS.map((f: any) => [f.name, f]));
  const triggers = new Set<string>(parity.STACK_TRIGGERS.map((t: any) => `${t.table}.${t.trigger}`));

  it.each([...inv.tables.keys()])('table %s is a STACK_TABLES entry', (table) => {
    expect(manifestTables.has(table)).toBe(true);
  });

  it('every column of every created table is a REQUIRED_COLUMNS entry', () => {
    const absent: string[] = [];
    for (const [table, t] of inv.tables) {
      for (const c of t.columns) if (!requiredColumns.has(`${table}.${c}`)) absent.push(`${table}.${c} (${t.file})`);
    }
    expect(absent).toEqual([]);
  });

  it('every ADD COLUMN is a REQUIRED_COLUMNS entry', () => {
    const absent = inv.addedColumns
      .filter((a) => !requiredColumns.has(`${a.table}.${a.column}`))
      .map((a) => `${a.table}.${a.column} (${a.file})`);
    expect(absent).toEqual([]);
  });

  it('every created index is a REQUIRED_INDEXES entry on the right table, unique ones BLOCKING', () => {
    const problems: string[] = [];
    for (const ix of inv.indexes) {
      const r = requiredIndexes.get(ix.index);
      if (!r) { problems.push(`${ix.index} absent (${ix.file})`); continue; }
      if (r.table !== ix.table) problems.push(`${ix.index} table ${r.table} != ${ix.table}`);
      if (r.unique !== ix.unique) problems.push(`${ix.index} unique ${r.unique} != ${ix.unique}`);
      if (ix.unique && r.severity !== 'BLOCKING') problems.push(`${ix.index} unique but ${r.severity}`);
    }
    expect(problems).toEqual([]);
  });

  it('every created function is a STACK_FUNCTIONS entry with the declared SECURITY flag', () => {
    const problems: string[] = [];
    for (const f of inv.functions) {
      const m = functionNames.get(f.name);
      if (!m) { problems.push(`${f.name} absent (${f.file})`); continue; }
      if (m.secdef !== f.secdef) problems.push(`${f.name} secdef ${m.secdef} != ${f.secdef} (${f.file})`);
    }
    expect(problems).toEqual([]);
  });

  it('every created trigger is a STACK_TRIGGERS entry on the right table', () => {
    const absent = inv.triggers
      .filter((t) => !triggers.has(`${t.table}.${t.trigger}`))
      .map((t) => `${t.table}.${t.trigger} (${t.file})`);
    expect(absent).toEqual([]);
  });

  it('every created table enables RLS in its migration, and the manifest checks it', () => {
    for (const table of inv.tables.keys()) expect(inv.rls.has(table)).toBe(true);
  });

  it('revokesClientRoles matches the migrations (explicit REVOKE vs RLS-only)', () => {
    const mismatch: string[] = [];
    for (const [table] of inv.tables) {
      const m = manifestTables.get(table);
      if (m && m.revokesClientRoles !== inv.revokedFromAuthenticated.has(table)) mismatch.push(table);
    }
    expect(mismatch).toEqual([]);
    // 9 explicit-REVOKE tables (rpa_session_invalidation_audit held out of S); 10 rely on RLS only (authenticated → INFO).
    expect(parity.STACK_TABLES.filter((t: any) => t.revokesClientRoles)).toHaveLength(9);
    expect(parity.STACK_TABLES.filter((t: any) => !t.revokesClientRoles)).toHaveLength(10);
  });
});

describe('ORCH-STACK — safety properties are pinned, not just existence', () => {
  const fn = (name: string) => parity.STACK_FUNCTIONS.find((f: any) => f.name === name);

  it.each(['claim_community_ai_browser_command', 'record_community_ai_late_dispatch_result', 'reap_community_ai_action_leases'])(
    '%s is SECURITY DEFINER and service_role-only', (name) => {
      expect(fn(name).secdef).toBe(true);
      expect(fn(name).exec).toBe('service_role_only');
    });

  it('the reaper must write uncertain, never failed', () => {
    const r = fn('reap_community_ai_action_leases');
    expect(r.bodyContains).toEqual(expect.arrayContaining(["'uncertain'", "'DISPATCH_LEASE_EXPIRED'"]));
    expect(r.bodyForbidden.map((b: any) => b.pattern).join(' ')).toContain("'failed'");
  });

  it("publish_workflow_version must accept 'social_post'", () => {
    expect(fn('publish_workflow_version').bodyContains).toContain("'social_post'");
  });

  it('community_ai_actions_status_check pins the 12-value vocabulary incl. uncertain/executing', () => {
    const c = parity.STACK_CHECKS.find((x: any) => x.constraint === 'community_ai_actions_status_check');
    expect(c.contains).toHaveLength(12);
    expect(c.contains).toEqual(expect.arrayContaining(["'uncertain'", "'executing'"]));
  });

  it('the 20261231000009 re-run guard trigger is required', () => {
    expect(parity.STACK_TRIGGERS).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'community_ai_actions', trigger: 'trg_community_ai_actions_reap_uncertain_guard' }),
    ]));
  });

  it('severity is by rule: missing object / safety property BLOCKING, owner-pending INFO', () => {
    expect(parity.STACK_SEVERITY).toEqual({
      missingObject: 'BLOCKING', safetyProperty: 'BLOCKING', queryPlanIndex: 'WARN',
      invokerClientExecute: 'WARN', ownerPending: 'INFO',
    });
  });
});
