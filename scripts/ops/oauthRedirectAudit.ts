#!/usr/bin/env tsx
/**
 * OAuth redirect-URI audit.
 *
 * Asserts that every production OAuth start endpoint generates a redirect_uri
 * rooted at the canonical host (https://www.omnivyra.com), with no
 * `localhost`, `app.omnivyra.com`, or Vercel preview hostnames leaking into
 * the 302 Location header sent to the provider.
 *
 * Mode 1 — STATIC (no flags). Pure source-tree scan. Fast, no network.
 *   - Scans pages/api/**\/*.ts for any `redirect_uri` constants that
 *     include a forbidden host.
 *   - Greps for `app.omnivyra.com` outside the allowlist (auditor self-refs,
 *     archived docs, the Supabase manifest's forbidden_redirect_urls).
 *
 * Mode 2 — LIVE (--live). HTTP probe against production.
 *   - Hits the OAuth start endpoint as the auth-probe user.
 *   - Reads the Location header.
 *   - Asserts the `redirect_uri=` query param contains `www.omnivyra.com`.
 *
 * Usage:
 *   tsx scripts/ops/oauthRedirectAudit.ts          # static only
 *   tsx scripts/ops/oauthRedirectAudit.ts --live   # also live probe
 *   tsx scripts/ops/oauthRedirectAudit.ts --json
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = new Set(process.argv.slice(2));
const JSON_OUTPUT = args.has('--json');
const LIVE = args.has('--live');

const CANONICAL_HOST = 'www.omnivyra.com';
const FORBIDDEN_HOST_PATTERNS = [
  /\bapp\.omnivyra\.com\b/i,
  /\bvercel\.app\b/i,                  // preview hostnames leaking into prod redirect URIs
  /^https?:\/\/localhost[:/]/i,         // localhost in a production URL literal
  /^https?:\/\/127\.0\.0\.1[:/]/i,
];

// Files where stale-host strings are allowed (auditors, archived docs,
// detector regexes, the Supabase forbidden-redirect list).
const STATIC_SCAN_ALLOWLIST = new Set<string>([
  'scripts/ops/oauthRedirectAudit.ts',
  'scripts/ops/vercelEnvAudit.ts',
  'scripts/ops/railwayEnvAudit.ts',
  'scripts/ops/supabase-auth-config.expected.json',
  '.github/workflows/platform-parity.yml',
  'hooks/useShare.ts',
  'architecture-migration/reports/security-wave2b-a/wave-2b-a-implementation-report.md',
]);

const SCAN_ROOTS = ['pages/api', 'backend/auth', 'backend/services'];
const SCAN_FILE_EXT = /\.tsx?$/;

interface Hit { file: string; line: number; excerpt: string; pattern: string }

function* walkFiles(root: string): Generator<string> {
  if (!existsSync(root)) return;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    const st = statSync(cur);
    if (st.isDirectory()) {
      for (const entry of readdirSync(cur)) {
        if (entry === 'node_modules' || entry === '.next' || entry === '.vercel') continue;
        stack.push(join(cur, entry));
      }
    } else if (SCAN_FILE_EXT.test(cur)) {
      yield cur;
    }
  }
}

function staticScan(): Hit[] {
  const hits: Hit[] = [];
  const cwd = process.cwd();
  for (const root of SCAN_ROOTS) {
    const fullRoot = join(cwd, root);
    for (const filePath of walkFiles(fullRoot)) {
      const relPath = relative(cwd, filePath).replace(/\\/g, '/');
      if (STATIC_SCAN_ALLOWLIST.has(relPath)) continue;
      const text = readFileSync(filePath, 'utf8');
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const pattern of FORBIDDEN_HOST_PATTERNS) {
          if (pattern.test(line)) {
            hits.push({
              file: relPath,
              line: i + 1,
              excerpt: line.trim().slice(0, 200),
              pattern: String(pattern),
            });
          }
        }
      }
    }
  }
  return hits;
}

async function liveProbe(): Promise<{ ok: boolean; redirect_uri: string | null; detail: string }> {
  const local = parseEnvFile(join(process.cwd(), '.env.local'));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? local.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? local.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const email = process.env.AUTH_PROBE_EMAIL ?? local.AUTH_PROBE_EMAIL ?? '';
  const password = process.env.AUTH_PROBE_PASSWORD ?? local.AUTH_PROBE_PASSWORD ?? '';
  if (!supabaseUrl || !anonKey || !email || !password) {
    return { ok: false, redirect_uri: null, detail: 'live probe requires NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, AUTH_PROBE_EMAIL, AUTH_PROBE_PASSWORD' };
  }
  const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!tokenRes.ok) return { ok: false, redirect_uri: null, detail: `Supabase token endpoint HTTP ${tokenRes.status}` };
  const tokJson = await tokenRes.json() as { access_token?: string };
  const accessToken = tokJson.access_token;
  if (!accessToken) return { ok: false, redirect_uri: null, detail: 'no access_token returned from Supabase' };

  // Probe the LinkedIn legacy start, which is the only auth-only OAuth start
  // we can hit without a real company membership (community-ai connector
  // start requires a company role).
  const probeRes = await fetch('https://www.omnivyra.com/api/auth/linkedin?returnTo=/dashboard', {
    redirect: 'manual',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const location = probeRes.headers.get('location') ?? '';
  if (probeRes.status !== 307 && probeRes.status !== 302) {
    return { ok: false, redirect_uri: null, detail: `LinkedIn start returned HTTP ${probeRes.status}, expected 302/307` };
  }
  let redirectUri: string | null = null;
  try {
    const params = new URL(location).searchParams;
    redirectUri = params.get('redirect_uri');
  } catch {
    return { ok: false, redirect_uri: null, detail: `Location header is not a valid URL: ${location.slice(0, 200)}` };
  }
  if (!redirectUri) return { ok: false, redirect_uri: null, detail: 'no redirect_uri in Location header' };
  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (pattern.test(redirectUri)) {
      return { ok: false, redirect_uri: redirectUri, detail: `forbidden host detected (${pattern}) in redirect_uri` };
    }
  }
  if (!redirectUri.includes(CANONICAL_HOST)) {
    return { ok: false, redirect_uri: redirectUri, detail: `redirect_uri does not contain canonical host '${CANONICAL_HOST}'` };
  }
  return { ok: true, redirect_uri: redirectUri, detail: 'canonical host enforced' };
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
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
  return out;
}

async function main(): Promise<number> {
  const staticHits = staticScan();
  const live = LIVE ? await liveProbe() : null;

  const failed = staticHits.length > 0 || (live && !live.ok);

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({
      static: { hits: staticHits, count: staticHits.length },
      live,
      status: failed ? 'FAIL' : 'PASS',
    }, null, 2));
  } else {
    console.log('== OAuth redirect-URI audit ==');
    console.log(`  scanned: ${SCAN_ROOTS.join(', ')}`);
    console.log(`  static hits: ${staticHits.length}`);
    for (const h of staticHits.slice(0, 20)) {
      console.log(`    ❌ ${h.file}:${h.line} — ${h.excerpt}`);
    }
    if (live) {
      console.log('');
      console.log(`  live probe: ${live.ok ? 'PASS' : 'FAIL'}`);
      console.log(`    redirect_uri: ${live.redirect_uri ?? '<unresolved>'}`);
      console.log(`    detail: ${live.detail}`);
    }
    console.log(`\nResult: ${failed ? 'FAIL' : 'PASS'}`);
  }
  return failed ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((err) => {
  console.error('oauthRedirectAudit: fatal error', err);
  process.exit(2);
});
