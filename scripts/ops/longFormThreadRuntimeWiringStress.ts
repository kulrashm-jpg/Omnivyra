/**
 * Run the thread runtime observability wiring stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormThreadRuntimeWiringStress.ts
 */

import {
  formatWiringStressReport,
  runThreadRuntimeWiringStressTests,
} from '../../backend/services/threadRuntime/threadRuntimeWiringStressTests';

async function main() {
  const report = await runThreadRuntimeWiringStressTests();
  process.stdout.write(formatWiringStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
