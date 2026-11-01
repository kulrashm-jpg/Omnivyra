/**
 * Prospect provenance — the deploy-gate contract around the schema-parity
 * manifest change (prospect_source_contributions, source_records provenance
 * columns, lead_intelligence, and the active_leads REPLACE/RETIRE disposition).
 *
 * WHAT THIS PINS
 *   1. The verifier still has exactly ONE exit-0 path — proven at RUNTIME, not
 *      only by the source regex in schemaParityVerifierContract: the real script
 *      is executed against a stubbed `pg` module, and only a fully present
 *      schema with a clean ledger exits 0.
 *   2. An unrelated missing INFO column still exits 3, and the predeploy-check
 *      strict branch still turns 3 into 1 (the predeploy schema block is
 *      executed with a stubbed execSync — no git, no network, no database).
 *   3. No global severity downgrade: every manifest entry outside the
 *      active_leads block is byte-for-byte the severity it was at 09a2cf49.
 *   4. The ledger classifier and its three historical version-map exceptions
 *      are unchanged (content hash + structural pin + verifier wiring).
 *   5. The manifest carries the new provenance and lead_intelligence entries.
 *
 * HOW THE RUNTIME STUB WORKS. A preload module (written to a temp dir) replaces
 * `require('pg')` with a fake Client that answers the verifier's three queries
 * (information_schema.columns, pg_index, schema_migrations) from a JSON spec.
 * The connection string points at 127.0.0.1:1 and SUPABASE_URL/KEY are
 * placeholders, so `.env.local` is never loaded and no socket is ever opened —
 * the fake Client never connects to anything.
 *
 * ORCH-STACK (orchestration-engine-adapters verifier). The verifier also pins
 * its session read-only and reads an ORCH-STACK catalog (roles, table RLS and
 * privileges, functions, triggers, CHECKs), and folds STACK_* columns/indexes/
 * types into its manifests at load. The stub answers those queries ONLY from
 * the spec — never from the verifier's manifest — so every stack check is
 * actually evaluated (the "ORCH-STACK fixture" block below fails if the stub
 * is made to answer a conforming catalog regardless of the spec). The
 * provenance expectations above stay exact on the LITERAL manifest; the stack
 * is pinned separately by literal counts and names (ORCH_STACK_PIN).
 */
import { execFileSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';

const REPO = path.resolve(__dirname, '../../..');
const VERIFIER = path.join(REPO, 'scripts', 'verify-schema-parity.js');
const PREDEPLOY = path.join(REPO, 'scripts', 'predeploy-check.js');
const LEDGER_LIB = path.join(REPO, 'scripts', 'lib', 'migrationLedger.js');

const verifierSource = fs.readFileSync(VERIFIER, 'utf8');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { HISTORICAL_VERSION_MAP } = require('../../../scripts/lib/migrationLedger');

type Severity = 'BLOCKING' | 'WARN' | 'INFO';
interface ColumnReq { severity: Severity; table: string; column: string; motivation: string }
interface IndexReq { severity: Severity; table: string; index: string; unique: boolean; partial: boolean; keys: string[] }
interface TypeReq { severity: Severity; table: string; column: string; udtName: string }

/** Evaluates one manifest array literal from the verifier source (pure data, no code). */
function manifestArray<T>(name: string): T[] {
  const start = verifierSource.indexOf(`const ${name} = [`);
  expect(start).toBeGreaterThan(-1);
  const end = verifierSource.indexOf('\n];', start);
  expect(end).toBeGreaterThan(start);
  const literal = verifierSource.slice(start + `const ${name} = `.length, end + 2);
  return vm.runInNewContext(`(${literal})`, {}) as T[];
}

const COLUMNS = manifestArray<ColumnReq>('REQUIRED_COLUMNS');
const INDEXES = manifestArray<IndexReq>('REQUIRED_INDEXES');
const TYPES = manifestArray<TypeReq>('REQUIRED_COLUMN_TYPES');

// ─── ORCH-STACK: independent pins (literals — NOT derived from the verifier) ─
// A shrink of the literal provenance manifest and a shrink of the stack are
// detected separately: checked_* must equal literal + these numbers.
const ORCH_STACK_PIN = {
  tables: 20, columns: 228 /* 221 table columns + 7 added */, types: 5,
  indexes: 48, uniqueIndexes: 18, functions: 29, triggers: 19, checks: 7,
} as const;
const ORCH_STACK_TABLE_NAMES = [
  'prospect_lists', 'prospect_list_members', 'prospect_campaigns', 'workflows', 'workflow_versions',
  'execution_instances', 'execution_plans', 'execution_plan_steps', 'execution_tasks',
  'outreach_bridge_handoffs', 'execution_engine_requests', 'email_outreach_content_evidence',
  'execution_journey_decisions', 'prospect_campaign_lists',
  'prospect_campaign_targets', 'community_action_journey_links', 'rpa_auth_token_redemptions',
  'identity_verification_attestations', 'engagement_request_idempotency', 'rpa_session_invalidation_audit',
];

interface StackFn { name: string; args: string; secdef: boolean; exec?: string; bodyContains?: string[] }
// The verifier module, required ONLY to build the conforming fixture and to
// prove the fold leaves the literal entries untouched. Never used by the stub.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RUNTIME = require(VERIFIER) as {
  REQUIRED_COLUMNS: ColumnReq[]; REQUIRED_INDEXES: IndexReq[]; REQUIRED_COLUMN_TYPES: TypeReq[];
  STACK_TABLES: Array<{ table: string; columns: string[]; serviceRoleGrants?: string[] }>;
  STACK_ADDED_COLUMNS: Array<{ table: string; column: string }>;
  STACK_COLUMN_TYPES: Array<{ table: string; column: string; udtName: string }>;
  STACK_INDEXES: Array<IndexReq & { predicate?: string[] }>;
  STACK_FUNCTIONS: StackFn[];
  STACK_TRIGGERS: Array<{ table: string; trigger: string; fn: string }>;
  STACK_CHECKS: Array<{ table: string; constraint: string; contains: string[] }>;
};

const sevOf = (table: string, column: string): Severity | undefined =>
  COLUMNS.find((c) => c.table === table && c.column === column)?.severity;

// ─── Runtime harness ────────────────────────────────────────────────────────

