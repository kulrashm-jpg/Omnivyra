/**
 * Schema-parity STRICT mode — fails closed.
 *
 * Before: `predeploy-check.js` mapped verifier exit 2 (no credentials, refused
 * connection, a catalog query that threw) to "schema parity: SKIPPED (env
 * unavailable)" and CONTINUED even with PREDEPLOY_STRICT_SCHEMA=1, and the
 * verifier itself turned a ledger probe that could not run into a note on an
 * exit-0 run. "Could not check" read as success.
 *
 * After: with PREDEPLOY_STRICT_SCHEMA=1 the verifier runs with --strict and
 * EVERY non-zero exit blocks; under --strict a required check that cannot run
 * is a BLOCKING `check_skipped` finding. Non-strict behaviour is unchanged.
 *
 * No network and no real database: the verifier is executed against an
 * in-process fake `pg` (a `node -r` preload that answers the catalog queries
 * from the verifier's own manifest), and the predeploy gate SECTION is
 * executed in a vm with a stubbed execSync — git/tsc never run.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'verify-schema-parity.js');
const PREDEPLOY = path.join(REPO, 'scripts', 'predeploy-check.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parity = require(SCRIPT);

// ── fake pg (preload) ───────────────────────────────────────────────────────
// Answers every catalog query the verifier makes with a schema that satisfies
// the manifest, then applies the faults named in FAKE_PG (comma list):
//   connect_fail | stack_denied | ledger_fail | no_anon
const FAKE_PG = `
const Module = require('module');
const origLoad = Module._load;
const faults = new Set(String(process.env.FAKE_PG || '').split(',').filter(Boolean));
class Client {
  constructor() {}
  async connect() { if (faults.has('connect_fail')) throw new Error('connect ECONNREFUSED (fake)'); }
  async end() {}
  async query(sql, params) {
    const m = require(process.env.FAKE_PG_SCRIPT);
    if (sql.includes('information_schema.columns')) {
      const types = new Map(m.REQUIRED_COLUMN_TYPES.map((t) => [t.table + '.' + t.column, t.udtName]));
      return { rows: m.REQUIRED_COLUMNS.map((r) => ({ table_name: r.table, column_name: r.column,
        data_type: 'x', udt_name: types.get(r.table + '.' + r.column) || 'text' })) };
    }
    if (sql.includes('FROM pg_index')) {
      return { rows: m.REQUIRED_INDEXES.map((r) => ({ table_name: r.table, index_name: r.index,
        is_unique: r.unique, is_partial: r.partial,
        definition: 'CREATE ' + (r.unique ? 'UNIQUE ' : '') + 'INDEX ' + r.index + ' ON public.' + r.table
          + ' USING btree (' + r.keys.join(', ') + ')'
          + (r.partial ? ' WHERE (' + (r.predicate || ['revoked_at IS NULL']).join(' AND ') + ')' : '') })) };
    }
    if (sql.includes('FROM pg_roles')) {
      return { rows: params[0].filter((r) => !(faults.has('no_anon') && r === 'anon')).map((rolname) => ({ rolname })) };
    }
    if (sql.includes('has_table_privilege')) {
      const rows = [];
      for (const t of m.STACK_TABLES) for (const role of params[1]) for (const priv of params[2]) {
        rows.push({ relname: t.table, relrowsecurity: true, rolname: role, priv,
          granted: role === 'service_role' && (t.serviceRoleGrants || []).includes(priv) });
      }
      return { rows };
    }
    if (sql.includes('relrowsecurity FROM pg_class')) {
      return { rows: m.STACK_TABLES.map((t) => ({ relname: t.table, relrowsecurity: true })) };
    }
    if (sql.includes('FROM pg_proc')) {
      if (faults.has('stack_denied')) throw new Error('permission denied for function pg_get_functiondef (fake)');
      return { rows: m.STACK_FUNCTIONS.map((f) => ({ proname: f.name, args: f.args, prosecdef: f.secdef,
        def: 'CREATE OR REPLACE FUNCTION public.' + f.name + '() AS $$ ' + (f.bodyContains || []).join(' ') + ' $$',
        anon: false, authenticated: false, service_role: true, public_exec: false })) };
    }
    if (sql.includes('FROM pg_trigger')) {
      return { rows: m.STACK_TRIGGERS.map((t) => ({ relname: t.table, tgname: t.trigger, tgenabled: 'O', proname: t.fn })) };
    }
    if (sql.includes('FROM pg_constraint')) {
      return { rows: m.STACK_CHECKS.map((c) => ({ relname: c.table, conname: c.constraint, def: 'CHECK (' + c.contains.join(' ') + ')' })) };
    }
    if (sql.includes('schema_migrations')) {
      if (faults.has('ledger_fail')) throw new Error('permission denied for schema supabase_migrations (fake)');
      return { rows: [{ n: 100000 }] };
    }
    throw new Error('fake pg: unexpected query');
  }
}
Module._load = function (request) {
  if (request === 'pg') return { Client };
  return origLoad.apply(this, arguments);
};
`;

let tmp: string;
let preload: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-strict-'));
  preload = path.join(tmp, 'fake-pg.js');
  fs.writeFileSync(preload, FAKE_PG);
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

interface Run { code: number | null; stdout: string; stderr: string; check: any }

/**
 * Runs the verifier with a scrubbed env. SUPABASE_URL/SERVICE_ROLE_KEY are
 * dummies so loadEnvLocal() returns early and no .env file is ever read.
 */
