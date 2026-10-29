/**
 * Schema-parity verifier — which credential it uses, and that it pins the
 * session read-only.
 *
 * Before: the URL was the first of SUPABASE_POOLER_DB_URL / SUPABASE_DB_URL /
 * DATABASE_URL, and `.env.local` in the CWD silently filled any of them that
 * the shell did not set. An operator who exported the release-gate credential
 * as SUPABASE_DB_URL from a directory holding `.env.local` was connected with
 * the file's (stale, privileged) pooler URL instead.
 *
 * After: SCHEMA_PARITY_DB_URL outranks every other source and suppresses
 * `.env.local`; a URL that does come from `.env.local` is announced on stderr
 * by variable NAME only; the session runs `SET default_transaction_read_only =
 * on` (+ timeouts) before any catalog query and records `session.role` /
 * `session.tx_read_only` in the JSON output.
 *
 * No network, no real database: the verifier runs against the same in-process
 * fake `pg` as predeployStrictSchema.test.ts (extracted from that file so there
 * is one fake), wrapped to record every connection string and query.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'verify-schema-parity.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parity = require(SCRIPT);

const EXPLICIT_SECRET = 'ExplicitSecret9931';
const ENVLOCAL_SECRET = 'EnvLocalSecret4417';
const EXPLICIT_URL = `postgresql://gate_ro:${EXPLICIT_SECRET}@explicit-gate.invalid:5432/postgres`;
const ENVLOCAL_URL = `postgresql://postgres.ref:${ENVLOCAL_SECRET}@envlocal-pooler.invalid:6543/postgres`;

function extractFakePg(): string {
  const src = fs.readFileSync(path.join(__dirname, 'predeployStrictSchema.test.ts'), 'utf8');
  const m = /const FAKE_PG = `([\s\S]*?)`;/.exec(src);
  if (!m) throw new Error('fake pg not found in predeployStrictSchema.test.ts');
  return m[1];
}

// Records the constructor's connection string and every query, in order.
const RECORDER = `
const fs = require('fs');
const Module = require('module');
const inner = Module._load;
const log = (o) => fs.appendFileSync(process.env.FAKE_PG_LOG, JSON.stringify(o) + '\\n');
const origRead = fs.readFileSync;
fs.readFileSync = function (p) {
  if (String(p).endsWith('.env.local')) log({ readEnvLocal: true });
  return origRead.apply(this, arguments);
};
Module._load = function (request) {
  const mod = inner.apply(this, arguments);
  if (request !== 'pg') return mod;
  const Base = mod.Client;
  class Recording extends Base {
    constructor(cfg) { super(cfg); log({ connect: cfg && cfg.connectionString }); }
    async query(sql, params) { log({ sql: String(sql).slice(0, 200) }); return super.query(sql, params); }
  }
  return { Client: Recording };
};
`;

let tmp: string;
let preload: string;
let recorder: string;
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-cred-'));
  preload = path.join(tmp, 'fake-pg.js');
  recorder = path.join(tmp, 'recorder.js');
  fs.writeFileSync(preload, extractFakePg());
  fs.writeFileSync(recorder, RECORDER);
});
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

interface Run { code: number | null; stdout: string; stderr: string; log: any[]; check: any }

function run(opts: { cwd: string; env: Record<string, string>; faults?: string }): Run {
  const logFile = path.join(tmp, `log-${Math.random().toString(36).slice(2)}.ndjson`);
  const env: Record<string, string> = {
    PATH: process.env.PATH || '',
    SystemRoot: process.env.SystemRoot || '',
    FAKE_PG: opts.faults || '',
    FAKE_PG_SCRIPT: SCRIPT,
    FAKE_PG_LOG: logFile,
    ...opts.env,
  };
  const r = spawnSync(process.execPath, ['-r', preload, '-r', recorder, SCRIPT, '--strict'],
    { cwd: opts.cwd, env: env as unknown as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 60_000 });
  const log = fs.existsSync(logFile)
    ? fs.readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const line = (r.stdout || '').split('\n').find((l) => l.includes('"schema_parity.check"'));
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', log, check: line ? JSON.parse(line) : null };
}

function dirWithEnvLocal(): string {
  const d = fs.mkdtempSync(path.join(tmp, 'cwd-'));
  fs.writeFileSync(path.join(d, '.env.local'), `SUPABASE_POOLER_DB_URL=${ENVLOCAL_URL}\nSUPABASE_URL=https://envlocal.invalid\n`);
  return d;
}

const connections = (r: Run) => r.log.filter((e) => 'connect' in e).map((e) => e.connect);
const noSecrets = (r: Run) => {
  expect(r.stdout + r.stderr).not.toContain(EXPLICIT_SECRET);
  expect(r.stdout + r.stderr).not.toContain(ENVLOCAL_SECRET);
};

describe('verify-schema-parity — credential source', () => {
  it('names SCHEMA_PARITY_DB_URL first in its precedence list', () => {
    expect(parity.DB_URL_VARS).toEqual(['SCHEMA_PARITY_DB_URL', 'SUPABASE_POOLER_DB_URL', 'SUPABASE_DB_URL', 'DATABASE_URL']);
    expect(parity.resolveDbUrl({ SCHEMA_PARITY_DB_URL: 'a', SUPABASE_POOLER_DB_URL: 'b' })).toEqual({ name: 'SCHEMA_PARITY_DB_URL', url: 'a' });
    expect(parity.resolveDbUrl({ DATABASE_URL: 'd', SUPABASE_DB_URL: 'c' })).toEqual({ name: 'SUPABASE_DB_URL', url: 'c' });
    expect(parity.resolveDbUrl({})).toEqual({ name: null, url: null });
  });

  it('SCHEMA_PARITY_DB_URL is used and .env.local is never read, even when the file holds a pooler URL', () => {
    const r = run({ cwd: dirWithEnvLocal(), env: { SCHEMA_PARITY_DB_URL: EXPLICIT_URL }, faults: 'connect_fail' });
    expect(r.code).toBe(2);
    expect(connections(r)).toEqual([EXPLICIT_URL]);
    expect(r.log.some((e) => e.readEnvLocal)).toBe(false);
    expect(r.stderr).not.toContain('db_url_from_env_local');
    noSecrets(r);
  });

  it('SCHEMA_PARITY_DB_URL outranks SUPABASE_POOLER_DB_URL set in the shell', () => {
    const r = run({ cwd: REPO, env: { SCHEMA_PARITY_DB_URL: EXPLICIT_URL, SUPABASE_POOLER_DB_URL: ENVLOCAL_URL }, faults: 'connect_fail' });
    expect(connections(r)).toEqual([EXPLICIT_URL]);
    noSecrets(r);
  });

  it('a URL that comes from .env.local is announced by variable name only (the old hijack path)', () => {
    // The operator exported SUPABASE_DB_URL; .env.local's pooler URL outranks it.
    const r = run({ cwd: dirWithEnvLocal(), env: { SUPABASE_DB_URL: EXPLICIT_URL }, faults: 'connect_fail' });
    expect(connections(r)).toEqual([ENVLOCAL_URL]);
    expect(r.log.some((e) => e.readEnvLocal)).toBe(true); // the tracker itself works
    const warning = r.stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .find((e) => e.event === 'schema_parity.warning');
    expect(warning).toMatchObject({ reason: 'db_url_from_env_local', variable: 'SUPABASE_POOLER_DB_URL' });
    noSecrets(r);
  });

  it('no warning when the shell supplied the URL that was used', () => {
    const r = run({ cwd: REPO, env: { SUPABASE_POOLER_DB_URL: EXPLICIT_URL, SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'dummy' }, faults: 'connect_fail' });
    expect(connections(r)).toEqual([EXPLICIT_URL]);
    expect(r.stderr).not.toContain('db_url_from_env_local');
  });

  it('missing credentials names SCHEMA_PARITY_DB_URL and exits 2', () => {
    const r = run({ cwd: REPO, env: { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'dummy' } });
    expect(r.code).toBe(2);
    expect(JSON.parse(r.stderr.trim().split('\n').pop() as string)).toMatchObject({
      reason: 'missing_credentials', missing: ['SCHEMA_PARITY_DB_URL', 'SUPABASE_POOLER_DB_URL'] });
  });
});

describe('verify-schema-parity — read-only session', () => {
  it('pins the session read-only before any catalog query and records the role that ran it', () => {
    const r = run({ cwd: REPO, env: { SCHEMA_PARITY_DB_URL: EXPLICIT_URL } });
    expect(r.code).toBe(0);
    const queries = r.log.filter((e) => 'sql' in e).map((e) => e.sql as string);
    expect(queries[0]).toMatch(/^SET default_transaction_read_only = on; SET statement_timeout = '120s'; SET lock_timeout = '2s'/);
    expect(queries[1]).toMatch(/current_setting\('transaction_read_only'\)/);
    expect(r.check.session).toEqual({ role: 'fake_ro', tx_read_only: 'on' });
    noSecrets(r);
  });

  it('a session that cannot be pinned read-only exits 2 (session_setup_failed), never runs the checks', () => {
    const src = extractFakePg().replace(
      "if (sql.startsWith('SET default_transaction_read_only = on')) return { rows: [] };",
      "if (sql.startsWith('SET default_transaction_read_only = on')) throw new Error('permission denied to set parameter (fake)');");
    expect(src).toContain('permission denied to set parameter (fake)');
    const failing = path.join(tmp, 'fake-pg-session-fail.js');
    fs.writeFileSync(failing, src);
    const logFile = path.join(tmp, 'log-session-fail.ndjson');
    const r = spawnSync(process.execPath, ['-r', failing, '-r', recorder, SCRIPT, '--strict'], {
      cwd: REPO, encoding: 'utf8', timeout: 60_000,
      env: { PATH: process.env.PATH || '', SystemRoot: process.env.SystemRoot || '', FAKE_PG_SCRIPT: SCRIPT,
        FAKE_PG_LOG: logFile, SCHEMA_PARITY_DB_URL: EXPLICIT_URL } as unknown as NodeJS.ProcessEnv,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('session_setup_failed');
    const queries = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => 'sql' in e);
    expect(queries).toHaveLength(1);
    expect((r.stdout || '') + (r.stderr || '')).not.toContain(EXPLICIT_SECRET);
  });

  // N2: recording read-only is not enough — a session where it did not take effect must stop.
  it('a session that reports transaction_read_only = off exits 2 (session_not_read_only) before any catalog query', () => {
    const r = run({ cwd: REPO, env: { SCHEMA_PARITY_DB_URL: EXPLICIT_URL }, faults: 'not_read_only' });
    expect(r.code).toBe(2);
    expect(r.check).toBeNull();
    const err = r.stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === 'schema_parity.error');
    expect(err).toMatchObject({ reason: 'session_not_read_only', role: 'fake_ro', tx_read_only: 'off' });
    expect(r.log.filter((e) => 'sql' in e)).toHaveLength(2); // the SET and the read-back only
    noSecrets(r);
  });

  it('warns (variable name only) when SCHEMA_PARITY_DB_URL does not ask for verify-full TLS; verify-full is silent', () => {
    const r = run({ cwd: REPO, env: { SCHEMA_PARITY_DB_URL: EXPLICIT_URL }, faults: 'connect_fail' });
    const warning = r.stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l))
      .find((e) => e.reason === 'tls_not_verified');
    expect(warning).toMatchObject({ event: 'schema_parity.warning', variable: 'SCHEMA_PARITY_DB_URL' });
    expect(r.stderr).not.toContain('explicit-gate.invalid');
    noSecrets(r);
    const verified = run({ cwd: REPO, env: { SCHEMA_PARITY_DB_URL: `${EXPLICIT_URL}?sslmode=verify-full&sslrootcert=ca.pem` }, faults: 'connect_fail' });
    expect(verified.stderr).not.toContain('tls_not_verified');
  });

  // N3: a malformed URL makes the pg Client constructor throw; that is a connection failure, not a crash.
  it('a Client constructor failure (malformed URL) reports connection_failed and exits 2', () => {
    const r = run({ cwd: REPO, env: { SCHEMA_PARITY_DB_URL: EXPLICIT_URL }, faults: 'ctor_fail' });
    expect(r.code).toBe(2);
    const err = r.stderr.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.event === 'schema_parity.error');
    expect(err).toMatchObject({ reason: 'connection_failed' });
    noSecrets(r);
  });
});
