/**
 * Governed verification infrastructure: the Node real-schema runner, the
 * vercel.crons check and the verification-registry additions.
 *
 * Hermetic: the runner is driven through an injected process executor (no
 * Docker, no Postgres, no network); the cron check runs against in-memory
 * fixtures and the real vercel.json / allowlist (read-only).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runner = require('../../../scripts/ci/real-schema-ci.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crons = require('../../../scripts/ci/check-vercel-crons.js');
import { loadRegistry } from '../../../scripts/jev-flow/registry';

const REPO = path.resolve(__dirname, '../../..');
const LEDGER = '20260916000000';
/** A managed-host URL built at runtime (never credential-shaped in source). */
const managedUrl = (host: string) => ['postgres:', '', ['user', 'placeholder'].join(':') + '@' + host + ':5432', 'postgres'].join('/');

// ================================================================ runner — pure helpers

describe('real-schema-ci.js — pure helpers', () => {
  it('parseArgs: --replay-only, patterns, unknown flags, and the two together', () => {
    expect(runner.parseArgs([])).toMatchObject({ replayOnly: false, patterns: [], error: null });
    expect(runner.parseArgs(['--replay-only'])).toMatchObject({ replayOnly: true, error: null });
    expect(runner.parseArgs(['backend/tests/realschema/(pi_|b2_)'])).toMatchObject({ patterns: ['backend/tests/realschema/(pi_|b2_)'], error: null });
    expect(runner.parseArgs(['--bogus']).error).toMatch(/unknown option/);
    expect(runner.parseArgs(['--replay-only', 'x']).error).toMatch(/no jest patterns/);
  });

  it('migrationsToReplay: only 14-digit versions strictly newer than the ledger, sorted', () => {
    const files = [
      '20261031000000_pi_score.sql',
      `${LEDGER}_at_ledger.sql`,
      '20260915000000_older.sql',
      '20260917000000_newer.sql',
      '20250101_legacy_8digit.sql',
      '20270101_legacy_8digit_sorts_after_ledger.sql', // legacy names are skipped even when they compare "newer"
      '20261101000000_notes.md',
      'rollbacks',
      '_identity_spine_phase2b',
    ];
    expect(runner.migrationsToReplay(files, LEDGER)).toEqual(['20260917000000_newer.sql', '20261031000000_pi_score.sql']);
    expect(() => runner.migrationsToReplay(files, '2026')).toThrow(/ledgerMax/);
  });

  it('classifyRestoreErrors: only "already exists" collisions are tolerated', () => {
    const r = runner.classifyRestoreErrors(['psql:x:1: ERROR:  schema "auth" already exists', 'NOTICE: x', 'psql:x:9: ERROR:  syntax error at or near "foo"'].join('\n'));
    expect(r.errors).toBe(2);
    expect(r.unexpected).toEqual(['psql:x:9: ERROR:  syntax error at or near "foo"']);
    expect(runner.classifyRestoreErrors('').unexpected).toEqual([]);
  });

  it('parseBaselineMeta validates tables and ledgerMax', () => {
    expect(runner.parseBaselineMeta(JSON.stringify({ tables: 823, ledgerMax: LEDGER }))).toEqual({ tables: 823, ledgerMax: LEDGER });
    expect(() => runner.parseBaselineMeta(JSON.stringify({ tables: 0, ledgerMax: LEDGER }))).toThrow(/tables/);
    expect(() => runner.parseBaselineMeta(JSON.stringify({ tables: 5, ledgerMax: 'x' }))).toThrow(/ledgerMax/);
  });

  it('dbConfig refuses a managed Supabase host and defaults to a disposable container', () => {
    for (const url of [managedUrl('db.abcdef.supabase.co'), managedUrl('aws-0-example.pooler.supabase.com')]) {
      expect(() => runner.dbConfig({ W6_DB_URL: url })).toThrow(/managed Supabase host/);
    }
    expect(runner.dbConfig({})).toEqual({ mode: 'container', image: 'pgvector/pgvector:pg17', container: 'w6-real-schema', port: '5433', keep: false });
    expect(runner.dbConfig({ W6_DB_URL: 'postgres://postgres:w6@127.0.0.1:5433/w6' })).toEqual({ mode: 'url', url: 'postgres://postgres:w6@127.0.0.1:5433/w6' });
  });

  it('psqlInvocation: strict adds ON_ERROR_STOP, loose does not', () => {
    const c = runner.dbConfig({});
    expect(runner.psqlInvocation(c, true)).toEqual({ cmd: 'docker', args: ['exec', '-i', 'w6-real-schema', 'psql', '-U', 'postgres', '-d', 'w6', '-v', 'ON_ERROR_STOP=1', '-q'] });
    expect(runner.psqlInvocation(c, false).args).not.toContain('ON_ERROR_STOP=1');
  });

  it('the committed baseline metadata parses and the real replay set is exactly the migrations above the ledger', () => {
    const meta = runner.parseBaselineMeta(fs.readFileSync(path.join(REPO, 'supabase/_schema/baseline.json'), 'utf8'));
    const all = fs.readdirSync(path.join(REPO, 'supabase/migrations'));
    const replay = runner.migrationsToReplay(all, meta.ledgerMax);
    expect(replay.length).toBeGreaterThan(0);
    for (const f of replay) expect(f.slice(0, 14) > meta.ledgerMax).toBe(true);
    const above = all.filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.slice(0, 14) > meta.ledgerMax);
    expect(replay).toEqual([...above].sort());
  });
});

