/**
 * Run the thread runtime distributed stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormThreadRuntimeDistributedStress.ts
 */

import {
  formatDistributedStressReport,
  runThreadRuntimeDistributedStressTests,
} from '../../backend/services/threadRuntime/threadRuntimeDistributedStressTests';

async function main() {
  const report = await runThreadRuntimeDistributedStressTests();
  process.stdout.write(formatDistributedStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
