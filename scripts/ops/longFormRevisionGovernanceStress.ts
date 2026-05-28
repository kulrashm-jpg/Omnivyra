/**
 * Run the long-form revision governance stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormRevisionGovernanceStress.ts
 */

import {
  formatRevisionStressReport,
  runRevisionGovernanceStressTests,
} from '../../backend/services/longForm/revisionGovernanceStressTests';

async function main() {
  const report = await runRevisionGovernanceStressTests();
  process.stdout.write(formatRevisionStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
