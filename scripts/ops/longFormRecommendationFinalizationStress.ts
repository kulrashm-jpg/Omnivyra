/**
 * Run the long-form recommendation finalization-phase stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormRecommendationFinalizationStress.ts
 *
 * Exits non-zero if any scenario fails. Safe for CI.
 */

import {
  formatFinalizationStressReport,
  runFinalizationStressTests,
} from '../../backend/services/longForm/recommendationFinalizationStressTests';

function main() {
  const report = runFinalizationStressTests();
  process.stdout.write(formatFinalizationStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

main();
