#!/usr/bin/env tsx
/**
 * Vercel environment audit.
 *
 * Validates that the omnivyra Vercel project has the canonical auth-envelope
 * env vars set on both Production and Preview, that no stale
 * `app.omnivyra.com` reference remains in readable values, and that the
 * canonical `NEXT_PUBLIC_APP_URL` matches the deployed origin.
 *
 * Two passes:
 *   1. Presence pass — `vercel env ls <env>` returns names + timestamps.
 *      Sensitive values are not exposed; we only assert presence here.
 *   2. Value pass — `vercel env pull` materializes non-sensitive values
 *      into a temp file. Stale-host references are detected here.
 *
 * Usage:
 *   tsx scripts/ops/vercelEnvAudit.ts          # human-readable
 *   tsx scripts/ops/vercelEnvAudit.ts --json
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Target = 'production' | 'preview';
type EnvPresence = { name: string; lastUpdated: string | null };
type StaleHit = { variable: string; value: string };

const REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SESSION_COOKIE_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const;

const CANONICAL_APP_HOST = 'www.omnivyra.com';
const STALE_HOST_PATTERN = /\bapp\.omnivyra\.com\b/i;

const JSON_OUTPUT = process.argv.includes('--json');

function listEnvNames(target: Target): { names: EnvPresence[]; error: string | null } {
  const result = spawnSync('npx', ['--no-install', 'vercel', 'env', 'ls', target], { encoding: 'utf8', shell: true });
  if (result.status !== 0) {
    return { names: [], error: `vercel env ls ${target} failed: ${result.stderr || result.stdout}` };
  }
  const lines = result.stdout.split(/\r?\n/);
  const names: EnvPresence[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('>') || line.startsWith('Retrieving')) continue;
    // table rows look like:  "NAME  Encrypted  Production  6d ago"
    const m = line.match(/^([A-Z][A-Z0-9_]+)\s+/);
    if (!m) continue;
    const name = m[1];
    const tsMatch = line.match(/(\d+\s*(?:s|m|h|d|w|mo|y)\s*ago)/i);
    names.push({ name, lastUpdated: tsMatch ? tsMatch[1] : null });
  }
  return { names, error: null };
}

function pullEnvValues(target: Target): { values: Record<string, string>; error: string | null } {
  const dir = mkdtempSync(join(tmpdir(), `vercel-env-${target}-`));
  const file = join(dir, `.env.${target}`);
  try {
    const result = spawnSync(
      'npx',
      ['--no-install', 'vercel', 'env', 'pull', file, '--environment', target, '--yes'],
      { encoding: 'utf8', shell: true },
    );
    if (result.status !== 0) {
      return { values: {}, error: `vercel env pull --environment=${target} failed: ${result.stderr || result.stdout}` };
    }
    if (!existsSync(file)) return { values: {}, error: 'pull succeeded but file missing' };
    const text = readFileSync(file, 'utf8');
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return { values: out, error: null };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function auditTarget(target: Target): Promise<{
  presence: EnvPresence[];
  missing: string[];
  staleHits: StaleHit[];
  unreadable: string[];
  errors: string[];
  appUrlValue: string | null;
}> {
  const errors: string[] = [];
  const presenceResult = listEnvNames(target);
  if (presenceResult.error) errors.push(presenceResult.error);

  const presentNames = new Set(presenceResult.names.map((n) => n.name));
  const missing = REQUIRED.filter((r) => !presentNames.has(r));

  const valuesResult = pullEnvValues(target);
  if (valuesResult.error) errors.push(valuesResult.error);

  const staleHits: StaleHit[] = [];
  const unreadable: string[] = [];
  for (const v of REQUIRED) {
    const val = valuesResult.values[v] ?? '';
    if (presentNames.has(v) && val === '') unreadable.push(v);
    if (val && STALE_HOST_PATTERN.test(val)) staleHits.push({ variable: v, value: val });
  }

  const appUrlValue = valuesResult.values['NEXT_PUBLIC_APP_URL'] ?? null;
  return {
    presence: presenceResult.names.filter((p) => REQUIRED.includes(p.name as (typeof REQUIRED)[number])),
    missing,
    staleHits,
    unreadable,
    errors,
    appUrlValue,
  };
}

async function main(): Promise<number> {
  const prod = await auditTarget('production');
  const preview = await auditTarget('preview');

  const failures: string[] = [];
  if (prod.missing.length > 0) failures.push(`Production missing: ${prod.missing.join(', ')}`);
  if (prod.staleHits.length > 0) failures.push(`Production stale app.omnivyra.com refs in: ${prod.staleHits.map((s) => s.variable).join(', ')}`);
  if (preview.missing.length > 0) failures.push(`Preview missing: ${preview.missing.join(', ')}`);
  if (preview.staleHits.length > 0) failures.push(`Preview stale app.omnivyra.com refs in: ${preview.staleHits.map((s) => s.variable).join(', ')}`);
  if (prod.appUrlValue && !prod.appUrlValue.includes(CANONICAL_APP_HOST)) {
    failures.push(`Production NEXT_PUBLIC_APP_URL does not contain canonical host '${CANONICAL_APP_HOST}': ${prod.appUrlValue}`);
  }
  if (preview.appUrlValue && !preview.appUrlValue.includes(CANONICAL_APP_HOST)) {
    failures.push(`Preview NEXT_PUBLIC_APP_URL does not contain canonical host '${CANONICAL_APP_HOST}': ${preview.appUrlValue}`);
  }

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ production: prod, preview, failures }, null, 2));
  } else {
    for (const target of [['Production', prod], ['Preview', preview]] as const) {
      const [label, audit] = target;
      console.log(`\n== Vercel ${label} ==`);
      console.log('  Present:');
      for (const p of audit.presence) console.log(`    - ${p.name} (${p.lastUpdated ?? 'unknown'})`);
      if (audit.missing.length > 0) console.log(`  Missing: ${audit.missing.join(', ')}`);
      if (audit.unreadable.length > 0) console.log(`  Unreadable (sensitive-by-default): ${audit.unreadable.join(', ')}`);
      if (audit.staleHits.length > 0) {
        console.log('  Stale app.omnivyra.com refs:');
        for (const s of audit.staleHits) console.log(`    - ${s.variable} = ${s.value}`);
      }
      for (const e of audit.errors) console.log(`  ERROR: ${e}`);
    }
    console.log(`\nResult: ${failures.length === 0 ? 'PASS' : 'FAIL'}`);
    for (const f of failures) console.log(`  ❌ ${f}`);
  }

  return failures.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('vercelEnvAudit: fatal error', err);
  process.exit(2);
});
