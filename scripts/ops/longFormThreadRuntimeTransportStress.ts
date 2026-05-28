/**
 * Run the thread runtime transport stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormThreadRuntimeTransportStress.ts
 */

import {
  formatTransportStressReport,
  runThreadRuntimeTransportStressTests,
} from '../../backend/services/threadRuntime/threadRuntimeTransportStressTests';

async function main() {
  const report = await runThreadRuntimeTransportStressTests();
  process.stdout.write(formatTransportStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
