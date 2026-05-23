#!/usr/bin/env tsx
/**
 * Live auth-flow runtime probe.
 *
 * Hits the three post-login critical-path endpoints plus the company-profile
 * route against localhost and (optionally) production. Two probe modes:
 *
 *   Mode 1 — UNAUTHED (default). Sends the request with NO Authorization header
 *   and NO cookie. Each route MUST respond with 401. This confirms that the
 *   canonical validators (resolveAuthenticatedUser / extractAccessToken +
 *   validateAuthToken) reject anonymous calls cleanly. Does NOT need a test user.
 *
 *   Mode 2 — AUTHED (--authed). Performs a real password login via Supabase,
 *   captures the access token, then hits each route. Requires
 *   AUTH_PROBE_EMAIL and AUTH_PROBE_PASSWORD env vars. Each route MUST
 *   respond with 200. Verifies post-login chain end-to-end.
 *
 * The script does NOT require @supabase/supabase-js — it calls the
 *   POST <SUPABASE_URL>/auth/v1/token?grant_type=password
 * endpoint directly with the anon key.
 *
 * Usage:
 *   tsx scripts/ops/authRuntimeProbe.ts                     # localhost only, unauthed
 *   tsx scripts/ops/authRuntimeProbe.ts --prod              # prod only, unauthed
 *   tsx scripts/ops/authRuntimeProbe.ts --all               # both
 *   tsx scripts/ops/authRuntimeProbe.ts --all --authed      # full E2E (needs creds)
 *   tsx scripts/ops/authRuntimeProbe.ts --json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type ProbeMode = 'unauthed' | 'authed';
type Origin = { label: string; baseUrl: string };
type Step = { name: string; method: 'GET' | 'POST'; path: string; expectStatus: number[] };
type StepResult = { origin: string; step: string; status: number | 'NETWORK_ERROR' | 'TIMEOUT'; expect: number[]; ok: boolean; error?: string };

const args = process.argv.slice(2);
const argSet = new Set(args);
const JSON_OUTPUT = argSet.has('--json');
const RUN_PROD = argSet.has('--prod') || argSet.has('--all');
const RUN_LOCAL = !argSet.has('--prod') || argSet.has('--all');
const AUTHED = argSet.has('--authed');

const LOCAL_BASE = process.env.AUTH_PROBE_LOCAL_BASE ?? 'http://localhost:3000';
const PROD_BASE = process.env.AUTH_PROBE_PROD_BASE ?? 'https://www.omnivyra.com';
const TIMEOUT_MS = 8000;

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

async function withTimeout(p: Promise<Response>, ms: number): Promise<Response | 'TIMEOUT'> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('TIMEOUT'), ms);
    p.then((r) => { clearTimeout(t); resolve(r); }).catch(() => { clearTimeout(t); resolve('TIMEOUT'); });
  });
}

const STEPS: Step[] = [
  { name: 'login-precheck', method: 'POST', path: '/api/auth/login', expectStatus: [200, 400, 429] },
  { name: 'sync-supabase-user', method: 'POST', path: '/api/auth/sync-supabase-user', expectStatus: [200] },
  { name: 'post-login-route', method: 'GET', path: '/api/auth/post-login-route', expectStatus: [200] },
  { name: 'company-profile', method: 'GET', path: '/api/company-profile?mode=list', expectStatus: [200] },
];

async function loginAndGetToken(supabaseUrl: string, anonKey: string, email: string, password: string): Promise<{ token: string } | { error: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return { error: `Supabase token endpoint returned HTTP ${res.status}` };
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) return { error: 'Supabase token endpoint returned no access_token' };
    return { token: json.access_token };
  } catch (err) {
    return { error: `Token fetch failed: ${(err as Error).message}` };
  }
}

async function probeStep(origin: Origin, step: Step, mode: ProbeMode, token: string | null, expectUnauthed: number[]): Promise<StepResult> {
  const url = `${origin.baseUrl}${step.path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'authed' && token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method: step.method, headers };
  if (step.method === 'POST') {
    init.body = step.name === 'login-precheck'
      ? JSON.stringify({ email: 'auth-probe-bogus@example.invalid' })
      : '{}';
  }
  let response: Response | 'TIMEOUT';
  try {
    response = await withTimeout(fetch(url, init), TIMEOUT_MS);
  } catch (err) {
    return { origin: origin.label, step: step.name, status: 'NETWORK_ERROR', expect: step.expectStatus, ok: false, error: (err as Error).message };
  }
  if (response === 'TIMEOUT') {
    return { origin: origin.label, step: step.name, status: 'TIMEOUT', expect: step.expectStatus, ok: false };
  }
  const status = response.status;
  const expect = mode === 'unauthed' && step.name !== 'login-precheck' ? expectUnauthed : step.expectStatus;
  const ok = expect.includes(status);
  return { origin: origin.label, step: step.name, status, expect, ok };
}

function renderTable(results: StepResult[]): string {
  const header = ['Step', 'Localhost', 'Production', 'Status'];
  const byStep = new Map<string, { local?: StepResult; prod?: StepResult }>();
  for (const r of results) {
    const entry = byStep.get(r.step) ?? {};
    if (r.origin === 'localhost') entry.local = r;
    if (r.origin === 'production') entry.prod = r;
    byStep.set(r.step, entry);
  }
  const data: string[][] = [];
  for (const step of STEPS) {
    const e = byStep.get(step.name) ?? {};
    const local = e.local ? String(e.local.status) : '-';
    const prod = e.prod ? String(e.prod.status) : '-';
    const localOk = e.local ? e.local.ok : true;
    const prodOk = e.prod ? e.prod.ok : true;
    const status = (localOk && prodOk) ? 'PASS' : 'FAIL';
    data.push([step.name, local, prod, status]);
  }
  const widths = header.map((_, i) => Math.max(header[i].length, ...data.map((d) => d[i].length)));
  const pad = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |';
  const sep = '|-' + widths.map((w) => '-'.repeat(w)).join('-|-') + '-|';
  return [pad(header), sep, ...data.map(pad)].join('\n');
}

async function main(): Promise<number> {
  const mode: ProbeMode = AUTHED ? 'authed' : 'unauthed';
  const expectUnauthedStatuses = [401, 403];

  const origins: Origin[] = [];
  if (RUN_LOCAL) origins.push({ label: 'localhost', baseUrl: LOCAL_BASE });
  if (RUN_PROD) origins.push({ label: 'production', baseUrl: PROD_BASE });

  let token: string | null = null;
  if (mode === 'authed') {
    const local = parseEnvFile(join(process.cwd(), '.env.local'));
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? local.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? local.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    const email = process.env.AUTH_PROBE_EMAIL ?? '';
    const password = process.env.AUTH_PROBE_PASSWORD ?? '';
    if (!supabaseUrl || !anonKey) {
      console.error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for --authed mode');
      return 2;
    }
    if (!email || !password) {
      console.error('AUTH_PROBE_EMAIL and AUTH_PROBE_PASSWORD are required for --authed mode');
      return 2;
    }
    const login = await loginAndGetToken(supabaseUrl, anonKey, email, password);
    if ('error' in login) {
      console.error(`Auth probe login failed: ${login.error}`);
      return 2;
    }
    token = login.token;
  }

  const results: StepResult[] = [];
  for (const origin of origins) {
    for (const step of STEPS) {
      const r = await probeStep(origin, step, mode, token, expectUnauthedStatuses);
      results.push(r);
    }
  }

  const failures = results.filter((r) => !r.ok);
  const summary = {
    mode,
    origins: origins.map((o) => o.label),
    results,
    failures: failures.map((f) => ({ origin: f.origin, step: f.step, status: f.status, expect: f.expect })),
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`== Auth runtime probe (mode=${mode}) ==`);
    console.log(renderTable(results));
    if (failures.length > 0) {
      console.log('\nFailures:');
      for (const f of failures) {
        console.log(`  ❌ ${f.origin} :: ${f.step} -> got ${f.status}, expected ${f.expect.join('/')}` + (f.error ? ` (${f.error})` : ''));
      }
    } else {
      console.log('\nResult: PASS');
    }
  }
  return failures.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('authRuntimeProbe: fatal error', err);
  process.exit(2);
});
