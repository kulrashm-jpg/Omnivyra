/**
 * Run the long-form factual integrity stress harness.
 *
 * Usage:
 *   npx tsx scripts/ops/longFormFactualIntegrityStress.ts
 *
 * Exits non-zero if any scenario fails. Safe for CI.
 */

import {
  formatFactualStressReport,
  runFactualIntegrityStressTests,
} from '../../backend/services/longForm/factualIntegrityStressTests';

async function main() {
  const report = await runFactualIntegrityStressTests();
  process.stdout.write(formatFactualStressReport(report) + '\n');
  if (report.overall.failed > 0) process.exitCode = 1;
}

void main();
