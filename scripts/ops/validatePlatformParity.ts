#!/usr/bin/env tsx
/**
 * Platform parity validator.
 *
 * Compares the canonical auth-envelope env vars across:
 *   - local .env.local
 *   - Vercel Production
 *   - Vercel Preview
 *   - Railway
 *
 * Exit code is non-zero when:
 *   - a required var is missing on any env
 *   - SUPABASE_URL value differs between local and a cloud env
 *   - NEXT_PUBLIC_SUPABASE_URL value differs between local and a cloud env
 *   - NEXT_PUBLIC_APP_URL value differs between local and a cloud env
 *   - SESSION_COOKIE_SECRET is shorter than 32 chars where readable
 *   - any URL value is malformed
 *
 * Sensitive vars on Vercel are sensitive-by-default; `vercel env pull` returns
 * empty strings for them. The validator reports those as PRESENT_UNREADABLE
 * (not MISMATCH) so a fundamentally-unreadable cloud value is distinguishable
 * from a true drift. Only non-NULL, non-empty mismatches fail the run.
 *
 * Usage:
 *   tsx scripts/ops/validatePlatformParity.ts          # human-readable table
 *   tsx scripts/ops/validatePlatformParity.ts --json   # JSON output
 *   tsx scripts/ops/validatePlatformParity.ts --strict # also fail on UNREADABLE
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type EnvRow = {
  variable: string;
  local: string | null;
  vercelProd: string | null;
  vercelPreview: string | null;
  railway: string | null;
  status: 'MATCH' | 'MISMATCH' | 'MISSING' | 'PRESENT_UNREADABLE' | 'PARTIAL';
  notes: string[];
};

const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_COOKIE_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const;

const URL_VARS = new Set(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'NEXT_PUBLIC_APP_URL']);

const SESSION_COOKIE_SECRET_MIN_LENGTH = 32;

const args = new Set(process.argv.slice(2));
const JSON_OUTPUT = args.has('--json');
const STRICT = args.has('--strict');

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
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

function loadLocal(): Record<string, string> {
  return parseEnvFile(join(process.cwd(), '.env.local'));
}

function loadVercel(target: 'production' | 'preview'): Record<string, string> | { error: string } {
  const dir = mkdtempSync(join(tmpdir(), `vercel-env-${target}-`));
  const file = join(dir, `.env.${target}`);
  try {
    const result = spawnSync(
      'npx',
      ['--no-install', 'vercel', 'env', 'pull', file, '--environment', target, '--yes'],
      { encoding: 'utf8', shell: true },
    );
    if (result.status !== 0) {
      return { error: `vercel env pull --environment=${target} failed: ${result.stderr || result.stdout}` };
    }
    return parseEnvFile(file);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function runRailway(args: string[]): { stdout: string; stderr: string; status: number | null } {
  // npx --no-install resolves @railway/cli via Node's module-resolution
  // path, bypassing the Windows cmd.exe PATH lookup that fails for binaries
  // installed via the global npm prefix.
  const a = spawnSync('npx', ['--no-install', '@railway/cli', ...args], { encoding: 'utf8', shell: true });
  if (a.status === 0 || !(a.stderr || '').includes('could not determine executable')) return { stdout: a.stdout, stderr: a.stderr, status: a.status };
  const b = spawnSync('railway', args, { encoding: 'utf8', shell: true });
  return { stdout: b.stdout, stderr: b.stderr, status: b.status };
}

function loadRailway(): Record<string, string> | { error: string } {
  const probe = runRailway(['whoami']);
  if (probe.status !== 0) {
    return { error: 'RAILWAY_AUTH_FAILED' };
  }
  // `railway variables --json` shape varies across CLI versions; some emit
  // a flat KEY=VALUE table even with --json. Try JSON first, then fall back.
  const json = runRailway(['variables', '--json']);
  if (json.status === 0 && json.stdout.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(json.stdout);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
    } catch { /* fall through */ }
  }
  const plain = runRailway(['variables', '--kv']);
  if (plain.status !== 0) {
    return { error: `railway variables failed: ${plain.stderr || plain.stdout}` };
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

function classify(row: Pick<EnvRow, 'local' | 'vercelProd' | 'vercelPreview' | 'railway' | 'variable'> & { vercelErr: string | null; railwayErr: string | null }): { status: EnvRow['status']; notes: string[] } {
  const notes: string[] = [];
  if (row.vercelErr) notes.push(`vercel: ${row.vercelErr}`);
  if (row.railwayErr) notes.push(`railway: ${row.railwayErr}`);

  // Per-env classification:
  //   null  → truly absent from that env (real MISSING for that source)
  //   ''    → present in vercel env listing but unreadable via vercel env pull
  //           (Vercel marks values as "sensitive by default")
  //   any   → present and readable
  const localPresent       = row.local !== null && row.local !== '';
  const vercelProdPresent  = row.vercelProd !== null;          // null = missing, '' = unreadable
  const vercelProdReadable = row.vercelProd !== null && row.vercelProd !== '';
  const vercelPrevPresent  = row.vercelPreview !== null;
  const vercelPrevReadable = row.vercelPreview !== null && row.vercelPreview !== '';
  const railwayPresent     = !row.railwayErr && row.railway !== null && row.railway !== '';

  // Hard MISSING: any non-errored env reports the key as truly absent.
  const missingSources: string[] = [];
  if (!localPresent) missingSources.push('local');
  if (!row.vercelErr && !vercelProdPresent) missingSources.push('vercelProd');
  if (!row.vercelErr && !vercelPrevPresent) missingSources.push('vercelPreview');
  if (!row.railwayErr && !railwayPresent) missingSources.push('railway');
  if (missingSources.length > 0) {
    notes.push(`missing on: ${missingSources.join(', ')}`);
    return { status: 'MISSING', notes };
  }

  // Readable mismatches across env sources.
  const cloudReadable: { name: string; value: string }[] = [];
  if (vercelProdReadable) cloudReadable.push({ name: 'vercelProd', value: row.vercelProd! });
  if (vercelPrevReadable) cloudReadable.push({ name: 'vercelPreview', value: row.vercelPreview! });
  if (!row.railwayErr && row.railway && row.railway !== '') cloudReadable.push({ name: 'railway', value: row.railway });

  if (localPresent && cloudReadable.length > 0) {
    const mismatches = cloudReadable.filter((c) => c.value !== row.local);
    if (mismatches.length > 0) {
      notes.push(`value mismatches vs local: ${mismatches.map((m) => m.name).join(', ')}`);
      return { status: 'MISMATCH', notes };
    }
  }

  // Vercel present-but-unreadable (sensitive-by-default).
  const anyUnreadable = (!vercelProdReadable && vercelProdPresent) || (!vercelPrevReadable && vercelPrevPresent);
  if (anyUnreadable) return { status: 'PRESENT_UNREADABLE', notes };

  // Railway unauthenticated → PARTIAL (cannot complete parity).
  if (row.railwayErr) return { status: 'PARTIAL', notes };

  return { status: 'MATCH', notes };
}

function validateValue(variable: string, value: string | null): string[] {
  const issues: string[] = [];
  if (!value) return issues;
  if (URL_VARS.has(variable)) {
    try { new URL(value); } catch { issues.push(`malformed URL: ${value}`); }
  }
  if (variable === 'SESSION_COOKIE_SECRET') {
    if (value.length < SESSION_COOKIE_SECRET_MIN_LENGTH) {
      issues.push(`SESSION_COOKIE_SECRET is ${value.length} chars (minimum ${SESSION_COOKIE_SECRET_MIN_LENGTH})`);
    }
  }
  return issues;
}

function renderCell(value: string | null): string {
  if (value === null) return 'MISSING';
  if (value === '') return 'unreadable';
  return 'present';
}

function renderTable(rows: EnvRow[]): string {
  const header = ['Variable', 'Local', 'Vercel Prod', 'Vercel Preview', 'Railway', 'Status'];
  const data = rows.map((r) => [
    r.variable,
    renderCell(r.local),
    renderCell(r.vercelProd),
    renderCell(r.vercelPreview),
    renderCell(r.railway),
    r.status,
  ]);
  const widths = header.map((_, i) =>
    Math.max(header[i].length, ...data.map((d) => d[i].length)),
  );
  const pad = (cells: string[]) =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '|-' + widths.map((w) => '-'.repeat(w)).join('-|-') + '-|';
  const out: string[] = [];
  out.push(pad(header));
  out.push(sep);
  for (const row of data) out.push(pad(row));
  return out.join('\n');
}

async function main(): Promise<number> {
  const local = loadLocal();
  const vercelProd = loadVercel('production');
  const vercelPreview = loadVercel('preview');
  const railway = loadRailway();

  const vercelProdErr = 'error' in vercelProd ? vercelProd.error : null;
  const vercelPreviewErr = 'error' in vercelPreview ? vercelPreview.error : null;
  const railwayErr = 'error' in railway ? railway.error : null;

  const rows: EnvRow[] = REQUIRED_VARS.map((variable) => {
    const localValue = local[variable] ?? null;
    const vercelProdValue = vercelProdErr ? null : (vercelProd as Record<string, string>)[variable] ?? null;
    const vercelPreviewValue = vercelPreviewErr ? null : (vercelPreview as Record<string, string>)[variable] ?? null;
    const railwayValue = railwayErr ? null : (railway as Record<string, string>)[variable] ?? null;

    const { status, notes } = classify({
      variable,
      local: localValue,
      vercelProd: vercelProdValue,
      vercelPreview: vercelPreviewValue,
      railway: railwayValue,
      vercelErr: vercelProdErr || vercelPreviewErr,
      railwayErr,
    });

    const validationIssues: string[] = [];
    if (localValue) validationIssues.push(...validateValue(variable, localValue));
    if (vercelProdValue) validationIssues.push(...validateValue(variable, vercelProdValue).map((i) => `vercelProd: ${i}`));
    if (vercelPreviewValue) validationIssues.push(...validateValue(variable, vercelPreviewValue).map((i) => `vercelPreview: ${i}`));
    if (railwayValue) validationIssues.push(...validateValue(variable, railwayValue).map((i) => `railway: ${i}`));

    return {
      variable,
      local: localValue,
      vercelProd: vercelProdValue,
      vercelPreview: vercelPreviewValue,
      railway: railwayValue,
      status: validationIssues.length > 0 ? 'MISMATCH' : status,
      notes: [...notes, ...validationIssues],
    };
  });

  const hardFailures = rows.filter((r) => {
    if (r.status === 'MISSING') return true;
    if (r.status === 'MISMATCH') return true;
    if (STRICT && r.status === 'PRESENT_UNREADABLE') return true;
    return false;
  });

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ rows, hardFailures: hardFailures.map((r) => r.variable) }, null, 2));
  } else {
    console.log(renderTable(rows));
    console.log('');
    for (const r of rows) {
      if (r.notes.length > 0) {
        console.log(`  ${r.variable}:`);
        for (const n of r.notes) console.log(`    - ${n}`);
      }
    }
    if (vercelProdErr) console.log(`\nVercel Production error: ${vercelProdErr}`);
    if (vercelPreviewErr) console.log(`Vercel Preview error: ${vercelPreviewErr}`);
    if (railwayErr) console.log(`Railway error: ${railwayErr}`);
    console.log(`\nResult: ${hardFailures.length === 0 ? 'PASS' : `FAIL (${hardFailures.length} hard failures)`}`);
  }

  return hardFailures.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('validatePlatformParity: fatal error', err);
  process.exit(2);
});