function runVerifier(opts: { faults?: string; strict?: boolean; envStrict?: boolean; noDbUrl?: boolean }): Run {
  const env: Record<string, string> = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    SUPABASE_URL: 'http://127.0.0.1:9',
    SUPABASE_SERVICE_ROLE_KEY: 'dummy-test-only',
    FAKE_PG: opts.faults || '',
    FAKE_PG_SCRIPT: SCRIPT,
  };
  if (!opts.noDbUrl) env.SUPABASE_POOLER_DB_URL = 'postgresql://fake:fake@127.0.0.1:1/fake';
  if (opts.envStrict) env.SCHEMA_PARITY_STRICT = '1';
  const args = ['-r', preload, SCRIPT, ...(opts.strict ? ['--strict'] : [])];
  const r = spawnSync(process.execPath, args, { cwd: REPO, env, encoding: 'utf8', timeout: 60_000 });
  const line = (r.stdout || '').split('\n').find((l) => l.includes('"schema_parity.check"'));
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', check: line ? JSON.parse(line) : null };
}

describe('verify-schema-parity — strict mode (fake catalog, no network)', () => {
  it('a fully conforming catalog exits 0 in both modes and checks the stack', () => {
    const d = runVerifier({});
    expect(d.code).toBe(0);
    expect(d.check.strict).toBe(false);
    expect(d.check.checked_stack).toEqual({ tables: 18, functions: 27, triggers: 17, check_constraints: 7 });
    const s = runVerifier({ strict: true });
    expect(s.code).toBe(0);
    expect(s.check.strict).toBe(true);
  });

  it('SCHEMA_PARITY_STRICT=1 is equivalent to --strict', () => {
    const s = runVerifier({ envStrict: true, faults: 'ledger_fail' });
    expect(s.check.strict).toBe(true);
    expect(s.code).toBe(1);
  });

  it('a ledger probe that cannot run: non-strict unchanged (exit 0, note); strict BLOCKS (exit 1)', () => {
    const d = runVerifier({ faults: 'ledger_fail' });
    expect(d.code).toBe(0);
    expect(d.check.ledger_probe.skipped).toBe(true);
    const s = runVerifier({ strict: true, faults: 'ledger_fail' });
    expect(s.code).toBe(1);
    expect(s.check.structural_findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check_skipped', severity: 'BLOCKING', object: 'ledger probe' }),
    ]));
  });

  it('a privilege check that cannot run (role absent): non-strict WARN exit 3; strict BLOCKING exit 1', () => {
    const d = runVerifier({ faults: 'no_anon' });
    expect(d.code).toBe(3);
    expect(d.check.structural_findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check_skipped', severity: 'WARN', object: 'role anon' }),
    ]));
    const s = runVerifier({ strict: true, faults: 'no_anon' });
    expect(s.code).toBe(1);
    expect(s.check.structural_findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'check_skipped', severity: 'BLOCKING', object: 'role anon' }),
    ]));
  });

  it('permission denied on a stack catalog query is exit 2 (never a pass, never "absent")', () => {
    for (const strict of [false, true]) {
      const r = runVerifier({ strict, faults: 'stack_denied' });
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('stack_catalog_query_failed');
      expect(r.check).toBeNull();
    }
  });

  it('missing credentials and a failed connection are exit 2 in both modes', () => {
    for (const strict of [false, true]) {
      expect(runVerifier({ strict, noDbUrl: true }).code).toBe(2);
      expect(runVerifier({ strict, faults: 'connect_fail' }).code).toBe(2);
    }
  });
});

