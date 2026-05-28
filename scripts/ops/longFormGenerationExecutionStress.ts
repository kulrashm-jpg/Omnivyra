/**
 * Run the long-form generation-execution stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormGenerationExecutionStress.ts
 *
 * Exits non-zero if any scenario fails. Safe for CI.
 */

import {
  formatExecutionStressReport,
  runGenerationExecutionStressTests,
} from '../../backend/services/longForm/generationExecutionStressTests';

async function main() {
  const report = await runGenerationExecutionStressTests();
  process.stdout.write(formatExecutionStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