// ================================================================ runner — full sequence with a fake executor

interface Call {
  cmd: string;
  args: string[];
  input?: string;
  env?: Record<string, string>;
}

function fakeRoot(): string {
  return path.join('C:', 'fake-repo');
}

function makeDeps(over: Partial<{ restoreStderr: string; failMigration: string; tables: number; readyAfter: number; dockerRunFails: boolean; jestStatus: number }> = {}) {
  const root = fakeRoot();
  const calls: Call[] = [];
  const files: Record<string, string> = {
    [path.join(root, 'supabase/_schema/baseline.sql')]: '-- BASELINE',
    [path.join(root, 'supabase/_schema/baseline.json')]: JSON.stringify({ tables: 800, ledgerMax: LEDGER }),
    [path.join(root, 'scripts/ci/schema-bootstrap.sql')]: '-- BOOTSTRAP',
    [path.join(root, 'supabase/migrations/20260917000000_a.sql')]: '-- A',
    [path.join(root, 'supabase/migrations/20260918000000_b.sql')]: '-- B',
  };
  let readyChecks = 0;
  const exec = (cmd: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}) => {
    calls.push({ cmd, args, input: opts.input, env: opts.env });
    if (cmd === 'docker' && args[0] === 'run') return { status: over.dockerRunFails ? 1 : 0, stdout: '', stderr: over.dockerRunFails ? 'no daemon' : '', error: null };
    if (cmd === 'docker' && args.includes('pg_isready')) {
      readyChecks++;
      return { status: readyChecks >= (over.readyAfter ?? 1) ? 0 : 2, stdout: '', stderr: '', error: null };
    }
    if (args.includes('select version()')) return { status: 0, stdout: 'PostgreSQL 17.0\n', stderr: '', error: null };
    if (args.some((a) => /select count\(\*\)/.test(a))) return { status: 0, stdout: `${over.tables ?? 823}\n`, stderr: '', error: null };
    if (opts.input === '-- BASELINE') return { status: 0, stdout: '', stderr: over.restoreStderr ?? 'ERROR:  schema "auth" already exists', error: null };
    if (over.failMigration && opts.input === over.failMigration) return { status: 3, stdout: '', stderr: 'ERROR:  relation "x" does not exist', error: null };
    if (cmd === process.execPath) return { status: over.jestStatus ?? 0, stdout: '', stderr: '', error: null };
    return { status: 0, stdout: '', stderr: '', error: null };
  };
  const out: string[] = [];
  return {
    calls,
    out,
    deps: {
      exec,
      sleep: () => undefined,
      log: (s: string) => out.push(s),
      root,
      readFile: (f: string) => {
        if (!(f in files)) throw new Error(`no file ${f}`);
        return files[f];
      },
      readDir: () => ['20260917000000_a.sql', `${LEDGER}_ledger.sql`, '20260918000000_b.sql', 'rollbacks'],
      exists: (f: string) => f in files,
    },
  };
}

