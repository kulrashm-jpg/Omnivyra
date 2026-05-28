/**
 * Run the durable execution stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormDurableExecutionStress.ts
 */

import {
  formatDurableStressReport,
  runDurableExecutionStressTests,
} from '../../backend/services/threadRuntime/durableExecutionStressTests';

async function main() {
  const report = await runDurableExecutionStressTests();
  process.stdout.write(formatDurableStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
