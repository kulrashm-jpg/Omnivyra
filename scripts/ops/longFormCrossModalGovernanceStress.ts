/**
 * Run the long-form cross-modal governance stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormCrossModalGovernanceStress.ts
 */

import {
  formatCrossModalStressReport,
  runCrossModalGovernanceStressTests,
} from '../../backend/services/longForm/crossModalGovernanceStressTests';

async function main() {
  const report = await runCrossModalGovernanceStressTests();
  process.stdout.write(formatCrossModalStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
