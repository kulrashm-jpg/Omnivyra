/**
 * Run the long-form cross-modal operational stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormCrossModalOperationalStress.ts
 */

import {
  formatOperationalStressReport,
  runCrossModalOperationalStressTests,
} from '../../backend/services/longForm/crossModalOperationalStressTests';

async function main() {
  const report = await runCrossModalOperationalStressTests();
  process.stdout.write(formatOperationalStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
