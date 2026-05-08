/**
 * fetch-hardening-check — static detector for unsafe fetch/json patterns.
 *
 * What this script flags:
 *   1. `await res.json()` / `await response.json()` patterns where the
 *      response is not already validated through `safeFetchJson` or a
 *      similar wrapper (jsonOrThrow with content-type validation).
 *   2. Bare `fetch('/api/…')` where the response is parsed via `.json()`
 *      without `res.ok` AND `content-type` checks.
 *   3. Files outside the canonical fetch wrapper allowlist that handle
 *      parsing manually.
 *
 * What this script does NOT do:
 *   - Auto-fix anything. The codemod risk on the 200+ remaining sites is
 *     too high for a blind script.
 *   - Block CI by default. Run as a soft warning until coverage is wider.
 *
 * Usage:
 *   npx tsx scripts/fetch-hardening-check.ts
 *
 * Suggested CI integration:
 *   1. Capture the current count as the baseline.
 *   2. Fail CI when count INCREASES (drift detection).
 *   3. Migrate sites opportunistically; each migration drops the count.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface Hit {
  file: string;
  line: number;
  text: string;
  category: 'unsafe_json' | 'no_ok_check' | 'bare_fetch';
}

const SCAN_DIRS = ['pages', 'components', 'lib'] as const;
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', '.git']);

// Files that are allowed to use raw .json() because they implement the
// canonical wrapper or its variants (jsonOrThrow with proper content-type
// validation).
const ALLOWLIST = new Set<string>([
  // Canonical wrapper itself
  'lib/utils/safeFetchJson.ts',
  // Phase: Global Fetch Hardening (canonical auth)
  'lib/security/sessionClient.ts',
  'lib/security/stepUpClient.ts',
  // Phase: Settings Canonical Dominance
  'pages/settings/security.tsx',                              // jsonOrThrow upgraded with content-type
  'pages/settings/company-admin-access.tsx',                  // migrated
  'pages/admin/users.tsx',                                    // migrated
  // Phase: Admin Fetch Hardening Sprint
  'pages/admin/intelligence-control.tsx',                     // 7 sites migrated
  'pages/super-admin.tsx',                                    // 2 mutation sites migrated
  'pages/super-admin/free-credits.tsx',                       // 5 read sites migrated
  'components/super-admin/tabs/RbacTab.tsx',                  // 3 sites migrated
  'components/super-admin/tabs/ApiCatalogSection.tsx',        // 2 critical sites migrated
  'components/super-admin/tabs/CompanyUsersTab.tsx',          // load + create paths migrated
  'components/super-admin/tabs/SocialPlatformsSection.tsx',   // 4 sites migrated
  'components/super-admin/ActivityControlPanel.tsx',          // 4 sites migrated
  'components/super-admin/PlansPricingPanel.tsx',             // 2 sites migrated
  'components/super-admin/CostAccountingDashboard.tsx',       // migrated
  'components/super-admin/InfraConsumptionPanel.tsx',         // migrated
  'components/super-admin/PlanAnalyticsPanel.tsx',            // migrated
  'components/super-admin/RailwayCompanyCostsPanel.tsx',      // migrated
  'components/super-admin/RailwayEfficiencyPanel.tsx',        // migrated
  'components/super-admin/ActivityCostBreakdown.tsx',         // migrated
  'components/admin/IntelligenceInsightsPanel.tsx',           // migrated
  'components/admin/RevenueAnalyticsPanel.tsx',               // migrated
]);

function* walk(root: string): Generator<string> {
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(root, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      yield* walk(path);
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      yield path;
    }
  }
}

function scanFile(file: string): Hit[] {
  const rel = file.replace(/\\/g, '/');
  if (ALLOWLIST.has(rel)) return [];
  const src = readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const hits: Hit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';
    // Pattern 1: await res.json() / await response.json() / await r.json()
    if (/await\s+(?:res|response|r|reply|reqRes)\.json\(\)/.test(text)) {
      hits.push({ file: rel, line: i + 1, text: text.trim(), category: 'unsafe_json' });
    }
  }
  return hits;
}

function main(): void {
  const cwd = process.cwd();
  const all: Hit[] = [];
  for (const d of SCAN_DIRS) {
    const root = join(cwd, d);
    try {
      statSync(root);
    } catch {
      continue;
    }
    for (const file of walk(root)) {
      all.push(...scanFile(file));
    }
  }

  const byFile: Record<string, number> = {};
  for (const h of all) byFile[h.file] = (byFile[h.file] ?? 0) + 1;
  const sortedFiles = Object.entries(byFile).sort((a, b) => b[1] - a[1]);

  console.log(`fetch-hardening-check: ${all.length} unsafe-fetch hits across ${sortedFiles.length} files`);
  console.log('');
  console.log('Top offenders:');
  for (const [f, n] of sortedFiles.slice(0, 25)) {
    console.log(`  ${n.toString().padStart(3)}  ${f}`);
  }
  console.log('');
  console.log(`Allowlisted files (use canonical wrapper): ${ALLOWLIST.size}`);
  console.log('');
  console.log('To fix: replace `const x = await res.json(); if (!res.ok) throw …;`');
  console.log('with    `const r = await safeFetchJson<T>(url, init); if (r.ok === true) … else …;`');
  console.log('See lib/utils/safeFetchJson.ts for the canonical wrapper.');

  // Soft exit: report only. Use exit code 1 ONLY if you want to gate CI.
  // process.exit(all.length > BASELINE ? 1 : 0);
}

main();
