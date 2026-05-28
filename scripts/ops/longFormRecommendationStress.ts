/**
 * Run the long-form recommendation engine stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormRecommendationStress.ts
 *
 * Exits non-zero if any scenario fails its assertions. Safe to wire into CI
 * once the engine has any required envvars stubbed (the harness does NOT
 * call the LLM or the DB).
 */

import {
  formatStressTestReport,
  runStressTests,
} from '../../backend/services/longForm/recommendationStressTests';

function main() {
  const report = runStressTests();
  process.stdout.write(formatStressTestReport(report) + '\n');
  if (report.overall.failedScenarios > 0) {
    process.exitCode = 1;
  }
}

main();
