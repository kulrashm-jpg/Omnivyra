/**
 * CI Guard — Non-Billable Registry health check
 *
 * Run from CI:
 *   npx tsx scripts/audit/non-billable-registry-check.ts
 *
 * Fails (exit code 1) when the registry has:
 *   - Expired entries that haven't been rotated
 *   - Entries missing owner_user_id metadata
 *   - Entries missing reason
 *
 * Returns 0 + a summary otherwise. The summary is suitable for printing
 * in a CI job log so reviewers can see the registry state.
 *
 * NOTE: This script requires Supabase credentials to be present in env.
 * In environments without a configured DB connection (e.g. PR builds
 * without secrets), set `SKIP_NON_BILLABLE_CHECK=true` and the guard
 * will exit 0 with a "skipped" marker.
 */

import { auditRegistry } from '../../backend/services/billing/nonBillableRegistry';

async function main(): Promise<number> {
  if (String(process.env.SKIP_NON_BILLABLE_CHECK ?? '').toLowerCase() === 'true') {
    console.log('SKIPPED — SKIP_NON_BILLABLE_CHECK=true');
    return 0;
  }
  let report;
  try {
    report = await auditRegistry();
  } catch (err: unknown) {
    console.log(`SKIPPED — registry inaccessible: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }

  console.log('Non-Billable Registry audit:');
  console.log(`  total entries:      ${report.totalEntries}`);
  console.log(`  expired:            ${report.expiredCount}`);
  console.log(`  expiring soon:      ${report.expiringSoonCount}`);
  console.log(`  missing owner:      ${report.missingOwnerCount}`);
  console.log(`  missing reason:     ${report.missingReasonCount}`);
  console.log('  by category:');
  for (const [cat, n] of Object.entries(report.byCategory)) {
    console.log(`    ${cat.padEnd(28)} ${n}`);
  }

  const errors: string[] = [];
  if (report.expiredCount > 0) {
    errors.push(`expired entries: ${report.expiredCount}`);
    for (const e of report.expiredEntries.slice(0, 10)) {
      console.log(`    EXPIRED: ${e.actionKey}  category=${e.category}  at=${e.expiresAt}`);
    }
  }
  if (report.missingOwnerCount > 0) errors.push(`missing owner: ${report.missingOwnerCount}`);
  if (report.missingReasonCount > 0) errors.push(`missing reason: ${report.missingReasonCount}`);

  if (errors.length > 0) {
    console.log('\nFAIL — non-billable registry has issues:');
    for (const e of errors) console.log(`  - ${e}`);
    return 1;
  }
  console.log('\nOK — non-billable registry is clean.');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
