/**
 * Run the long-form adaptive learning stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormAdaptiveLearningStress.ts
 */

import {
  formatAdaptiveStressReport,
  runAdaptiveLearningStressTests,
} from '../../backend/services/longForm/adaptiveLearningStressTests';

async function main() {
  const report = await runAdaptiveLearningStressTests();
  process.stdout.write(formatAdaptiveStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
