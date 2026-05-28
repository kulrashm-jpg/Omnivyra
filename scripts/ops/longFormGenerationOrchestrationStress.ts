/**
 * Run the long-form generation-orchestration stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormGenerationOrchestrationStress.ts
 *
 * Exits non-zero if any scenario fails. Safe for CI.
 */

import {
  formatOrchestrationStressReport,
  runGenerationOrchestrationStressTests,
} from '../../backend/services/longForm/generationOrchestrationStressTests';

function main() {
  const report = runGenerationOrchestrationStressTests();
  process.stdout.write(formatOrchestrationStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

main();
