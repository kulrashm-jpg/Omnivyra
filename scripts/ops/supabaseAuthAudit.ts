#!/usr/bin/env tsx
/**
 * Supabase auth-config validator.
 *
 * Validates the project's Supabase Authentication URL Configuration against
 * the manifest at scripts/ops/supabase-auth-config.expected.json. The
 * manifest is the source of truth for what Site URL and redirect URLs
 * the dashboard SHOULD have; this script does not read the dashboard
 * directly (that needs a Supabase Management API personal access token
 * which is out of scope here).
 *
 * If a SUPABASE_MANAGEMENT_TOKEN env var is set AND a SUPABASE_PROJECT_REF
 * is set (or derivable from SUPABASE_URL), the script will additionally
 * call the Management API to compare the live config to the manifest.
 *
 * Usage:
 *   tsx scripts/ops/supabaseAuthAudit.ts          # validate manifest only
 *   tsx scripts/ops/supabaseAuthAudit.ts --live   # also poll Management API
 *   tsx scripts/ops/supabaseAuthAudit.ts --json
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Set(process.argv.slice(2));
const JSON_OUTPUT = args.has('--json');
const LIVE = args.has('--live');

type Manifest = {
  site_url: string;
  required_redirect_urls: string[];
  forbidden_redirect_urls?: string[];
};

const MANIFEST_PATH = join(process.cwd(), 'scripts/ops/supabase-auth-config.expected.json');

function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    const text = readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.site_url === 'string' &&
      Array.isArray(parsed.required_redirect_urls)
    ) {
      return parsed as Manifest;
    }
    return null;
  } catch {
    return null;
  }
}

function deriveProjectRef(): string | null {
  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    '';
  const match = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : null;
}

async function fetchLiveConfig(projectRef: string, token: string): Promise<{
  site_url: string;
  redirect_uris: string[];
} | { error: string }> {
  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/config/auth`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res.ok) {
      return { error: `Supabase Management API returned HTTP ${res.status}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    const site_url = typeof data.site_url === 'string' ? data.site_url : '';
    const uri_allow_list = typeof data.uri_allow_list === 'string' ? data.uri_allow_list : '';
    const redirect_uris = uri_allow_list
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    return { site_url, redirect_uris };
  } catch (err) {
    return { error: `fetch failed: ${(err as Error).message}` };
  }
}

async function main(): Promise<number> {
  const manifest = loadManifest();
  if (!manifest) {
    if (JSON_OUTPUT) {
      console.log(JSON.stringify({
        status: 'MANIFEST_MISSING',
        path: MANIFEST_PATH,
        hint: 'Create supabase-auth-config.expected.json with shape { site_url, required_redirect_urls, forbidden_redirect_urls? }',
      }, null, 2));
    } else {
      console.error(`Manifest not found: ${MANIFEST_PATH}`);
      console.error('Create it with shape:');
      console.error('  { "site_url": "https://www.omnivyra.com", "required_redirect_urls": [...], "forbidden_redirect_urls": [...] }');
    }
    return 1;
  }

  const failures: string[] = [];

  // Manifest self-validation
  try { new URL(manifest.site_url); } catch { failures.push(`Manifest site_url malformed: ${manifest.site_url}`); }
  if (!manifest.site_url.includes('www.omnivyra.com')) {
    failures.push(`Manifest site_url is not the canonical 'https://www.omnivyra.com': ${manifest.site_url}`);
  }
  for (const u of manifest.required_redirect_urls) {
    try { new URL(u.replace(/\*$/, 'x')); } catch { failures.push(`Manifest redirect URL malformed: ${u}`); }
  }
  const REQUIRED_REDIRECTS = [
    'https://www.omnivyra.com/*',
    'http://localhost:3000/*',
    'http://127.0.0.1:3000/*',
  ];
  for (const r of REQUIRED_REDIRECTS) {
    if (!manifest.required_redirect_urls.includes(r)) {
      failures.push(`Manifest is missing required redirect: ${r}`);
    }
  }

  // Live API check (optional)
  let live: Awaited<ReturnType<typeof fetchLiveConfig>> | null = null;
  if (LIVE) {
    const token = process.env.SUPABASE_MANAGEMENT_TOKEN;
    const projectRef = process.env.SUPABASE_PROJECT_REF ?? deriveProjectRef();
    if (!token) {
      failures.push('--live requested but SUPABASE_MANAGEMENT_TOKEN is not set');
    } else if (!projectRef) {
      failures.push('--live requested but project ref could not be derived (set SUPABASE_PROJECT_REF or SUPABASE_URL)');
    } else {
      live = await fetchLiveConfig(projectRef, token);
      if ('error' in live) {
        failures.push(`Live API check failed: ${live.error}`);
      } else {
        if (live.site_url !== manifest.site_url) {
          failures.push(`Live site_url '${live.site_url}' does not match manifest '${manifest.site_url}'`);
        }
        for (const r of manifest.required_redirect_urls) {
          if (!live.redirect_uris.includes(r)) {
            failures.push(`Live redirect_uris missing required: ${r}`);
          }
        }
        if (manifest.forbidden_redirect_urls) {
          for (const f of manifest.forbidden_redirect_urls) {
            if (live.redirect_uris.includes(f)) {
              failures.push(`Live redirect_uris contains forbidden entry: ${f}`);
            }
          }
        }
      }
    }
  }

  const report = {
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    manifest_path: MANIFEST_PATH,
    manifest,
    live,
    failures,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('== Supabase auth-config audit ==');
    console.log(`  Manifest site_url:           ${manifest.site_url}`);
    console.log(`  Manifest required redirects:`);
    for (const r of manifest.required_redirect_urls) console.log(`    - ${r}`);
    if (manifest.forbidden_redirect_urls) {
      console.log(`  Manifest forbidden redirects:`);
      for (const f of manifest.forbidden_redirect_urls) console.log(`    - ${f}`);
    }
    if (live && !('error' in live)) {
      console.log(`  Live site_url:               ${live.site_url}`);
      console.log(`  Live redirect_uris:`);
      for (const r of live.redirect_uris) console.log(`    - ${r}`);
    }
    console.log(`\nResult: ${report.status}`);
    for (const f of failures) console.log(`  ❌ ${f}`);
  }

  return failures.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('supabaseAuthAudit: fatal error', err);
  process.exit(2);
});
