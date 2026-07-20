#!/usr/bin/env node
/**
 * Migration quality gate (ENG-IMPL-002) — PREVENTATIVE, new-migrations-only.
 *
 * Enforces, for migrations authored AFTER this gate landed:
 *   1. Naming — unique full `YYYYMMDDHHMMSS_<slug>.sql` timestamp prefix.
 *      Rejects the legacy date-only `YYYYMMDD_*` format that caused the
 *      historical collisions (ENG-AUDIT-002), and rejects any prefix that
 *      collides with an existing migration's version.
 *   2. Idempotency — additive statements must be guarded so re-application is
 *      safe: CREATE TABLE / CREATE [UNIQUE] INDEX / ADD COLUMN require
 *      `IF NOT EXISTS`.
 *
 * Historical migrations are IMMUTABLE. The set of files that existed when this
 * gate landed is frozen in scripts/migrations/historical-baseline.txt; every
 * file in that list is skipped (no retroactive failures, no history rewrite).
 * Only top-level `supabase/migrations/*.sql` files ABSENT from the baseline are
 * validated. Subdirectory companions (rollback.sql / verification.sql) are
 * intentionally exempt — rollback files are deliberately non-idempotent.
 *
 * Deterministic, read-only, no DB / network / secrets. Identical local and CI
 * execution. Exit 0 = clean; exit 1 = violations (actionable diagnostics).
 */
const fs = require('fs');
const path = require('path');

const MIG_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const BASELINE = path.join(process.cwd(), 'scripts', 'migrations', 'historical-baseline.txt');
const NEW_NAME_RE = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const LEGACY_DATE_RE = /^\d{8}_/;

function listSql(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rp = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listSql(path.join(dir, e.name), rp));
    else if (e.name.endsWith('.sql')) out.push(rp);
  }
  return out;
}

function versionPrefix(name) {
  const m = path.basename(name).match(/^(\d+)/);
  return m ? m[1] : null;
}

// Idempotency checks — high-confidence, low-false-positive. Each returns the
// 1-indexed line of the first offending statement, or null.
function idempotencyViolations(sql) {
  const v = [];
  const lines = sql.split('\n');
  lines.forEach((line, i) => {
    const l = line.replace(/--.*$/, ''); // strip line comments
    if (/\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(l))
      v.push({ line: i + 1, rule: 'CREATE TABLE must use IF NOT EXISTS', text: line.trim() });
    if (/\bCREATE\s+(UNIQUE\s+)?INDEX\s+(CONCURRENTLY\s+)?(?!IF\s+NOT\s+EXISTS)/i.test(l))
      v.push({ line: i + 1, rule: 'CREATE INDEX must use IF NOT EXISTS', text: line.trim() });
    if (/\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i.test(l))
      v.push({ line: i + 1, rule: 'ADD COLUMN must use IF NOT EXISTS', text: line.trim() });
  });
  return v;
}

function main() {
  if (!fs.existsSync(MIG_DIR)) { console.log('[migration-quality] no supabase/migrations — skip'); process.exit(0); }
  const baseline = new Set(
    fs.existsSync(BASELINE)
      ? fs.readFileSync(BASELINE, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)
      : [],
  );
  const all = listSql(MIG_DIR);
  const allPrefixes = new Map(); // prefix -> [files]
  for (const f of all) {
    const p = versionPrefix(f);
    if (p) { if (!allPrefixes.has(p)) allPrefixes.set(p, []); allPrefixes.get(p).push(f); }
  }

  // New = top-level .sql not in the frozen baseline.
  const newFiles = all.filter((f) => !baseline.has(f) && !f.includes('/'));
  const errors = [];

  for (const f of newFiles) {
    const base = path.basename(f);
    // 1. Naming
    if (LEGACY_DATE_RE.test(base) && !NEW_NAME_RE.test(base)) {
      errors.push(`${f}\n    ✗ legacy date-only prefix — new migrations must use YYYYMMDDHHMMSS_<slug>.sql (14-digit timestamp).`);
    } else if (!NEW_NAME_RE.test(base)) {
      errors.push(`${f}\n    ✗ invalid filename — expected YYYYMMDDHHMMSS_<lower_snake>.sql.`);
    } else {
      // 2. Uniqueness — the 14-digit prefix must not collide with any OTHER migration.
      const p = versionPrefix(f);
      const others = (allPrefixes.get(p) || []).filter((x) => x !== f);
      if (others.length) {
        errors.push(`${f}\n    ✗ duplicate version prefix ${p} — also used by: ${others.join(', ')}. Use a unique timestamp.`);
      }
    }
    // 3. Idempotency
    const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    for (const viol of idempotencyViolations(sql)) {
      errors.push(`${f}:${viol.line}\n    ✗ ${viol.rule}\n      ${viol.text}`);
    }
  }

  const out = {
    event: 'migration_quality.check',
    historical_frozen: baseline.size,
    total_migrations: all.length,
    new_migrations_validated: newFiles.length,
    violations: errors.length,
  };
  console.log(JSON.stringify(out));

  if (errors.length) {
    process.stderr.write('\n[migration-quality] VIOLATIONS in new migrations:\n\n');
    errors.forEach((e) => process.stderr.write('  ' + e + '\n\n'));
    process.stderr.write(
      'Fix: name new migrations YYYYMMDDHHMMSS_<slug>.sql with a unique timestamp, and\n' +
      'guard additive DDL with IF NOT EXISTS. See docs/migration-discipline.md.\n',
    );
    process.exit(1);
  }
  console.log(`[migration-quality] OK — ${newFiles.length} new migration(s) valid; ${baseline.size} historical frozen.`);
  process.exit(0);
}

main();