const STUB_SOURCE = `
const Module = require('module');
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.env.PI_PROV_GATE_SPEC, 'utf8'));
class Client {
  async connect() {}
  async end() {}
  async query(sql, params) {
    // Session pin: the verifier refuses to run unless read-only took effect.
    if (sql.startsWith('SET default_transaction_read_only = on')) return { rows: [] };
    if (sql.includes("current_setting('transaction_read_only')")) {
      return { rows: [{ role: 'pi_prov_stub', tx_read_only: 'on' }] };
    }
    // ORCH-STACK catalog — answered from spec.stack ONLY, filtered by the
    // names the verifier asks for, exactly like the real catalog would be.
    const st = spec.stack;
    if (sql.includes('FROM pg_roles')) {
      return { rows: params[0].filter((r) => st.roles.includes(r)).map((rolname) => ({ rolname })) };
    }
    if (sql.includes('has_table_privilege')) {
      const rows = [];
      for (const t of st.tables) {
        if (!params[0].includes(t.relname)) continue;
        for (const role of params[1]) for (const priv of params[2]) {
          rows.push({ relname: t.relname, relrowsecurity: t.relrowsecurity, rolname: role, priv,
            granted: (t.priv[role] || []).includes(priv) });
        }
      }
      return { rows };
    }
    if (sql.includes('relrowsecurity FROM pg_class')) {
      return { rows: st.tables.filter((t) => params[0].includes(t.relname))
        .map((t) => ({ relname: t.relname, relrowsecurity: t.relrowsecurity })) };
    }
    if (sql.includes('FROM pg_proc')) return { rows: st.functions.filter((f) => params[0].includes(f.proname)) };
    if (sql.includes('FROM pg_trigger')) return { rows: st.triggers.filter((t) => params[0].includes(t.tgname)) };
    if (sql.includes('FROM pg_constraint')) return { rows: st.checks.filter((c) => params[0].includes(c.conname)) };
    if (sql.includes('information_schema.columns')) {
      const t = new Set(params[0]);
      return { rows: spec.columns.filter((r) => t.has(r.table_name)) };
    }
    if (sql.includes('pg_index')) {
      const n = new Set(params[0]);
      return { rows: spec.indexes.filter((r) => n.has(r.index_name)) };
    }
    if (sql.includes('schema_migrations')) {
      if (spec.ledgerError) throw new Error(spec.ledgerError);
      return { rows: spec.ledger };
    }
    throw new Error('unexpected query in pi-prov gate stub: ' + sql.slice(0, 80));
  }
}
const load = Module._load;
Module._load = function (request) {
  if (request === 'pg') return { Client };
  return load.apply(this, arguments);
};
`;

let tmpDir: string;
let stubPath: string;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-prov-gate-'));
  stubPath = path.join(tmpDir, 'pg-stub.js');
  fs.writeFileSync(stubPath, STUB_SOURCE);
});
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface Spec {
  columns: Array<{ table_name: string; column_name: string; data_type: string; udt_name: string }>;
  indexes: Array<{ table_name: string; index_name: string; is_unique: boolean; is_partial: boolean; definition: string }>;
  ledger: Array<{ version: string; name: string; statements_md5: string }>;
  ledgerError?: string;
  stack: StackCatalog;
}

/** The ORCH-STACK catalog the stub serves (shapes of the verifier's catalog queries). */
interface StackCatalog {
  roles: string[];
  tables: Array<{ relname: string; relrowsecurity: boolean; priv: Record<string, string[]> }>;
  functions: Array<{ proname: string; args: string; prosecdef: boolean; def: string;
    anon: boolean; authenticated: boolean; service_role: boolean; public_exec: boolean }>;
  triggers: Array<{ relname: string; tgname: string; tgenabled: string; proname: string }>;
  checks: Array<{ relname: string; conname: string; def: string }>;
}

/** A conforming ORCH-STACK catalog: RLS on, client roles hold nothing, service_role may act. */
function conformingStack(): StackCatalog {
  return {
    roles: ['anon', 'authenticated', 'service_role'],
    tables: RUNTIME.STACK_TABLES.map((t) => ({
      relname: t.table, relrowsecurity: true,
      priv: { anon: [], authenticated: [], service_role: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
    })),
    functions: RUNTIME.STACK_FUNCTIONS.map((f) => ({
      proname: f.name, args: f.args, prosecdef: f.secdef,
      def: `CREATE OR REPLACE FUNCTION public.${f.name}(${f.args}) AS $$ ${(f.bodyContains ?? []).join(' ')} $$`,
      anon: false, authenticated: false, service_role: true, public_exec: false,
    })),
    triggers: RUNTIME.STACK_TRIGGERS.map((t) => ({ relname: t.table, tgname: t.trigger, tgenabled: 'O', proname: t.fn })),
    checks: RUNTIME.STACK_CHECKS.map((c) => ({ relname: c.table, conname: c.constraint, def: `CHECK (${c.contains.join(' ')})` })),
  };
}

/** A database on which every manifest requirement holds and the ledger is clean. */
function fullSchema(): Spec {
  const allTypes = [...TYPES, ...RUNTIME.STACK_COLUMN_TYPES];
  const udt = (t: string, c: string) => allTypes.find((x) => x.table === t && x.column === c)?.udtName ?? 'text';
  const stackColumns = [
    ...RUNTIME.STACK_TABLES.flatMap((t) => t.columns.map((column) => ({ table: t.table, column }))),
    ...RUNTIME.STACK_ADDED_COLUMNS.map((c) => ({ table: c.table, column: c.column })),
  ];
  const indexDef = (i: IndexReq & { predicate?: string[] }) =>
    `CREATE ${i.unique ? 'UNIQUE ' : ''}INDEX ${i.index} ON public.${i.table} USING btree (${i.keys.join(', ')})`
    + `${i.partial ? ` WHERE (${(i.predicate ?? ['predicate']).join(' AND ')})` : ''}`;
  return {
    columns: [...COLUMNS, ...stackColumns].map((c) => ({
      table_name: c.table, column_name: c.column, data_type: udt(c.table, c.column), udt_name: udt(c.table, c.column),
    })),
    indexes: [...INDEXES, ...RUNTIME.STACK_INDEXES].map((i) => ({
      table_name: i.table,
      index_name: i.index,
      is_unique: i.unique,
      is_partial: i.partial,
      definition: indexDef(i),
    })),
    stack: conformingStack(),
    // The three historical version-map exceptions, recorded exactly as production has them.
    ledger: (HISTORICAL_VERSION_MAP as Array<{ recorded_version: string; recorded_name: string; recorded_statements_md5: string }>)
      .map((e) => ({ version: e.recorded_version, name: e.recorded_name, statements_md5: e.recorded_statements_md5 })),
  };
}

const without = (spec: Spec, pred: (table: string, column: string) => boolean): Spec => ({
  ...spec, columns: spec.columns.filter((r) => !pred(r.table_name, r.column_name)),
});

interface VerifierRun { code: number; check: Record<string, any> | null; stderr: string }

let specSeq = 0;
function runVerifier(spec: Spec): VerifierRun {
  const specPath = path.join(tmpDir, `spec-${specSeq++}.json`);
  fs.writeFileSync(specPath, JSON.stringify(spec));
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, ['-r', stubPath, VERIFIER], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PI_PROV_GATE_SPEC: specPath,
        // Unreachable by construction, and never dialled: `pg` is the stub.
        SUPABASE_POOLER_DB_URL: 'postgresql://stub:stub@127.0.0.1:1/stub',
        SUPABASE_DB_URL: '',
        DATABASE_URL: '',
        // Present so loadEnvLocal() returns before ever opening .env.local.
        SUPABASE_URL: 'https://placeholder.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'ci-hermetic-placeholder-service-role-key',
      },
    });
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    code = typeof err.status === 'number' ? err.status : -1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }
  const line = stdout.split('\n').find((l) => l.includes('"schema_parity.check"'));
  return { code, check: line ? JSON.parse(line) : null, stderr };
}

