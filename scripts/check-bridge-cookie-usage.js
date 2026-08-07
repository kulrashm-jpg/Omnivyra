#!/usr/bin/env node
/**
 * Phase 2 — Direct-Cookie Bypass Monotonic-Reduction Guard.
 *
 * Counts every file (under pages/ + backend/, excluding test + migration
 * + report directories) that reads the legacy bridge cookie outside the
 * canonical helpers. The count is allowed to DECREASE over time but
 * MUST NOT INCREASE — adding a new direct-cookie read fails CI.
 *
 * The current ceiling is recorded in `expectedMaxCount` below. After
 * removing direct-cookie reads from a route, lower this number in the
 * same PR. The number is the migration-progress odometer.
 *
 * Allowlist: files in `permanentAllowList` are excluded from the count.
 * Use this for files that are intentionally bridge-aware (the bridge
 * resolver itself, the centralized helper, the audit-removal stub, this
 * script's own self-references).
 *
 * Usage:
 *   node scripts/check-bridge-cookie-usage.js            (CI gate)
 *   node scripts/check-bridge-cookie-usage.js --update   (record current)
 *   node scripts/check-bridge-cookie-usage.js --list     (print files)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['pages', 'backend'];

// Phase 2 ceiling. Lower this in the same PR that migrates a route.
// Tracking this number here makes the migration odometer reviewable.
const expectedMaxCount = 1;

// Files that are intentionally bridge-aware. They MUST NOT count toward
// the migration ceiling.
const permanentAllowList = new Set([
  'backend/security/legacyCookieSuperAdminBridge.ts',
  'backend/security/bridgeCookie.ts',
  'backend/services/superAdminSession.ts',
  // Audit/Phase-1 files that name the cookie in comments or constants.
  'backend/security/IdentityResolver.ts',
]);

const COOKIE_PATTERNS = [
  /req\.cookies\?\.super_admin_session/, // present syntax
  /cookies\.super_admin_session/,         // alt
  /super_admin_session\s*===\s*['"]1['"]/, // strict-equality form
];

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip nested test directories + architecture migration noise.
      if (entry.name === 'tests' || entry.name === '__tests__' || entry.name === 'node_modules') continue;
      if (entry.name === 'architecture-migration') continue;
      out.push(...walk(full));
    } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      if (/\.test\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      out.push(full);
    }
  }
  return out;
}

function findOffenders() {
  const files = SCAN_DIRS.flatMap((d) => walk(path.join(REPO_ROOT, d)));
  const offenders = [];
  for (const file of files) {
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    if (COOKIE_PATTERNS.some((rx) => rx.test(content))) {
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (permanentAllowList.has(rel)) continue;
      offenders.push(rel);
    }
  }
  offenders.sort();
  return offenders;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const offenders = findOffenders();
  const count = offenders.length;

  if (args.has('--list')) {
    for (const f of offenders) console.log(f);
    console.log(`\nTotal: ${count}`);
    return;
  }
  if (args.has('--update')) {
    console.log(`Current count: ${count}`);
    console.log(`Set expectedMaxCount in this script to ${count} to record the new ceiling.`);
    return;
  }

  if (count > expectedMaxCount) {
    console.error(`\n❌ Bridge-cookie direct-read count regressed.`);
    console.error(`   Current: ${count}`);
    console.error(`   Allowed: ${expectedMaxCount}`);
    console.error(`   Files:`);
    for (const f of offenders) console.error(`     ${f}`);
    console.error(`\n   Either migrate the new route to requireCapability + getLegacySuperAdminSession,`);
    console.error(`   OR add the file to permanentAllowList in scripts/check-bridge-cookie-usage.js`);
    console.error(`   if it is intentionally bridge-aware.`);
    process.exit(1);
  }

  if (count < expectedMaxCount) {
    console.log(`✅ Bridge-cookie direct-read count is below the ceiling.`);
    console.log(`   Current: ${count}`);
    console.log(`   Allowed: ${expectedMaxCount}`);
    console.log(`   Lower expectedMaxCount in scripts/check-bridge-cookie-usage.js to ${count} in the same PR.`);
    return;
  }

  console.log(`✅ Bridge-cookie direct-read count at ceiling: ${count}`);
}

main();
