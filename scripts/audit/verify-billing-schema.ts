/**
 * CI Guard — Billing Schema Verification (Phase B)
 *
 * Runs the shared billing schema prober and fails CI if any CRITICAL object
 * is missing. Classifies severity, prints remediation guidance, detects
 * partial-migration state.
 *
 * Run:
 *   npx tsx scripts/audit/verify-billing-schema.ts            # advisory
 *   STRICT_BILLING_SCHEMA=true npx tsx scripts/audit/verify-billing-schema.ts
 *
 * Exit codes:
 *   0  — all critical objects present (or DB unreachable in STRICT=off)
 *   1  — a critical billing object is missing (or any missing in STRICT)
 *
 * Requires app env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY). In
 * credential-less CI, set SKIP_BILLING_SCHEMA_CHECK=true to no-op (exit 0).
 */

import { buildBillingSchemaReport } from '../../backend/services/billing/bootstrap/billingSchemaSpec';

async function main(): Promise<number> {
  if (String(process.env.SKIP_BILLING_SCHEMA_CHECK ?? '').toLowerCase() === 'true') {
    console.log('SKIPPED — SKIP_BILLING_SCHEMA_CHECK=true');
    return 0;
  }

  let report;
  try {
    report = await buildBillingSchemaReport();
  } catch (err: unknown) {
    // DB unreachable from CI is not the same as schema-missing. Advisory
    // unless STRICT — then it's a hard fail (the operator asked for it).
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`SCHEMA PROBE UNAVAILABLE — ${msg}`);
    return String(process.env.STRICT_BILLING_SCHEMA ?? '').toLowerCase() === 'true' ? 1 : 0;
  }

  console.log('Billing Schema Verification');
  console.log(`  overall:    ${report.overall}`);
  console.log(`  present:    ${report.counts.present}`);
  console.log(`  missing:    ${report.counts.missing}`);
  console.log(`  unverified: ${report.counts.unverified}`);
  console.log(`  error:      ${report.counts.error}`);

  // Partial-migration detection: some objects from a migration present,
  // others from the SAME migration missing.
  const byMigration = new Map<string, { present: number; missing: number }>();
  for (const r of report.results) {
    const e = byMigration.get(r.migration) ?? { present: 0, missing: 0 };
    if (r.status === 'present') e.present += 1;
    if (r.status === 'missing') e.missing += 1;
    byMigration.set(r.migration, e);
  }
  const partial = [...byMigration.entries()].filter(([, e]) => e.present > 0 && e.missing > 0);
  if (partial.length > 0) {
    console.log('\n⚠ PARTIAL MIGRATION STATE detected:');
    for (const [mig, e] of partial) {
      console.log(`  ${mig}: ${e.present} present / ${e.missing} missing — migration applied incompletely`);
    }
  }

  if (report.counts.missing > 0) {
    console.log('\n=== MISSING OBJECTS ===');
    for (const r of report.results.filter(x => x.status === 'missing')) {
      console.log(`  [${r.severity.toUpperCase()}] ${r.kind} ${r.object}  (migration ${r.migration})`);
    }
  }
  if (report.criticalMissing.length > 0) {
    console.log('\n=== REMEDIATION ===');
    const migs = Array.from(new Set(report.criticalMissing.map(r => r.migration))).sort();
    console.log('  Critical billing objects are missing. Apply the migrations:');
    console.log('    npm run db:push');
    console.log('  or run, in order, in the Supabase SQL editor:');
    for (const m of migs) {
      console.log(`    supabase/migrations/${m}_*.sql`);
    }
    console.log('  Then reload the PostgREST schema cache (see docs/audit/postgrest-schema-remediation.md).');
  }

  const strict = String(process.env.STRICT_BILLING_SCHEMA ?? '').toLowerCase() === 'true';
  if (report.criticalMissing.length > 0) {
    console.log('\nFAIL — critical billing schema missing.');
    return 1;
  }
  if (strict && report.counts.missing > 0) {
    console.log('\nFAIL — STRICT mode and non-critical objects are missing.');
    return 1;
  }
  console.log('\nOK — all critical billing schema objects present.');
  return 0;
}

if (require.main === module) {
  main().then(c => process.exit(c)).catch(err => { console.error('FATAL', err); process.exit(1); });
}

export { main as verifyBillingSchema };