/**
 * Executes predeploy-check.js's schema-parity block in isolation: the source
 * between the "Verifying schema parity" banner and the render-parity gate, with
 * execSync replaced by a stub that "exits" with the given verifier code.
 */
function runPredeploySchemaBlock(verifierExit: number, strict: boolean):
  { exit: number | null; unverified: string[]; out: string; commands: string[] } {
  const src = fs.readFileSync(PREDEPLOY, 'utf8');
  const start = src.indexOf('process.stdout.write(`Verifying schema parity against production DB');
  const end = src.indexOf('// ── Render parity gate', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const block = src.slice(start, end);

  class ExitSignal { constructor(public code: number) {} }
  const commands: string[] = [];
  let out = '';
  const unverified: string[] = [];
  const context = {
    // The block require()s the verifier for predeployParityDecision. Only that
    // one module is resolvable — still no git, no network, no database.
    require: (p: string) => {
      if (path.resolve(p) !== path.resolve(VERIFIER)) throw new Error(`predeploy block may not require ${p}`);
      return require(VERIFIER);
    },
    path,
    __dirname: path.dirname(PREDEPLOY),
    unverified,
    execSync: (cmd: string) => {
      commands.push(cmd);
      if (verifierExit !== 0) {
        const e = new Error(`verifier exited ${verifierExit}`) as Error & { status: number };
        e.status = verifierExit;
        throw e;
      }
      return '';
    },
    process: {
      env: strict ? { PREDEPLOY_STRICT_SCHEMA: '1' } : {},
      stdout: { write: (s: string) => { out += s; return true; } },
      exit: (code: number) => { throw new ExitSignal(code); },
    },
  };
  try {
    vm.runInNewContext(block, context);
    return { exit: null, unverified, out, commands };
  } catch (e) {
    if (e instanceof ExitSignal) return { exit: e.code, unverified, out, commands };
    throw e;
  }
}

// ─── 1 + 2. Exit-code contract at runtime ───────────────────────────────────

describe('verify-schema-parity — runtime exit contract (stubbed pg, no database)', () => {
  it('exits 0 for a fully present schema with a clean ledger — and reports status ok', () => {
    const r = runVerifier(fullSchema());
    expect(r.code).toBe(0);
    expect(r.check).not.toBeNull();
    expect(r.check!.status).toBe('ok');
    expect(r.check!.missing_count).toBe(0);
    expect(r.check!.ledger_desync_detected).toBe(false);
    // The three historical exceptions were exercised and accepted.
    expect(r.check!.ledger_probe.recorded_by_version_map).toHaveLength(3);
    // Literal provenance manifest, exactly, PLUS the independently pinned stack.
    expect(r.check!.checked_columns).toBe(COLUMNS.length + ORCH_STACK_PIN.columns);
    expect(r.check!.checked_indexes).toBe(INDEXES.length + ORCH_STACK_PIN.indexes);
  });

  it('an unrelated missing WARN workflow column still exits 3 (status WARN, never ok)', () => {
    const r = runVerifier(without(fullSchema(), (t, c) => t === 'opportunity_dispositions' && c === 'snoozed_until'));
    expect(r.code).toBe(3);
    expect(r.check!.status).toBe('WARN');
    expect(r.check!.severity).toEqual({ blocking: 0, warn: 1, info: 0 });
  });

  it('a missing lead_intelligence provenance column is a WARN finding → exit 3', () => {
    const r = runVerifier(without(fullSchema(), (t, c) => t === 'lead_intelligence' && c === 'source_table'));
    expect(r.code).toBe(3);
    expect(r.check!.status).toBe('WARN');
  });

  it('an unapplied provenance migration (table + source_records columns absent) BLOCKS → exit 1', () => {
    const spec = without(fullSchema(), (t, c) =>
      t === 'prospect_source_contributions'
      || (t === 'source_records' && ['source_category', 'platform', 'source_url'].includes(c)));
    spec.indexes = spec.indexes.filter((i) => i.table_name !== 'prospect_source_contributions');
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(r.check!.status).toBe('BLOCKING');
    const missing = (r.check!.missing_columns as Array<{ table: string; column: string; severity: string }>);
    expect(missing.filter((m) => m.table === 'prospect_source_contributions')).toHaveLength(9);
    expect(missing.filter((m) => m.table === 'source_records')).toHaveLength(3);
    expect(missing.every((m) => m.severity === 'BLOCKING')).toBe(true);
    const structural = (r.check!.structural_findings as Array<{ index: string }>).map((s) => s.index).sort();
    expect(structural).toEqual(['uq_psc_one_originating_per_lead', 'uq_psc_org_lead_external_ref']);
  });

  it('a single missing source_records.source_category is BLOCKING on its own', () => {
    const r = runVerifier(without(fullSchema(), (t, c) => t === 'source_records' && c === 'source_category'));
    expect(r.code).toBe(1);
  });

  it('a NON-partial one-originating index is a BLOCKING structural finding', () => {
    const spec = fullSchema();
    const idx = spec.indexes.find((i) => i.index_name === 'uq_psc_one_originating_per_lead')!;
    idx.is_partial = false;
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(r.check!.structural_findings[0].reason).toMatch(/NOT PARTIAL/);
  });

  it('a non-unique idempotency index is a BLOCKING structural finding', () => {
    const spec = fullSchema();
    spec.indexes.find((i) => i.index_name === 'uq_psc_org_lead_external_ref')!.is_unique = false;
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(r.check!.structural_findings[0].reason).toMatch(/NOT UNIQUE/);
  });

  it('ledger drift (orphan row) alone exits 3, never 0', () => {
    const spec = fullSchema();
    spec.ledger.push({ version: '20990101000000', name: 'ghost', statements_md5: '0'.repeat(32) });
    const r = runVerifier(spec);
    expect(r.code).toBe(3);
    expect(r.check!.ledger_desync_detected).toBe(true);
  });

  it('a historical exception whose recorded fingerprint changed alone exits 3', () => {
    const spec = fullSchema();
    spec.ledger[0].statements_md5 = 'f'.repeat(32);
    const r = runVerifier(spec);
    expect(r.code).toBe(3);
    expect(r.check!.ledger_probe.version_map_violations).toHaveLength(1);
  });

  it('an unreadable ledger is never clean: exits 3, never 0', () => {
    const r = runVerifier({ ...fullSchema(), ledgerError: 'permission denied for schema supabase_migrations' });
    expect(r.code).toBe(3);
    expect(r.check!.ledger_probe.verified).toBe(false);
  });

  it('production before 20270108000000 (only opportunity_dispositions.snoozed_until absent) exits 3, not 0', () => {
    // Owner decision D-4 (2026-10-30): snooze is opportunity-level and its carrier
    // is opportunity_dispositions.snoozed_until. Until that migration is applied
    // the column is a WARN finding; the manifest no longer expects anything on
    // the legacy-name-colliding active_leads table.
    expect(COLUMNS.filter((c) => c.table === 'active_leads')).toEqual([]);
    const r = runVerifier(without(fullSchema(), (t, c) => t === 'opportunity_dispositions' && c === 'snoozed_until'));
    expect(r.code).toBe(3);
    expect(r.check!.severity).toEqual({ blocking: 0, warn: 1, info: 0 });
  });

  it('only the fully present + clean-ledger case ever exits 0 across every scenario above', () => {
    // The source-level pin: exactly one process.exit(0), behind the one condition.
    const code = verifierSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
    expect(code.match(/process\.exit\(0\)/g) ?? []).toHaveLength(1);
    expect(code).toMatch(/missing\.length === 0 && !ledgerDesyncDetected[\s\S]{0,200}process\.exit\(0\)/);
  });
});

describe('predeploy-check — strict schema mode maps the verifier exit codes (stubbed execSync)', () => {
  it('invokes the verifier script, nothing else', () => {
    expect(runPredeploySchemaBlock(0, false).commands).toEqual(['node scripts/verify-schema-parity.js']);
  });

  it('exit 3 + PREDEPLOY_STRICT_SCHEMA=1 → exit 1 (BLOCKED)', () => {
    const r = runPredeploySchemaBlock(3, true);
    expect(r.exit).toBe(1);
    expect(r.out).toMatch(/RESULT: BLOCKED/);
  });

  it('exit 3 without strict → continues, recorded as unverified (never a pass)', () => {
    const r = runPredeploySchemaBlock(3, false);
    expect(r.exit).toBeNull();
    expect(r.unverified).toEqual(['schema parity WARN (non-blocking findings or ledger desync)']);
  });

  it.each([true, false])('exit 1 blocks regardless of strict (strict=%s)', (strict) => {
    expect(runPredeploySchemaBlock(1, strict).exit).toBe(1);
  });

  it('exit 2 + strict → exit 1; without strict → unverified SKIPPED', () => {
    expect(runPredeploySchemaBlock(2, true).exit).toBe(1);
    const lax = runPredeploySchemaBlock(2, false);
    expect(lax.exit).toBeNull();
    expect(lax.unverified[0]).toMatch(/SKIPPED/);
  });

  it('exit 0 is the only clean pass', () => {
    const r = runPredeploySchemaBlock(0, true);
    expect(r.exit).toBeNull();
    expect(r.unverified).toEqual([]);
    expect(r.out).toMatch(/schema parity: OK/);
  });

  it('end to end: an unrelated WARN finding → verifier 3 → strict predeploy 1', () => {
    const v = runVerifier(without(fullSchema(), (t, c) => t === 'opportunity_dispositions' && c === 'snoozed_until'));
    expect(v.code).toBe(3);
    expect(runPredeploySchemaBlock(v.code, true).exit).toBe(1);
  });
});

// ─── ORCH-STACK fixture: evaluated, never assumed ───────────────────────────
// Every test here FAILS if the stub is made tautological (answers a conforming
// catalog from the verifier's own manifest regardless of the spec), and the
// pins fail if either manifest shrinks without this file changing.

describe('ORCH-STACK — independent pins and a non-tautological fake catalog', () => {
  const kinds = (r: VerifierRun) => (r.check!.structural_findings as Array<{ kind: string; object: string | null }>)
    .map((f) => `${f.kind}:${f.object}`);

  it('the stub never consults the verifier module (answers come from the spec only)', () => {
    expect(STUB_SOURCE).not.toMatch(/verify-schema-parity|PI_PROV_GATE_VERIFIER|STACK_/);
    expect(STUB_SOURCE).toMatch(/const st = spec\.stack;/);
  });

  it('stack manifest sizes equal the literal pins (a shrink is a reviewed change)', () => {
    expect(RUNTIME.STACK_TABLES.map((t) => t.table)).toEqual(ORCH_STACK_TABLE_NAMES);
    expect(RUNTIME.STACK_TABLES).toHaveLength(ORCH_STACK_PIN.tables);
    expect(RUNTIME.STACK_TABLES.reduce((n, t) => n + t.columns.length, 0) + RUNTIME.STACK_ADDED_COLUMNS.length)
      .toBe(ORCH_STACK_PIN.columns);
    expect(RUNTIME.STACK_COLUMN_TYPES).toHaveLength(ORCH_STACK_PIN.types);
    expect(RUNTIME.STACK_INDEXES).toHaveLength(ORCH_STACK_PIN.indexes);
    expect(RUNTIME.STACK_INDEXES.filter((i) => i.unique)).toHaveLength(ORCH_STACK_PIN.uniqueIndexes);
    expect(RUNTIME.STACK_FUNCTIONS).toHaveLength(ORCH_STACK_PIN.functions);
    expect(RUNTIME.STACK_TRIGGERS).toHaveLength(ORCH_STACK_PIN.triggers);
    expect(RUNTIME.STACK_CHECKS).toHaveLength(ORCH_STACK_PIN.checks);
  });

  it('the runtime fold appends the stack AFTER the literal entries and changes none of them', () => {
    expect(RUNTIME.REQUIRED_COLUMNS.slice(0, COLUMNS.length)).toEqual(COLUMNS);
    expect(RUNTIME.REQUIRED_INDEXES.slice(0, INDEXES.length)).toEqual(INDEXES);
    expect(RUNTIME.REQUIRED_COLUMN_TYPES.slice(0, TYPES.length)).toEqual(TYPES);
    expect(RUNTIME.REQUIRED_COLUMNS).toHaveLength(COLUMNS.length + ORCH_STACK_PIN.columns);
    expect(RUNTIME.REQUIRED_INDEXES).toHaveLength(INDEXES.length + ORCH_STACK_PIN.indexes);
    expect(RUNTIME.REQUIRED_COLUMN_TYPES).toHaveLength(TYPES.length + ORCH_STACK_PIN.types);
  });

  it('a clean run reports every stack dimension it checked', () => {
    const r = runVerifier(fullSchema());
    expect(r.code).toBe(0);
    expect(r.check!.checked_column_types).toBe(TYPES.length + ORCH_STACK_PIN.types);
    expect(r.check!.checked_stack).toEqual({
      tables: ORCH_STACK_PIN.tables, functions: ORCH_STACK_PIN.functions,
      triggers: ORCH_STACK_PIN.triggers, check_constraints: ORCH_STACK_PIN.checks,
    });
    expect(r.check!.session).toEqual({ role: 'pi_prov_stub', tx_read_only: 'on' });
  });

  it('an EMPTY stack catalog (migrations unapplied) is BLOCKING, never a pass', () => {
    const spec = fullSchema();
    spec.stack = { roles: ['anon', 'authenticated', 'service_role'], tables: [], functions: [], triggers: [], checks: [] };
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(r.check!.status).toBe('BLOCKING');
    const k = kinds(r);
    expect(k.filter((x) => x.startsWith('function:'))).toHaveLength(ORCH_STACK_PIN.functions);
    expect(k.filter((x) => x.startsWith('trigger:'))).toHaveLength(ORCH_STACK_PIN.triggers);
    expect(k.filter((x) => x.startsWith('check_constraint:'))).toHaveLength(ORCH_STACK_PIN.checks);
  });

  it('a stack column absent (outreach_bridge_handoffs.person_id) is BLOCKING', () => {
    const r = runVerifier(without(fullSchema(), (t, c) => t === 'outreach_bridge_handoffs' && c === 'person_id'));
    expect(r.code).toBe(1);
    expect(r.check!.missing_columns).toEqual([
      expect.objectContaining({ severity: 'BLOCKING', table: 'outreach_bridge_handoffs', column: 'person_id' }),
    ]);
  });

  it('RLS disabled on a stack table is BLOCKING', () => {
    const spec = fullSchema();
    spec.stack.tables.find((t) => t.relname === 'outreach_bridge_handoffs')!.relrowsecurity = false;
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual(['table_rls:outreach_bridge_handoffs']);
  });

  it('authenticated holding a privilege on a REVOKE-ALL stack table is BLOCKING', () => {
    const spec = fullSchema();
    spec.stack.tables.find((t) => t.relname === 'execution_engine_requests')!.priv.authenticated = ['SELECT'];
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual(['table_privilege:execution_engine_requests']);
  });

  it('service_role lacking an explicit GRANT is BLOCKING', () => {
    const spec = fullSchema();
    spec.stack.tables.find((t) => t.relname === 'rpa_auth_token_redemptions')!.priv.service_role = ['SELECT', 'INSERT'];
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual(['table_privilege:rpa_auth_token_redemptions']);
  });

  it('the unsafe reaper body (status = \'failed\') is BLOCKING', () => {
    const spec = fullSchema();
    const f = spec.stack.functions.find((x) => x.proname === 'reap_community_ai_action_leases')!;
    f.def += " UPDATE x SET status = 'failed'";
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual(['function_body:reap_community_ai_action_leases()']);
  });

  it('a disabled guard trigger is BLOCKING', () => {
    const spec = fullSchema();
    spec.stack.triggers.find((t) => t.tgname === 'trg_outreach_bridge_handoffs_guard')!.tgenabled = 'D';
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual(['trigger:trg_outreach_bridge_handoffs_guard']);
  });

  it("a CHECK vocabulary lacking 'uncertain' is BLOCKING", () => {
    const spec = fullSchema();
    const c = spec.stack.checks.find((x) => x.conname === 'community_ai_actions_status_check')!;
    c.def = c.def.replace("'uncertain'", '');
    const r = runVerifier(spec);
    expect(r.code).toBe(1);
    expect(kinds(r)).toEqual(['check_constraint:community_ai_actions_status_check']);
  });
});

// ─── 3. No global severity downgrade ─────────────────────────────────────────

/**
 * Every REQUIRED_COLUMNS entry at origin/main 09a2cf49 OUTSIDE the 19-entry
 * active_leads block (18 active_leads.* + opportunity_feed_items.active_lead_id),
 * by table: B = BLOCKING, W = WARN. Generated from the manifest at 09a2cf49 by
 * evaluating its array literal. A change here is a severity decision and must be
 * argued in the same commit — it is never a side effect of the provenance work.
 */
const BASELINE_09A2CF49: Record<string, { B?: string[]; W?: string[] }> = {
  bolt_execution_runs: { B: ['lock_owner', 'lock_acquired_at', 'lock_expires_at', 'heartbeat_at', 'raw_error_message', 'error_stack', 'failed_stage', 'abandonment_reason', 'abandonment_detected_at'], W: ['cancel_requested', 'cancel_requested_at', 'cancel_requested_by', 'failed_after_ms', 'pipeline_mode', 'campaign_type'] },
  queue_jobs: { B: ['result_data', 'error_code'] },
  scheduled_posts: { B: ['idempotency_key'] },
  opportunity_feed_items: { W: ['signal_excerpt'] },
  content: { W: ['company_id', 'content_type', 'lifecycle_status'] },
  content_variant: { W: ['content_id', 'platform', 'approval_state'] },
  content_revision: { W: ['content_id', 'snapshot'] },
  content_asset: { W: ['content_id', 'asset_id'] },
  content_memory: { W: ['company_id', 'exact_hash', 'simhash'] },
  content_originality: { W: ['company_id', 'decision'] },
  brand_memory: { W: ['company_id'] },
  content_quality: { W: ['company_id', 'dimensions'] },
  content_block: { W: ['content_id', 'block_type'] },
  content_recommendation: { W: ['content_id', 'category'] },
  content_approval_history: { W: ['content_id', 'to_status'] },
  content_performance: { W: ['company_id', 'content_id'] },
  publication_lineage: { W: ['company_id', 'event_type'] },
  learning_intelligence: { W: ['company_id', 'pattern_key'] },
  learning_memory: { W: ['model_version'] },
  content_prediction: { W: ['company_id', 'explanation'] },
  unified_persons: { B: ['company_id', 'account_id', 'job_title', 'department', 'seniority', 'authority', 'influence', 'buying_role'], W: ['full_name', 'first_name', 'last_name', 'country_code', 'region', 'city', 'timezone', 'attributes_source', 'attributes_updated_at'] },
  prospect_accounts: { B: ['organization_id'], W: ['industry', 'employee_count', 'employee_band', 'description', 'attributes_source', 'attributes_updated_at', 'annual_revenue', 'revenue_band', 'founded_year', 'technologies', 'funding_stage', 'last_funding_at', 'market', 'business_model', 'growth_stage'] },
  canonical_leads: { B: ['company_id', 'unified_person_id', 'source', 'created_at', 'external_lead_key', 'qualification_score'] },
  source_assertions: { B: ['organization_id', 'attribute', 'normalized_value', 'superseded_at'], W: ['applied_to_canonical_at', 'applied_reason'] },
  source_records: { B: ['organization_id', 'ingestion_run_id'], W: ['payload_hash', 'observation_count'] },
  prospect_icps: { B: ['organization_id', 'icp_key'] },
  prospect_icp_versions: { B: ['organization_id', 'icp_id', 'version', 'status', 'criteria'], W: ['proposal', 'proposed_by_model', 'ratified_at', 'ratified_by', 'superseded_at', 'superseded_by_version'] },
  contact_governance_records: { B: ['organization_id', 'person_id', 'target_normalized', 'revoked_at'], W: ['governance_type', 'effective_until'] },
  person_duplicate_candidates: { W: ['organization_id', 'classification', 'matched_on', 'status'] },
  identity_claims: { W: ['organization_id', 'normalized_value', 'platform', 'revoked_at'] },
  prospect_enrichment_attempts: { W: ['organization_id', 'requested_attributes', 'correlation_id', 'claimed_by', 'claimed_until', 'provider_call_state', 'execution_status', 'next_retry_at', 'source_record_id', 'attributes_returned'] },
  outreach_tasks: { B: ['company_id', 'person_id', 'channel', 'delivery_status'] },
  outreach_outcomes: { B: ['company_id', 'task_id', 'outcome_type', 'derived', 'occurred_at', 'source', 'provider', 'provider_event_id'], W: ['metadata'] },
  outreach_decisions: { W: ['person_id', 'identity_anchor', 'identity_degraded'] },
  prospect_lifecycle_transitions: { B: ['organization_id', 'prospect_id', 'seq', 'state', 'previous_state', 'is_initial', 'transitioned_at', 'origin', 'evidence_kind'], W: ['evidence_outcome_id', 'evidence_source_record_id', 'evidence_detail', 'source_event_key', 'actor_user_id', 'reasoning', 'model_version'] },
  outreach_approvals: { B: ['company_id', 'task_id'], W: ['decided_at', 'decision'] },
  outreach_attempts: { B: ['company_id', 'task_id', 'started_at'], W: ['attempt_number'] },
  outreach_delivery_evidence: { B: ['company_id', 'task_id'], W: ['observed_at', 'delivery_status'] },
  engagement_threads: { B: ['organization_id', 'unified_person_id', 'contact_id', 'platform'] },
  engagement_messages: { B: ['thread_id', 'direction'] },
  contacts: { B: ['organization_id', 'unified_person_id'] },
  lead_signals: { B: ['organization_id', 'source_type', 'thread_id', 'contact_id'] },
  integration_credentials: { W: ['company_id', 'provider_key'] },
};

const BASELINE_ENTRIES: Array<[string, string, Severity]> = Object.entries(BASELINE_09A2CF49).flatMap(
  ([table, s]) => [
    ...(s.B ?? []).map((c) => [table, c, 'BLOCKING'] as [string, string, Severity]),
    ...(s.W ?? []).map((c) => [table, c, 'WARN'] as [string, string, Severity]),
  ],
);

/** Entries added by the provenance programme (this change). */
const PSC_BLOCKING = ['organization_id', 'canonical_lead_id', 'contribution_role', 'source_category',
  'external_ref', 'observed_at', 'contact_id', 'platform', 'opportunity_feed_item_id'];
const SOURCE_RECORDS_NEW = ['source_category', 'platform', 'source_url'];
const LEAD_INTELLIGENCE_WARN = ['company_id', 'dedupe_key', 'source', 'source_table', 'source_id', 'occurred_at', 'unified_person_id'];
/** Workstream E (20270108000001): privacy tombstones — erasure fails closed without them. */
const PSC_REDACTIONS_BLOCKING = ['organization_id', 'contribution_id', 'reason', 'values_sha256'];
/** Workstream E (20270108000001): per-tenant MarketPulse observations — fail-open writer. */
const MP_OBSERVATIONS_WARN = ['company_id', 'signal_id', 'observation_key', 'observed_at'];
/** Closure A (20270109000000): erasure audit events — erasure fails closed without them. */
const CLOSURE_A_ENTRIES: Array<[string, string, Severity]> = [
  ['prospect_provenance_erasures', 'organization_id', 'BLOCKING'],
  ['prospect_provenance_erasures', 'subject_kind', 'BLOCKING'],
  ['prospect_provenance_erasures', 'reason', 'BLOCKING'],
  ['prospect_provenance_erasures', 'requested_by', 'BLOCKING'],
  ['prospect_provenance_erasures', 'table_counts', 'BLOCKING'],
];
/** closure-B (20270109000001): prospect aliases — fail-open reconciliation writer and reader. */
const CLOSURE_B_ENTRIES: Array<[string, string, Severity]> = [
  ['prospect_aliases', 'organization_id', 'WARN'],
  ['prospect_aliases', 'alias_lead_id', 'WARN'],
  ['prospect_aliases', 'survivor_lead_id', 'WARN'],
  ['prospect_aliases', 'reason', 'WARN'],
];
/**
 * No active_leads expectation is pending any more: owner decision D-4
 * (2026-10-30) made snooze opportunity-level, carried by
 * opportunity_dispositions.snoozed_until (20270108000000).
 */
const ACTIVE_LEADS_PENDING: string[] = [];
/** closure C (enrichment/scoring): listProspects' scoring-marker read + fail-open enrichment applicability reads. */
const CLOSURE_C_ENTRIES: Array<[string, string, Severity]> = [
  ['canonical_leads', 'lead_metadata', 'BLOCKING'],
  ['source_records', 'account_id', 'WARN'],
  ['person_account_relationships', 'organization_id', 'WARN'],
  ['person_account_relationships', 'person_id', 'WARN'],
  ['person_account_relationships', 'account_id', 'WARN'],
  ['person_account_relationships', 'ended_at', 'WARN'],
];
/** Workflow fields that live per opportunity in the opportunity workflow tables. */
const ACTIVE_LEADS_TO_LIFECYCLE: Array<[string, string, string]> = [
  ['opportunity_type', 'opportunity_feed_items', 'opportunity_type'],
  ['status', 'opportunity_lifecycle_states', 'state'],
  ['status_changed_at', 'opportunity_lifecycle_states', 'transitioned_at'],
  ['status_changed_by', 'opportunity_lifecycle_states', 'actor_user_id'],
  ['owner_user_id', 'opportunity_assignments', 'assigned_to_user_id'],
  ['snoozed_until', 'opportunity_dispositions', 'snoozed_until'],
];
/**
 * Closure-D (20270109000003): no column entry — the migration adds triggers
 * and FKs only, which a column probe cannot see. Its one manifest addition is
 * the index uq_opp_assignment_one_active (pinned below).
 */
const CLOSURE_D_ENTRIES: string[] = [];
const ACTIVE_LEADS_RETIRED = ['intent_score', 'icp_score', 'confidence_score', 'total_score', 'signal_count', 'last_seen_at', 'last_activity_at', 'company_name'];
const ACTIVE_LEADS_REPLACED = ['organization_id', 'contact_id', 'source_platforms', 'first_seen_at'];

describe('manifest — no global severity downgrade', () => {
  it('pins 196 baseline entries (84 BLOCKING + 112 WARN) outside the active_leads block', () => {
    expect(BASELINE_ENTRIES).toHaveLength(196);
    expect(BASELINE_ENTRIES.filter((e) => e[2] === 'BLOCKING')).toHaveLength(84);
  });

  it.each(BASELINE_ENTRIES)('%s.%s keeps severity %s', (table, column, severity) => {
    expect(sevOf(table, column)).toBe(severity);
  });

  it('every entry outside active_leads is either a baseline entry or a named provenance addition', () => {
    const allowedNew = new Set([
      ...PSC_BLOCKING.map((c) => `prospect_source_contributions.${c}`),
      ...SOURCE_RECORDS_NEW.map((c) => `source_records.${c}`),
      ...LEAD_INTELLIGENCE_WARN.map((c) => `lead_intelligence.${c}`),
      ...ACTIVE_LEADS_TO_LIFECYCLE.map(([, t, c]) => `${t}.${c}`),
      ...PSC_REDACTIONS_BLOCKING.map((c) => `prospect_source_contribution_redactions.${c}`),
      ...MP_OBSERVATIONS_WARN.map((c) => `marketpulse_signal_observations.${c}`),
      ...CLOSURE_D_ENTRIES,
      ...CLOSURE_A_ENTRIES.map(([t, c]) => `${t}.${c}`),
      ...CLOSURE_C_ENTRIES.map(([t, c]) => `${t}.${c}`),
      ...CLOSURE_B_ENTRIES.map(([t, c]) => `${t}.${c}`),
    ]);
    const baseline = new Set(BASELINE_ENTRIES.map(([t, c]) => `${t}.${c}`));
    const unexpected = COLUMNS
      .filter((c) => c.table !== 'active_leads')
      .map((c) => `${c.table}.${c.column}`)
      .filter((k) => !baseline.has(k) && !allowedNew.has(k));
    expect(unexpected).toEqual([]);
  });

  it.each(CLOSURE_C_ENTRIES)('closure C: %s.%s is pinned at %s', (table, column, severity) => {
    expect(sevOf(table, column)).toBe(severity);
  });

  it('closure C: canonical_leads.qualification_score stays BLOCKING (existence-only; nullability is a migration postcondition)', () => {
    expect(sevOf('canonical_leads', 'qualification_score')).toBe('BLOCKING');
  });

  it('no manifest key is listed twice', () => {
    const keys = COLUMNS.map((c) => `${c.table}.${c.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('INFO is used by no entry now that the last pending active_leads entry (snoozed_until) is decided', () => {
    const info = COLUMNS.filter((c) => c.severity === 'INFO').map((c) => `${c.table}.${c.column}`).sort();
    expect(info).toEqual(ACTIVE_LEADS_PENDING.map((c) => `active_leads.${c}`).sort());
    expect(info).toEqual([]);
  });

  it('baseline structural entries (indexes, declared types) are unchanged', () => {
    for (const [index, table, partial] of [
      ['uq_source_records_tenant_identity', 'source_records', false],
      ['uq_source_assertions_dedupe', 'source_assertions', false],
      ['uq_contact_governance_identity', 'contact_governance_records', true],
    ] as Array<[string, string, boolean]>) {
      const i = INDEXES.find((x) => x.index === index);
      expect(i).toMatchObject({ severity: 'BLOCKING', table, unique: true, partial });
    }
    expect(TYPES).toEqual([
      expect.objectContaining({ severity: 'BLOCKING', table: 'source_records', column: 'ingestion_run_id', udtName: 'text' }),
    ]);
    expect(INDEXES).toHaveLength(6);
  });

  it('closure-D adds no column entry and exactly one index: uq_opp_assignment_one_active (BLOCKING, unique, partial)', () => {
    expect(CLOSURE_D_ENTRIES).toEqual([]);
    const start = verifierSource.indexOf('// ── closure-D (lifecycle governance) ──');
    const colEnd = verifierSource.indexOf('// ── end closure-D ──', start);
    expect(start).toBeGreaterThan(-1);
    expect(verifierSource.slice(start, colEnd)).not.toMatch(/severity:/);
    expect(INDEXES.filter((i) => i.table.startsWith('opportunity_'))).toEqual([
      expect.objectContaining({
        severity: 'BLOCKING', table: 'opportunity_assignments', index: 'uq_opp_assignment_one_active',
        unique: true, partial: true, keys: ['opportunity_feed_item_id', 'role'],
      }),
    ]);
  });
});

// ─── active_leads disposition ────────────────────────────────────────────────

describe('manifest — active_leads REPLACE / RETIRE / pending disposition', () => {
  it.each(ACTIVE_LEADS_REPLACED)('active_leads.%s is REPLACED (no longer expected on active_leads)', (column) => {
    expect(sevOf('active_leads', column)).toBeUndefined();
  });

  it('opportunity_feed_items.active_lead_id is REPLACED by prospect_source_contributions.opportunity_feed_item_id', () => {
    expect(sevOf('opportunity_feed_items', 'active_lead_id')).toBeUndefined();
    expect(sevOf('prospect_source_contributions', 'opportunity_feed_item_id')).toBe('BLOCKING');
  });

  it.each([
    ['organization_id', 'organization_id'],
    ['contact_id', 'contact_id'],
    ['source_platforms', 'platform'],
    ['first_seen_at', 'observed_at'],
  ])('active_leads.%s maps onto prospect_source_contributions.%s at BLOCKING', (_from, to) => {
    expect(sevOf('prospect_source_contributions', to)).toBe('BLOCKING');
  });

  it.each(ACTIVE_LEADS_RETIRED)('active_leads.%s is RETIRED', (column) => {
    expect(sevOf('active_leads', column)).toBeUndefined();
  });

  it('the retirement carries its evidence note in the verifier source', () => {
    for (const needle of [
      'RETIRED (8)',
      '0 rows and 0',
      'no runtime writer',
      'never returned a row',
      'never applied in production',
      'prospect_score_evaluations.score_intent',
      'prospect_accounts.name',
      'false greens',
    ]) {
      expect(verifierSource).toContain(needle);
    }
  });

  it.each(ACTIVE_LEADS_TO_LIFECYCLE)('active_leads.%s is REPLACED by %s.%s at WARN', (from, table, column) => {
    expect(sevOf('active_leads', from)).toBeUndefined();
    expect(sevOf(table, column)).toBe('WARN');
  });

  it('active_leads.snoozed_until is DECIDED (D-4): carried by opportunity_dispositions.snoozed_until, not active_leads', () => {
    expect(sevOf('active_leads', 'snoozed_until')).toBeUndefined();
    const entry = COLUMNS.find((c) => c.table === 'opportunity_dispositions' && c.column === 'snoozed_until');
    expect(entry).toMatchObject({ severity: 'WARN' });
    expect(entry!.motivation).toContain('20270108000000');
    expect(verifierSource).toContain('DECIDED (owner, 2026-10-30; lifecycle doc D-4)');
    expect(fs.existsSync(path.join(REPO, 'supabase', 'migrations', '20270108000000_pi_opportunity_snooze.sql'))).toBe(true);
  });

  it('accounts for all 19 original expectations exactly once', () => {
    expect(ACTIVE_LEADS_REPLACED.length + 1 + ACTIVE_LEADS_RETIRED.length
      + ACTIVE_LEADS_TO_LIFECYCLE.length + ACTIVE_LEADS_PENDING.length).toBe(19);
  });
});

// ─── 4. Ledger classifier unchanged ──────────────────────────────────────────

describe('ledger classifier — unchanged by the provenance work', () => {
  it('scripts/lib/migrationLedger.js content is byte-identical to 09a2cf49 (LF-normalised sha256)', () => {
    const digest = crypto.createHash('sha256')
      .update(fs.readFileSync(LEDGER_LIB, 'utf8').replace(/\r\n/g, '\n'))
      .digest('hex');
    expect(digest).toBe('d2a698492f8c2d2c1204f5dc1397562b41227ac0b4aad99127d047785e547507');
  });

  it('keeps exactly the three historical version-map exceptions from PR #361', () => {
    expect(Object.isFrozen(HISTORICAL_VERSION_MAP)).toBe(true);
    expect((HISTORICAL_VERSION_MAP as Array<Record<string, string>>).map((e) => [e.recorded_version, e.file, e.file_sha256, e.recorded_statements_md5]))
      .toEqual([
        ['20260525141657', '20260807_thread_title_column.sql', 'f8bdc653ad942db5ffc60c1a1dced03841a933da3acb7c825bde8e8714600d36', '606a5a58a42249b8829c5b94f29a2863'],
        ['20260525223113', '20260808_thread_runtime_executions.sql', '2f73a30e8ab1566e029a64d87fb6d46aa8133c67597bc5e2d621b5f1e7262834', '20420cbdbe0c16b350356684ce03d750'],
        ['20260601022203', '20260676_fix_creator_execution_lock_ambiguous_columns.sql', '6fc42e4d51077f473ed37f534ef9a22337dbdbc9289c269dcf096f172a718741', '15917b525abe692758ff49b1b7210d30'],
      ]);
  });

  it('the verifier still wires the classifier verdict straight into the exit-0 condition', () => {
    expect(verifierSource).toContain("const { classifyLedger, HISTORICAL_VERSION_MAP } = require('./lib/migrationLedger');");
    expect(verifierSource).toContain('classifyLedger({ files, ledgerRows: ledgerRes.rows, fileDigests })');
    expect(verifierSource).toContain('ledgerDesyncDetected = c.attention;');
  });
});

// ─── 5. New entries present ─────────────────────────────────────────────────

describe('manifest — provenance and lead_intelligence coverage', () => {
  it.each(PSC_BLOCKING)('prospect_source_contributions.%s is BLOCKING', (column) => {
    expect(sevOf('prospect_source_contributions', column)).toBe('BLOCKING');
  });

  it.each(SOURCE_RECORDS_NEW)('source_records.%s is BLOCKING', (column) => {
    expect(sevOf('source_records', column)).toBe('BLOCKING');
  });

  it.each(LEAD_INTELLIGENCE_WARN)('lead_intelligence.%s is WARN (fail-open store)', (column) => {
    expect(sevOf('lead_intelligence', column)).toBe('WARN');
  });

  it.each(PSC_REDACTIONS_BLOCKING)('prospect_source_contribution_redactions.%s is BLOCKING (erasure fails closed)', (column) => {
    expect(sevOf('prospect_source_contribution_redactions', column)).toBe('BLOCKING');
  });

  it.each(MP_OBSERVATIONS_WARN)('marketpulse_signal_observations.%s is WARN (fail-open writer)', (column) => {
    expect(sevOf('marketpulse_signal_observations', column)).toBe('WARN');
  });

  it.each(CLOSURE_A_ENTRIES)('closure A: %s.%s is %s (erasure fails closed)', (table, column, severity) => {
    expect(sevOf(table, column)).toBe(severity);
  });

  it('closure A adds exactly its entries for prospect_provenance_erasures, inside its delimited block, and no index', () => {
    expect(COLUMNS.filter((c) => c.table === 'prospect_provenance_erasures')).toHaveLength(CLOSURE_A_ENTRIES.length);
    expect(INDEXES.some((i) => i.table === 'prospect_provenance_erasures')).toBe(false);
    const block = verifierSource.slice(verifierSource.indexOf('// ── closure-A (privacy) ──'),
      verifierSource.indexOf('// ── end closure-A ──'));
    for (const [, column] of CLOSURE_A_ENTRIES) expect(block).toContain(`column: '${column}'`);
  });

  it('workstream E adds exactly its 8 column entries and no index or type entry', () => {
    const mine = COLUMNS.filter((c) => c.table === 'prospect_source_contribution_redactions'
      || c.table === 'marketpulse_signal_observations');
    expect(mine).toHaveLength(PSC_REDACTIONS_BLOCKING.length + MP_OBSERVATIONS_WARN.length);
    expect(INDEXES.some((i) => i.table === 'prospect_source_contribution_redactions'
      || i.table === 'marketpulse_signal_observations')).toBe(false);
  });

  it.each(CLOSURE_B_ENTRIES)('closure-B: %s.%s is %s (fail-open alias store)', (table, column, severity) => {
    expect(sevOf(table, column)).toBe(severity);
  });

  it('closure-B adds exactly its 4 column entries, inside its marked block, and no index or type entry', () => {
    expect(COLUMNS.filter((c) => c.table === 'prospect_aliases')).toHaveLength(CLOSURE_B_ENTRIES.length);
    expect(INDEXES.some((i) => i.table === 'prospect_aliases')).toBe(false);
    expect(TYPES.some((t) => t.table === 'prospect_aliases')).toBe(false);
    const start = verifierSource.indexOf('// ── closure-B (identity/aliases) ──');
    const end = verifierSource.indexOf('// ── end closure-B ──');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = verifierSource.slice(start, end);
    for (const [t, c] of CLOSURE_B_ENTRIES) expect(block).toContain(`table: '${t}', column: '${c}'`);
  });

  it('requires both contract-named provenance indexes with the right uniqueness and partiality', () => {
    expect(INDEXES.find((i) => i.index === 'uq_psc_org_lead_external_ref')).toMatchObject({
      severity: 'BLOCKING', table: 'prospect_source_contributions', unique: true, partial: false,
      keys: ['organization_id', 'canonical_lead_id', 'external_ref'],
    });
    expect(INDEXES.find((i) => i.index === 'uq_psc_one_originating_per_lead')).toMatchObject({
      severity: 'BLOCKING', table: 'prospect_source_contributions', unique: true, partial: true,
    });
  });

  it('uses the names fixed by the provenance contract module', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PROVENANCE_DB } = require('../../../lib/prospectProvenance/contract');
    expect(COLUMNS.some((c) => c.table === PROVENANCE_DB.table)).toBe(true);
    expect(INDEXES.map((i) => i.index)).toEqual(
      expect.arrayContaining([PROVENANCE_DB.idempotencyConstraint, PROVENANCE_DB.oneOriginatingIndex]),
    );
  });

  it('still keeps a real WARN tier after the BLOCKING provenance additions', () => {
    const blocking = verifierSource.match(/severity:\s*'BLOCKING'/g) ?? [];
    const warn = verifierSource.match(/severity:\s*'WARN'/g) ?? [];
    expect(warn.length).toBeGreaterThan(blocking.length);
  });
});