const psqlCalls = (calls: Call[]) => calls.filter((c) => c.cmd === 'docker' && c.args[0] === 'exec' && c.args.includes('psql'));

describe('real-schema-ci.js — run() sequence', () => {
  it('container mode: bootstrap strict → baseline loose → table floor → strict replay in order → jest → container removed', () => {
    const h = makeDeps();
    expect(runner.run(['backend/tests/realschema/(pi_)'], {}, h.deps)).toBe(0);
    const docker = h.calls.filter((c) => c.cmd === 'docker').map((c) => c.args[0]);
    expect(docker[0]).toBe('rm'); // stale container removed first
    expect(docker[1]).toBe('run');
    expect(docker[docker.length - 1]).toBe('rm'); // cleanup
    const ps = psqlCalls(h.calls);
    const boot = ps.find((c) => c.input === '-- BOOTSTRAP')!;
    const base = ps.find((c) => c.input === '-- BASELINE')!;
    expect(boot.args).toContain('ON_ERROR_STOP=1');
    expect(base.args).not.toContain('ON_ERROR_STOP=1');
    const migs = ps.filter((c) => c.input === '-- A' || c.input === '-- B');
    expect(migs.map((c) => c.input)).toEqual(['-- A', '-- B']);
    for (const m of migs) expect(m.args).toContain('ON_ERROR_STOP=1');
    const jest = h.calls.find((c) => c.cmd === process.execPath)!;
    expect(jest.args).toEqual(expect.arrayContaining(['--config', 'jest.realschema.config.js', '--runInBand', 'backend/tests/realschema/(pi_)']));
    expect(jest.env!.W6_DB_URL).toBe('postgres://postgres:w6@127.0.0.1:5433/w6');
  });

  it('--replay-only stops after the replay and never runs jest', () => {
    const h = makeDeps();
    expect(runner.run(['--replay-only'], {}, h.deps)).toBe(0);
    expect(h.calls.some((c) => c.cmd === process.execPath)).toBe(false);
    expect(h.out.join('\n')).toMatch(/replayed 2 migration\(s\)/);
  });

  it('an unexpected baseline restore error fails the run (and still removes the container)', () => {
    const h = makeDeps({ restoreStderr: 'ERROR:  schema "auth" already exists\nERROR:  function foo() does not exist' });
    expect(runner.run(['--replay-only'], {}, h.deps)).toBe(1);
    expect(psqlCalls(h.calls).some((c) => c.input === '-- A')).toBe(false);
    expect(h.calls[h.calls.length - 1].args.slice(0, 2)).toEqual(['rm', '-f']);
  });

  it('a migration that fails stops the replay: later migrations are not applied, exit 1, container removed', () => {
    const h = makeDeps({ failMigration: '-- A' });
    expect(runner.run([], {}, h.deps)).toBe(1);
    expect(psqlCalls(h.calls).some((c) => c.input === '-- B')).toBe(false);
    expect(h.calls.some((c) => c.cmd === process.execPath)).toBe(false);
    expect(h.calls[h.calls.length - 1].args.slice(0, 2)).toEqual(['rm', '-f']);
  });

  it('too few public tables after restore fails the run', () => {
    const h = makeDeps({ tables: 12 });
    expect(runner.run(['--replay-only'], {}, h.deps)).toBe(1);
    expect(h.out.join('\n')).toMatch(/expected >= 800 tables, got 12/);
  });

  it('docker run failure and a database that never becomes ready both fail', () => {
    expect(runner.run([], {}, makeDeps({ dockerRunFails: true }).deps)).toBe(1);
    const slow = makeDeps({ readyAfter: 61 });
    expect(runner.run([], {}, slow.deps)).toBe(1);
    expect(slow.out.join('\n')).toMatch(/never became ready/);
  });

  it('a failing invariant suite is exit 1', () => {
    expect(runner.run([], {}, makeDeps({ jestStatus: 1 }).deps)).toBe(1);
  });

  it('url mode manages no container; W6_KEEP keeps the container', () => {
    const u = makeDeps();
    expect(runner.run(['--replay-only'], { W6_DB_URL: 'postgres://postgres:w6@127.0.0.1:5999/w6' }, u.deps)).toBe(0);
    expect(u.calls.some((c) => c.cmd === 'docker')).toBe(false);
    expect(u.calls.every((c) => c.cmd === 'psql')).toBe(true);
    const k = makeDeps();
    expect(runner.run(['--replay-only'], { W6_KEEP: '1' }, k.deps)).toBe(0);
    expect(k.calls.filter((c) => c.cmd === 'docker' && c.args[0] === 'rm')).toHaveLength(1); // only the pre-run cleanup
  });

  it('a managed-host W6_DB_URL is refused before any process runs; bad args are exit 64', () => {
    const h = makeDeps();
    expect(runner.run([], { W6_DB_URL: managedUrl('db.x.supabase.co') }, h.deps)).toBe(1);
    expect(h.calls).toEqual([]);
    expect(runner.run(['--nope'], {}, makeDeps().deps)).toBe(64);
  });

  it('the runner loads no env file and never names a production-only variable', () => {
    const src = fs.readFileSync(path.join(REPO, 'scripts/ci/real-schema-ci.js'), 'utf8');
    expect(src).not.toMatch(/dotenv|\.env\.local|SUPABASE_POOLER|SERVICE_ROLE/);
  });
});