describe('predeployParityDecision — the predeploy contract', () => {
  const d = parity.predeployParityDecision;

  it('non-strict default is unchanged: 2 and 3 continue, 1 blocks', () => {
    expect(d(0, false).action).toBe('ok');
    expect(d(1, false).action).toBe('block');
    expect(d(2, false)).toEqual({ action: 'continue', reason: 'skipped_env_unavailable' });
    expect(d(3, false)).toEqual({ action: 'continue', reason: 'warn' });
    expect(d(7, false).action).toBe('continue');
  });

  it('strict fails closed: every non-zero exit blocks', () => {
    expect(d(0, true).action).toBe('ok');
    for (const code of [1, 2, 3, 7, 137]) expect(d(code, true).action).toBe('block');
    expect(d(2, true).reason).toBe('strict_env_unavailable');
  });

  it('isStrictMode honours --strict and SCHEMA_PARITY_STRICT=1 only', () => {
    expect(parity.isStrictMode(['--strict'], {})).toBe(true);
    expect(parity.isStrictMode([], { SCHEMA_PARITY_STRICT: '1' })).toBe(true);
    expect(parity.isStrictMode([], { SCHEMA_PARITY_STRICT: 'true' })).toBe(false);
    expect(parity.isStrictMode([], {})).toBe(false);
  });
});

/**
 * Executes ONLY the schema-parity section of predeploy-check.js (between its
 * BEGIN/END markers) with a stubbed execSync, so the real wiring — not a copy
 * of it — is what is tested.
 */
function runPredeploySection(verifierExit: number | null, strictEnv: boolean) {
  const src = fs.readFileSync(PREDEPLOY, 'utf8');
  const begin = src.indexOf('// ── BEGIN schema-parity gate');
  const end = src.indexOf('// ── END schema-parity gate');
  if (begin < 0 || end < 0) throw new Error('schema-parity gate markers not found');
  const section = src.slice(begin, end);
  const commands: string[] = [];
  let out = '';
  let exitCode: number | null = null;
  class Exit extends Error {}
  const sandbox = {
    require, path, __dirname: path.dirname(PREDEPLOY),
    execSync: (cmd: string) => {
      commands.push(cmd);
      if (verifierExit === 0) return '';
      const e: any = new Error('verifier failed');
      e.status = verifierExit;
      throw e;
    },
    process: {
      env: strictEnv ? { PREDEPLOY_STRICT_SCHEMA: '1' } : {},
      stdout: { write: (s: string) => { out += s; } },
      exit: (c: number) => { exitCode = c; throw new Exit(); },
    },
  };
  try {
    vm.runInNewContext(section, sandbox);
  } catch (e) {
    if (!(e instanceof Exit)) throw e;
  }
  return { exitCode, out, commands };
}

