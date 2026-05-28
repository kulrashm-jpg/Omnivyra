/**
 * Run the long-form cross-modal hardening stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormCrossModalHardeningStress.ts
 */

import {
  formatHardeningStressReport,
  runCrossModalHardeningStressTests,
} from '../../backend/services/longForm/crossModalHardeningStressTests';

async function main() {
  const report = await runCrossModalHardeningStressTests();
  process.stdout.write(formatHardeningStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
