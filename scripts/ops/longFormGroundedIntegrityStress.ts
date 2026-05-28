/**
 * Run the long-form grounded integrity stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormGroundedIntegrityStress.ts
 *
 * Exits non-zero if any scenario fails. Safe for CI.
 */

import {
  formatGroundedStressReport,
  runGroundedIntegrityStressTests,
} from '../../backend/services/longForm/groundedIntegrityStressTests';

async function main() {
  const report = await runGroundedIntegrityStressTests();
  process.stdout.write(formatGroundedStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
