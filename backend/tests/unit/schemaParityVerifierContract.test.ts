/**
 * `scripts/verify-schema-parity.js` — the exit-code contract.
 *
 * ─── WHY THIS TEST EXISTS ──────────────────────────────────────────────────
 * The verifier used to read `information_schema` through PostgREST, as
 * `client.from('information_schema.columns')`. PostgREST resolves that as the
 * TABLE `public."information_schema.columns"`, which does not exist, so the
 * very first table errored and the script exited 2 — on every run, in every
 * environment, with valid credentials present. `predeploy-check.js` maps exit 2
 * to "schema parity: SKIPPED (env unavailable)" and continues, so the gate
 * announced an environmental excuse forever and never compared a single column.
 *
 * The regression this file guards is therefore not "does it pass" but
 * "does it actually run, and can a failure ever look like a success".
 *
 * The exit-code contract:
 *   0 — every required column present AND no ledger desync
 *   1 — at least one BLOCKING column missing
 *   2 — environmental failure (no connection string, connection refused)
 *   3 — WARN only (non-critical columns missing, or ledger desync)
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(REPO, 'scripts', 'verify-schema-parity.js');

interface RunResult { code: number; stdout: string; stderr: string }

/** Runs the verifier with a controlled environment and captures its exit code. */
function run(env: Record<string, string | undefined>): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.status === 'number' ? err.status : -1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

/**
 * The script loads `.env.local` from cwd when the connection string is absent,
 * which would defeat a "no credentials" test. Point HOME/cwd env at values that
 * cannot resolve instead, and blank every accepted variable.
 */
const NO_DB = {
  SUPABASE_POOLER_DB_URL: '',
  SUPABASE_DB_URL: '',
  DATABASE_URL: '',
};

const source = fs.readFileSync(SCRIPT, 'utf8');

/**
 * Comments stripped. The header explains the PostgREST defect by quoting it, so
 * a naive substring search finds the prose describing the bug and reports the
 * bug itself — which is exactly what happened the first time this ran.
 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');

describe('verify-schema-parity — source-level regression guards', () => {
  it('never reads information_schema through PostgREST again', () => {
    expect(code).not.toContain("from('information_schema.columns')");
    expect(code).not.toContain('from("information_schema.columns")');
  });

  it('reads information_schema over a direct Postgres connection', () => {
    expect(source).toContain('information_schema.columns');
    expect(source).toMatch(/require\('pg'\)/);
    expect(source).toContain('SUPABASE_POOLER_DB_URL');
  });

  it('exits 0 on exactly one condition — everything present AND no desync', () => {
    const zeroExits = code.match(/process\.exit\(0\)/g) ?? [];
    expect(zeroExits).toHaveLength(1);
    expect(code).toMatch(/missing\.length === 0 && !ledgerDesyncDetected[\s\S]{0,200}process\.exit\(0\)/);
  });

  it('treats a failed introspection query as environmental, never as "no columns"', () => {
    // The catch around the column query must exit, not fall through to a
    // verdict built from an empty observation set.
    expect(source).toMatch(/information_schema_query_failed[\s\S]{0,200}process\.exit\(2\)/);
  });
});

describe('verify-schema-parity — runtime exit-code contract', () => {
  it('exits 2, never 0, when no connection string is available', () => {
    const r = run({ ...NO_DB, SCHEMA_PARITY_SKIP_ENV_FILE: '1' });
    // Either it found no connection string (2), or .env.local supplied one and
    // it produced a real verdict. What it must NEVER do is exit 0 silently
    // without having checked anything.
    expect(r.code).not.toBe(-1);
    if (r.code === 2) {
      expect(r.stderr).toContain('schema_parity.error');
    } else {
      // It ran for real: prove it actually compared columns.
      const line = r.stdout.split('\n').find((l) => l.includes('schema_parity.check'));
      expect(line).toBeDefined();
      expect(JSON.parse(line as string).checked_columns).toBeGreaterThan(0);
    }
  });

  it('exits 2, never 0, when the database refuses the connection', () => {
    const r = run({
      SUPABASE_POOLER_DB_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nodb',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/connection_failed|information_schema_query_failed/);
    expect(r.code).not.toBe(0);
  });

  it('exits 2, never 0, on a malformed connection string', () => {
    const r = run({
      SUPABASE_POOLER_DB_URL: 'not-a-connection-string',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
    });
    expect(r.code).toBe(2);
    expect(r.code).not.toBe(0);
  });
});
