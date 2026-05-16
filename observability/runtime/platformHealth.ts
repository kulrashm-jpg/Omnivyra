import { collectCiIntegrityFindings } from '../../config/integrity/ciIntegrity';
import {
  collectEnvironmentIntegrityFindings,
  collectVercelVisibilityFindings,
} from '../../config/integrity/environmentIntegrity';
import {
  collectOperatorSafetyFindings,
  collectRuntimeIntegrityFindings,
} from '../../config/integrity/runtimeIntegrity';
import {
  buildReport,
  fileExists,
  loadLocalEnvForDiagnostics,
  printReport,
  summarizeFindings,
  type DiagnosticCheck,
} from '../_shared';

const STABILITY_SCRIPTS = [
  'test:stability',
  'test:stability:auth',
  'test:stability:billing',
  'test:stability:runtime',
] as const;

function collectStabilityAvailability(): DiagnosticCheck {
  const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const missingScripts = STABILITY_SCRIPTS.filter((script) => !pkg.scripts?.[script]);
  const missingFiles = [
    'jest.stability.config.js',
    'tests/stability/STABILITY_GUARDS.md',
    'tests/stability/auth/loginContract.test.ts',
    'tests/stability/billing/billingContract.test.ts',
    'tests/stability/runtime/runtimeSafetyContract.test.ts',
  ].filter((file) => !fileExists(file));

  return {
    name: 'stability.contract_availability',
    severity: missingScripts.length || missingFiles.length ? 'warning' : 'ok',
    summary: missingScripts.length || missingFiles.length
      ? 'Stability contract entrypoints or expected files are missing.'
      : 'Stability contract entrypoints and expected files are present.',
    details: [
      ...missingScripts.map((script) => `missing package script: ${script}`),
      ...missingFiles.map((file) => `missing file: ${file}`),
    ],
  };
}

export function collectPlatformHealthDiagnostics(): DiagnosticCheck[] {
  // Governance adoption diagnostic: aggregate existing readonly checks only.
  return [
    summarizeFindings('platform.runtime_integrity', collectRuntimeIntegrityFindings()),
    summarizeFindings('platform.environment_integrity', collectEnvironmentIntegrityFindings()),
    summarizeFindings('platform.vercel_visibility', collectVercelVisibilityFindings()),
    summarizeFindings('platform.ci_integrity', collectCiIntegrityFindings()),
    summarizeFindings('platform.operator_safety', collectOperatorSafetyFindings()),
    collectStabilityAvailability(),
  ];
}

export function runPlatformHealthDiagnostics(): void {
  loadLocalEnvForDiagnostics();
  printReport(buildReport('platform-health', collectPlatformHealthDiagnostics()));
}

if (require.main === module) {
  runPlatformHealthDiagnostics();
}
