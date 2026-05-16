import { collectCiIntegrityFindings } from '../../config/integrity/ciIntegrity';
import {
  collectEnvironmentIntegrityFindings,
  collectVercelVisibilityFindings,
} from '../../config/integrity/environmentIntegrity';
import {
  collectOperatorSafetyFindings,
  collectRuntimeIntegrityFindings,
} from '../../config/integrity/runtimeIntegrity';
import { collectAuthDiagnostics } from '../auth/authDiagnostics';
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
    summarizeAuthDiagnostics(),
    collectStabilityAvailability(),
  ];
}

function summarizeAuthDiagnostics(): DiagnosticCheck {
  const checks = collectAuthDiagnostics();
  const warnings = checks.filter((check) => check.severity === 'warning');
  const infos = checks.filter((check) => check.severity === 'info');
  return {
    name: 'platform.auth_contracts',
    severity: warnings.length > 0 ? 'warning' : infos.length > 0 ? 'info' : 'ok',
    summary: `${warnings.length} warning check(s), ${infos.length} info check(s).`,
    details: checks
      .filter((check) => check.severity !== 'ok')
      .slice(0, 20)
      .map((check) => `${check.severity.toUpperCase()} ${check.name}: ${check.summary}`),
  };
}

export function runPlatformHealthDiagnostics(): void {
  loadLocalEnvForDiagnostics();
  printReport(buildReport('platform-health', collectPlatformHealthDiagnostics()));
}

if (require.main === module) {
  runPlatformHealthDiagnostics();
}
