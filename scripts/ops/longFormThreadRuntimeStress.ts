/**
 * Run the thread runtime observability stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormThreadRuntimeStress.ts
 */

import {
  formatRuntimeStressReport,
  runThreadRuntimeStressTests,
} from '../../backend/services/threadRuntime/threadRuntimeStressTests';

async function main() {
  const report = await runThreadRuntimeStressTests();
  process.stdout.write(formatRuntimeStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
