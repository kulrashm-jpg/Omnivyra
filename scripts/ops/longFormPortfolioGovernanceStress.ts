/**
 * Run the long-form portfolio governance stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormPortfolioGovernanceStress.ts
 */

import {
  formatPortfolioStressReport,
  runPortfolioGovernanceStressTests,
} from '../../backend/services/longForm/portfolioGovernanceStressTests';

async function main() {
  const report = await runPortfolioGovernanceStressTests();
  process.stdout.write(formatPortfolioStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
