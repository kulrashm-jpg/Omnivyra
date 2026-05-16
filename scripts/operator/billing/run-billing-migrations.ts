/*
SCRIPT_CLASSIFICATION: OPERATOR
MUTATION_LEVEL: BILLING_MUTATION
SAFE_FOR_CI: NO
SAFE_FOR_PRODUCTION: CAUTION
REQUIRES_EXPLICIT_OPERATOR_INTENT: YES
*/
/**
 * Safe Billing Migration Runner (Phase C)
 *
 * Detects which billing migrations have MISSING objects (via the shared
 * schema prober), then applies ONLY those migrations — idempotently, in
 * dependency order (20260663 → 20260664 → 20260665), inside a transaction
 * per file, refusing anything that contains destructive DDL.
 *
 * Connection: a direct Postgres URL is required to execute DDL (PostgREST
 * cannot run arbitrary DDL). Looked up from SUPABASE_DB_URL or DATABASE_URL.
 * If absent, the runner does NOT execute — it prints exact guidance and
 * exits non-zero so the operator runs `npm run db:push` / the SQL editor.
 *
 * Run:
 *   SUPABASE_DB_URL=postgres://... npx tsx scripts/audit/run-billing-migrations.ts
 *   npx tsx scripts/audit/run-billing-migrations.ts --dry-run
 *   npx tsx scripts/audit/run-billing-migrations.ts --force   # apply all 3 even if probe says present
 *
 * Guarantees: idempotent (files use IF NOT EXISTS / OR REPLACE / DROP
 * TRIGGER IF EXISTS … CREATE), no duplicate object creation, no destructive
 * rollback, dependency order enforced.
 */

import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { buildBillingSchemaReport } from '../../../backend/services/billing/bootstrap/billingSchemaSpec';
import { enforceOperatorSafety } from '../../_core/operatorSafety';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

// Billing migrations in strict dependency order.
const BILLING_MIGRATION_PREFIXES = ['20260663', '20260664', '20260665'] as const;

// Defense in depth: refuse to execute a file containing destructive DDL,
// even though the billing migrations are pre-vetted idempotent.
const DESTRUCTIVE = [
  /\bDROP\s+TABLE\b(?!\s+IF\s+EXISTS\s+\w+_does_not_exist)/i, // any DROP TABLE
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+SCHEMA\b/i,
];

function resolveMigrationFile(prefix: string): string | null {
  const matches = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.startsWith(prefix) && f.endsWith('.sql'))
    : [];
  return matches.length > 0 ? path.join(MIGRATIONS_DIR, matches.sort()[0]) : null;
}

function hasDestructive(sql: string): string | null {
  for (const re of DESTRUCTIVE) {
    const m = sql.match(re);
    if (m) return m[0];
  }
  return null;
}

async function main(): Promise<number> {
  const safety = enforceOperatorSafety({
    scriptName: 'scripts/operator/billing/run-billing-migrations.ts',
    mutationTarget: 'billing/schema',
    intendedAction: 'apply idempotent billing migrations to the configured direct Postgres database',
    example: 'npx tsx scripts/operator/billing/run-billing-migrations.ts --target-env=local --apply',
  });
  if (!safety.allowed) return 0;

  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const force  = argv.includes('--force');

  // 1. Which migrations have missing objects?
  let neededPrefixes: string[] = [...BILLING_MIGRATION_PREFIXES];
  try {
    const report = await buildBillingSchemaReport();
    if (!force) {
      const missingMigs = new Set(report.results.filter(r => r.status === 'missing').map(r => r.migration));
      neededPrefixes = BILLING_MIGRATION_PREFIXES.filter(p => missingMigs.has(p));
    }
    console.log(`Schema probe: overall=${report.overall}, missing=${report.counts.missing}`);
  } catch (err) {
    console.log(`Schema probe unavailable (${err instanceof Error ? err.message : String(err)}) — assuming all billing migrations may be needed.`);
  }

  if (neededPrefixes.length === 0 && !force) {
    console.log('OK — no billing migrations need applying (all probed objects present).');
    return 0;
  }
  console.log(`Migrations to apply (in order): ${neededPrefixes.join(', ')}`);

  // 2. Resolve + safety-scan the files.
  const plan: Array<{ prefix: string; file: string; sql: string }> = [];
  for (const prefix of neededPrefixes) {
    const file = resolveMigrationFile(prefix);
    if (!file) { console.error(`FATAL — migration file for ${prefix} not found in ${MIGRATIONS_DIR}`); return 1; }
    const sql = fs.readFileSync(file, 'utf8');
    const destructive = hasDestructive(sql);
    if (destructive) {
      console.error(`FATAL — refusing to run ${path.basename(file)}: contains destructive DDL "${destructive}".`);
      return 1;
    }
    plan.push({ prefix, file, sql });
  }

  if (dryRun) {
    console.log('\nDRY-RUN — would apply (idempotent, transactional per file):');
    for (const p of plan) console.log(`  ${path.basename(p.file)}  (${p.sql.length} bytes)`);
    return 0;
  }

  // 3. Need a direct Postgres connection to execute DDL.
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('\nNO DB CONNECTION STRING (SUPABASE_DB_URL / DATABASE_URL).');
    console.error('Cannot execute DDL through PostgREST. Apply manually:');
    console.error('  npm run db:push');
    console.error('  — or run these in the Supabase SQL editor, in order:');
    for (const p of plan) console.error(`    supabase/migrations/${path.basename(p.file)}`);
    return 1;
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  let applied = 0;
  try {
    for (const p of plan) {
      console.log(`\nApplying ${path.basename(p.file)} …`);
      try {
        await client.query('BEGIN');
        await client.query(p.sql);
        await client.query('COMMIT');
        applied += 1;
        console.log(`  ✓ committed`);
      } catch (err: unknown) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`  ✗ ROLLED BACK — ${err instanceof Error ? err.message : String(err)}`);
        console.error('  Stopping (later migrations depend on this one).');
        return 1;
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  // 4. Post-migration verification.
  console.log(`\nApplied ${applied} migration(s). Re-verifying schema …`);
  try {
    const post = await buildBillingSchemaReport();
    console.log(`  overall=${post.overall}, present=${post.counts.present}, missing=${post.counts.missing}`);
    if (post.criticalMissing.length > 0) {
      console.error('  ✗ Critical objects STILL missing after apply — investigate.');
      return 1;
    }
  } catch (err) {
    console.log(`  (post-verify probe unavailable: ${err instanceof Error ? err.message : String(err)})`);
  }

  console.log('\nNEXT: reload the PostgREST schema cache so the API sees the new objects.');
  console.log('  See docs/audit/postgrest-schema-remediation.md');
  console.log('OK — billing migrations applied.');
  return 0;
}

if (require.main === module) {
  main().then(c => process.exit(c)).catch(err => { console.error('FATAL', err); process.exit(1); });
}

export { main as runBillingMigrations };