describe('predeploy-check.js schema-parity gate section (vm, stubbed execSync)', () => {
  it('strict: exit 2 (missing creds / connection) BLOCKS — no longer "SKIPPED"', () => {
    const r = runPredeploySection(2, true);
    expect(r.exitCode).toBe(1);
    expect(r.out).toContain('RESULT: BLOCKED');
    expect(r.out).not.toContain('SKIPPED');
    expect(r.commands[0]).toContain('--strict');
  });

  it('strict: exit 3 and unrecognised exits block; a verifier with no status blocks', () => {
    expect(runPredeploySection(3, true).exitCode).toBe(1);
    expect(runPredeploySection(9, true).exitCode).toBe(1);
    expect(runPredeploySection(null, true).exitCode).toBe(1);
  });

  it('non-strict default unchanged: exit 2 SKIPPED and continues; exit 3 WARN continues', () => {
    const r2 = runPredeploySection(2, false);
    expect(r2.exitCode).toBeNull();
    expect(r2.out).toContain('schema parity: SKIPPED (env unavailable)');
    expect(r2.commands[0]).not.toContain('--strict');
    const r3 = runPredeploySection(3, false);
    expect(r3.exitCode).toBeNull();
    expect(r3.out).toContain('schema parity: WARN');
  });

  it('exit 1 blocks in both modes; exit 0 passes in both', () => {
    expect(runPredeploySection(1, false).exitCode).toBe(1);
    expect(runPredeploySection(1, true).exitCode).toBe(1);
    expect(runPredeploySection(0, false).exitCode).toBeNull();
    expect(runPredeploySection(0, true).out).toContain('schema parity: OK (strict)');
  });
});

describe('evaluateStack — severity by rule', () => {
  const conforming = () => {
    const tables = new Map<string, any>();
    for (const t of parity.STACK_TABLES) {
      tables.set(t.table, { rls: true, priv: { anon: [], authenticated: [], service_role: t.serviceRoleGrants || [] } });
    }
    const functions = new Map<string, any>();
    for (const f of parity.STACK_FUNCTIONS) {
      functions.set(`${f.name}(${f.args})`, { secdef: f.secdef, def: (f.bodyContains || []).join(' '),
        exec: { anon: false, authenticated: false, service_role: true, public: false } });
    }
    const triggers = new Map<string, any>(parity.STACK_TRIGGERS.map((t: any) => [`${t.table}.${t.trigger}`, { enabled: 'O', fn: t.fn }]));
    const checks = new Map<string, any>(parity.STACK_CHECKS.map((c: any) => [`${c.table}.${c.constraint}`, c.contains.join(' ')]));
    return { roles: new Set(['anon', 'authenticated', 'service_role']), tables, functions, triggers, checks };
  };

  it('a conforming catalog yields no findings and no advisories', () => {
    expect(parity.evaluateStack(conforming(), true)).toEqual({ findings: [], advisories: [] });
  });

  it('authenticated on an RLS-only table is INFO (advisory), on a REVOKE table BLOCKING', () => {
    const o = conforming();
    o.tables.get('prospect_lists').priv.authenticated = ['SELECT'];
    o.tables.get('engagement_request_idempotency').priv.authenticated = ['SELECT'];
    const r = parity.evaluateStack(o, false);
    expect(r.advisories).toEqual([expect.objectContaining({ table: 'prospect_lists', severity: 'INFO' })]);
    expect(r.findings).toEqual([expect.objectContaining({ table: 'engagement_request_idempotency', severity: 'BLOCKING' })]);
  });

  it('PUBLIC execute on a SECURITY DEFINER RPC is BLOCKING; on an invoker RPC WARN', () => {
    const o = conforming();
    o.functions.get('claim_community_ai_browser_command(uuid, uuid, text, text, integer)').exec.public = true;
    o.functions.get('advance_execution_plan(uuid, uuid)').exec.public = true;
    const sev = Object.fromEntries(parity.evaluateStack(o, false).findings.map((f: any) => [f.object, f.severity]));
    expect(sev['claim_community_ai_browser_command(uuid, uuid, text, text, integer)']).toBe('BLOCKING');
    expect(sev['advance_execution_plan(uuid, uuid)']).toBe('WARN');
  });
});
