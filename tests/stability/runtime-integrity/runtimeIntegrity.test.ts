import {
  collectOperatorSafetyFindings,
  collectRuntimeIntegrityFindings,
  collectStartupEnvWriteFindings,
} from '../../../config/integrity/runtimeIntegrity';
import { expectContainsAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/runtime-integrity diagnostics', () => {
  test('runtime integrity validator protects startup and import boundaries', () => {
    const source = readRepoFile('config/integrity/runtimeIntegrity.ts');

    expectContainsAll(source, [
      'STARTUP_REFERENCES_OPERATOR_TOOL',
      'START_ALL_MUTATION_REFERENCE',
      'RUNTIME_IMPORTS_OPERATIONAL_TOOLING',
      'FRONTEND_SERVICE_ROLE_REFERENCE',
      'STARTUP_ENV_VALIDATOR_MUTATION_TOKEN',
      'OPERATOR_REMOTE_ACCESS_WITHOUT_SAFETY',
      'OPERATOR_SAFETY_AFTER_REMOTE_SETUP',
      'STARTUP_ENV_WRITE_RISK',
      'SAFE_SETUP_TOOL_ENV_WRITE',
      'exitWarnOnly',
    ]);
    expect(source).not.toContain('spawn(');
    expect(source).not.toContain('execSync');
  });

  test('current runtime integrity scan does not report operator imports in app runtime', () => {
    const findings = collectRuntimeIntegrityFindings();
    const runtimeImportFindings = findings.filter((finding) => finding.code === 'RUNTIME_IMPORTS_OPERATIONAL_TOOLING');

    expect(runtimeImportFindings).toEqual([]);
  });

  test('operator remote safety scan reports only warnings and does not execute operators', () => {
    const findings = collectOperatorSafetyFindings();

    expect(findings.every((finding) => finding.severity === 'warning')).toBe(true);
    expect(findings.some((finding) => finding.code === 'OPERATOR_REMOTE_ACCESS_WITHOUT_SAFETY')).toBe(false);
    expect(findings.some((finding) => finding.file === 'scripts/operator/db/db-push.sh')).toBe(false);
  });

  test('startup env write scan differentiates setup helpers from startup risk', () => {
    const findings = collectStartupEnvWriteFindings({
      dev: 'node scripts/start-all.js --app-only',
      'dev:app': 'node scripts/start-all.js --app-only',
      'dev:full': 'node scripts/start-all.js',
      start: 'next start',
      prestart: 'node -e "require(\'./scripts/dev-runtime-guard\')"',
      'env:validate': 'tsx scripts/validate_startup_env.ts',
    });

    const startupRisks = findings.filter((finding) => finding.code === 'STARTUP_ENV_WRITE_RISK');
    expect(startupRisks).toEqual([]);
  });
});