// ================================================================ vercel.crons

const ROUTE = 'export default async function h(req) { if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return; }';

function cronFixture(over: { crons?: unknown[]; files?: Record<string, string>; routes?: Record<string, unknown> } = {}) {
  const files = over.files ?? { 'pages/api/cron/a.ts': ROUTE };
  return crons.checkCrons(
    { crons: over.crons ?? [{ path: '/api/cron/a', schedule: '*/15 * * * *' }] },
    { routes: over.routes ?? {} },
    (rel: string) => rel in files,
    (rel: string) => files[rel],
  );
}

describe('check-vercel-crons.js', () => {
  it('passes an existing route that references CRON_SECRET', () => {
    expect(cronFixture().findings).toEqual([]);
  });

  it('passes a route allowlisted as machine-secret naming CRON_SECRET, even without a source reference', () => {
    const r = cronFixture({ files: { 'pages/api/cron/a.ts': 'export default () => null;' }, routes: { 'pages/api/cron/a.ts': { kind: 'machine-secret', env: ['CRON_SECRET'] } } });
    expect(r.findings).toEqual([]);
  });

  it('fails: missing route, no scheduler auth, wrong allowlist kind/env, bad schedule, duplicate, query string, ambiguous file', () => {
    expect(cronFixture({ files: {} }).findings[0]).toMatch(/no route file/);
    expect(cronFixture({ files: { 'pages/api/cron/a.ts': 'export default () => null;' } }).findings[0]).toMatch(/cannot authenticate the scheduler/);
    expect(cronFixture({ files: { 'pages/api/cron/a.ts': 'x' }, routes: { 'pages/api/cron/a.ts': { kind: 'public' } } }).findings[0]).toMatch(/cannot authenticate/);
    expect(cronFixture({ files: { 'pages/api/cron/a.ts': 'x' }, routes: { 'pages/api/cron/a.ts': { kind: 'machine-secret', env: ['OTHER'] } } }).findings[0]).toMatch(/cannot authenticate/);
    expect(cronFixture({ crons: [{ path: '/api/cron/a', schedule: 'every 15 minutes' }] }).findings[0]).toMatch(/5-field cron/);
    expect(cronFixture({ crons: [{ path: '/api/cron/a', schedule: '* * * *' }] }).findings[0]).toMatch(/5-field cron/);
    expect(cronFixture({ crons: [{ path: '/api/cron/a', schedule: '0 2 * * *' }, { path: '/api/cron/a', schedule: '0 3 * * *' }] }).findings).toEqual([expect.stringMatching(/duplicate cron path/)]);
    expect(cronFixture({ crons: [{ path: '/api/cron/a?x=1', schedule: '0 2 * * *' }] }).findings[0]).toMatch(/without a query string/);
    expect(cronFixture({ files: { 'pages/api/cron/a.ts': ROUTE, 'pages/api/cron/a/index.ts': ROUTE } }).findings[0]).toMatch(/ambiguous/);
    expect(crons.checkCrons({}, { routes: {} }, () => false, () => '').findings).toEqual(['vercel.json has no "crons" array']);
  });

  it('isCronSchedule accepts standard forms only', () => {
    for (const ok of ['*/15 * * * *', '0 3 * * *', '30 2 * * 1-5', '0 0,12 * * *']) expect(crons.isCronSchedule(ok)).toBe(true);
    for (const bad of ['@daily', '0 3 * *', '0 3 * * * *', 'a b c d e', '']) expect(crons.isCronSchedule(bad)).toBe(false);
  });

  it('the real vercel.json passes (exit 0) and usage errors are exit 64', () => {
    const out: string[] = [];
    expect(crons.main([], REPO, (s: string) => out.push(s))).toBe(0);
    expect(out.join('\n')).toMatch(/vercel\.crons: PASS/);
    expect(crons.main(['--x'], REPO, () => undefined)).toBe(64);
  });
});

