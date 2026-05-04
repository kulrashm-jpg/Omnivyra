#!/usr/bin/env node
/**
 * CI guard: fails the build if any *.sql, *.ps1, or *.sh file appears directly under database/
 * (excluding database/_archive/, which is the read-only graveyard).
 *
 * Why: Phase C of the Database & Migration Governance migration consolidated all
 * schema source-of-truth into supabase/migrations/. The database/ folder is now
 * archive-only. Reintroducing schema files there reopens the parallel-source
 * drift problem this migration solved.
 *
 * Usage: node scripts/check-no-database-folder.js
 *   exit code 0 = clean
 *   exit code 1 = violations detected (printed to stderr)
 *
 * Wire into package.json scripts (e.g. "lint:db-folder") and CI as a required check.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'database');
const FORBIDDEN_EXT = new Set(['.sql', '.ps1', '.sh']);
const ALLOWED_NAMES = new Set(['README.md']);
const ARCHIVE_DIR = path.join(ROOT, '_archive');

function walk(dir, violations) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return; // database/ may not exist on a fresh checkout — that's fine
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    // Skip the archive subtree entirely — it is the legitimate, read-only graveyard
    if (full === ARCHIVE_DIR) continue;
    if (entry.isDirectory()) {
      walk(full, violations);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (FORBIDDEN_EXT.has(ext) && !ALLOWED_NAMES.has(entry.name)) {
      violations.push(path.relative(REPO_ROOT, full));
    }
  }
}

const violations = [];
walk(ROOT, violations);

if (violations.length > 0) {
  console.error('\n[check-no-database-folder] VIOLATION');
  console.error(`Found ${violations.length} forbidden file(s) under database/ (outside _archive/):`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nWhy this fails:');
  console.error('  database/ is archive-only after Phase C of Database & Migration Governance.');
  console.error('  All schema changes belong in supabase/migrations/ as YYYYMMDDHHMMSS_<slug>.sql.');
  console.error('  See database/README.md for details.\n');
  process.exit(1);
}

console.log('[check-no-database-folder] OK — no forbidden schema files under database/.');
process.exit(0);
