#!/usr/bin/env tsx
/**
 * Railway environment audit.
 *
 * Verifies:
 *   - Railway auth (token present + valid)
 *   - Required env vars present on the linked service
 *   - No stale app.omnivyra.com refs in readable values
 *   - SESSION_COOKIE_SECRET length ≥ 32
 *
 * If the Railway token is invalid OR no service is linked, the script
 * emits `RAILWAY_AUTH_FAILED` and exits 2 (distinct from a "real" parity
 * failure which exits 1). CI workflows can treat exit 2 as a soft failure
 * pending operator action.
 *
 * Usage:
 *   tsx scripts/ops/railwayEnvAudit.ts          # human-readable
 *   tsx scripts/ops/railwayEnvAudit.ts --json
 */
import { spawnSync } from 'node:child_process';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_COOKIE_SECRET',
] as const;

const STALE_HOST_PATTERN = /\bapp\.omnivyra\.com\b/i;
const SESSION_COOKIE_SECRET_MIN_LENGTH = 32;
const JSON_OUTPUT = process.argv.includes('--json');

function runRailway(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('npx', ['--no-install', '@railway/cli', ...args], { encoding: 'utf8', shell: true });
  if (r.status !== 0 && (r.stderr || '').includes('could not determine executable')) {
    // Fall back to the global `railway` binary when @railway/cli is not
    // available locally — works when the Railway CLI was installed
    // globally via `npm i -g @railway/cli` or `winget`.
    return spawnSync('railway', args, { encoding: 'utf8', shell: true }) as unknown as { stdout: string; stderr: string; status: number | null };
  }
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

function authCheck(): { ok: true } | { ok: false; reason: string } {
  const r = runRailway(['whoami']);
  if (r.status !== 0) {
    const message = (r.stderr || r.stdout || '').trim();
    return { ok: false, reason: message || 'unknown' };
  }
  return { ok: true };
}

function fetchVariables(): Record<string, string> | { error: string } {
  // Try the modern --json flag first, fall back to KEY=VALUE plain output.
  const jsonRun = runRailway(['variables', '--json']);
  if (jsonRun.status === 0 && jsonRun.stdout.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonRun.stdout);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
    } catch { /* fall through */ }
  }

  const plain = runRailway(['variables']);
  if (plain.status !== 0) {
    const message = (plain.stderr || plain.stdout || '').trim();
    return { error: `railway variables failed: ${message}` };
  }
  const out: Record<string, string> = {};
  for (const line of plain.stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main(): Promise<number> {
  const auth = authCheck();
  if (!auth.ok) {
    // The repo compiles with `strict: false` (tsconfig.json), so strictNullChecks
    // is off and a falsy test on the `ok` discriminant does NOT narrow this union.
    // `'reason' in auth` narrows structurally and does — the same pattern used by
    // AuthorizationService.ts:170, legacyCookieSuperAdminBridge.ts:91 and
    // creatorAssetValidationService.ts:84. `authCheck()` always sets `reason` when
    // `ok` is false, so the fallback is unreachable and output is unchanged.
    const reason = 'reason' in auth ? auth.reason : 'unknown';
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ status: 'RAILWAY_AUTH_FAILED', detail: reason }, null, 2));
    } else {
      console.error('RAILWAY_AUTH_FAILED');
      console.error(`  ${reason}`);
      console.error('  Regenerate RAILWAY_TOKEN in the Railway dashboard and update .env.local.');
    }
    return 2;
  }

  const vars = fetchVariables();
  if ('error' in vars) {
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({ status: 'RAILWAY_FETCH_FAILED', detail: vars.error }, null, 2));
    } else {
      console.error(`Railway variables fetch failed: ${vars.error}`);
      console.error('Hint: ensure the worktree is linked to a service via `railway link`.');
    }
    return 2;
  }

  const missing = REQUIRED.filter((k) => !vars[k] || vars[k].length === 0);
  const staleHits: { variable: string; value: string }[] = [];
  const lengthIssues: string[] = [];

  for (const k of REQUIRED) {
    const v = vars[k];
    if (!v) continue;
    if (STALE_HOST_PATTERN.test(v)) staleHits.push({ variable: k, value: v });
    if (k === 'SESSION_COOKIE_SECRET' && v.length < SESSION_COOKIE_SECRET_MIN_LENGTH) {
      lengthIssues.push(`SESSION_COOKIE_SECRET is ${v.length} chars (minimum ${SESSION_COOKIE_SECRET_MIN_LENGTH})`);
    }
  }

  const failures: string[] = [];
  if (missing.length > 0) failures.push(`Missing on Railway: ${missing.join(', ')}`);
  if (staleHits.length > 0) failures.push(`Stale app.omnivyra.com refs: ${staleHits.map((s) => s.variable).join(', ')}`);
  failures.push(...lengthIssues);

  const report = {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    presentVars: REQUIRED.filter((k) => !!vars[k]),
    missing,
    staleHits,
    lengthIssues,
    failures,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('== Railway env audit ==');
    console.log(`  Present: ${report.presentVars.join(', ') || '(none)'}`);
    if (missing.length > 0) console.log(`  Missing: ${missing.join(', ')}`);
    if (staleHits.length > 0) {
      console.log('  Stale app.omnivyra.com refs:');
      for (const s of staleHits) console.log(`    - ${s.variable} = ${s.value}`);
    }
    for (const i of lengthIssues) console.log(`  ❌ ${i}`);
    console.log(`\nResult: ${report.status}`);
  }

  return failures.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('railwayEnvAudit: fatal error', err);
  process.exit(2);
});