// ================================================================ registry additions

const NEW_IDS = ['pi.unit', 'app.typecheck', 'route-auth', 'backend-tests.typecheck', 'db.schema-lint', 'eng003.unit', 'eng004.unit', 'vercel.crons'];
const ORIGINAL_IDS = ['jev.unit', 'scripts.typecheck', 'pi-score.unit', 'pi-score.digest', 'report1.unit'];

describe('verification-registry additions', () => {
  const registry = loadRegistry();
  const byId = new Map(registry.entries.map((e) => [e.id, e]));

  it('the registry validates and carries every new id exactly once', () => {
    for (const id of NEW_IDS) expect(byId.has(id)).toBe(true);
    expect(new Set(registry.entries.map((e) => e.id)).size).toBe(registry.entries.length);
  });

  it('existing entries are byte-identical to origin/main (their packet digests cannot move)', () => {
    let base: { entries: Array<{ id: string }> };
    try {
      base = JSON.parse(execFileSync('git', ['-C', REPO, 'show', 'origin/main:scripts/jev-flow/verification-registry.json'], { encoding: 'utf8' }));
    } catch {
      return; // no origin ref in this checkout: nothing to compare against
    }
    for (const id of ORIGINAL_IDS) {
      expect(JSON.stringify(byId.get(id))).toBe(JSON.stringify(base.entries.find((e) => e.id === id)));
    }
  });

  it('script-based entries point at scripts that exist; none loads production configuration', () => {
    for (const id of ['app.typecheck', 'route-auth', 'backend-tests.typecheck', 'db.schema-lint', 'vercel.crons']) {
      const e = byId.get(id)!;
      expect(e.argv[0]).toBe('node');
      const script = path.join(REPO, e.argv[1]);
      expect({ id, exists: fs.existsSync(script) }).toEqual({ id, exists: true });
      expect({ id, prod: /\.env\.local|SUPABASE_POOLER_DB_URL/.test(fs.readFileSync(script, 'utf8')) }).toEqual({ id, prod: false });
    }
  });

  it('jest list entries run exact test paths (--runTestsByPath), unique, all under backend/tests/unit', () => {
    const expectCount: Record<string, number> = { 'pi.unit': 64, 'eng003.unit': 4, 'eng004.unit': 9 };
    for (const [id, n] of Object.entries(expectCount)) {
      const e = byId.get(id)!;
      expect(e.argv.slice(0, 5)).toEqual(['node', 'node_modules/jest/bin/jest.js', '--ci', '--runTestsByPath', e.argv[4]]);
      const files = e.argv.slice(4);
      expect(files).toHaveLength(n);
      expect(new Set(files).size).toBe(n);
      for (const f of files) expect(f).toMatch(/^backend\/tests\/unit\/[A-Za-z0-9.]+\.test\.tsx?$/);
    }
    // ENG suites never leak into the PI check, and vice versa for the engagement set.
    const pi = byId.get('pi.unit')!.argv;
    expect(pi.some((a) => /\/(eng00|engagement)/.test(a))).toBe(false);
    expect(byId.get('eng004.unit')!.argv.some((a) => /\/pi[A-Z]/.test(a))).toBe(false);
  });
});
