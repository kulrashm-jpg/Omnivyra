import { collectCiIntegrityFindings } from '../../../config/integrity/ciIntegrity';
import { expectContainsAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/runtime-integrity CI diagnostics', () => {
  test('CI validator checks package and workflow script paths without modifying workflows', () => {
    const source = readRepoFile('config/integrity/ciIntegrity.ts');

    expectContainsAll(source, [
      'PACKAGE_SCRIPT_TARGET_MISSING',
      'PACKAGE_SCRIPT_BUILD_ARTIFACT_NOT_PRESENT',
      'WORKFLOW_SCRIPT_TARGET_MISSING',
      'DB_REPLAY_WORKFLOW_MISSING_TARGET',
      'exitWarnOnly',
      '.github/workflows/db-replay.yml',
    ]);
    expect(source).not.toContain('writeFile');
    expect(source).not.toContain('unlink');
    expect(source).not.toContain('rmSync');
  });

  test('known db-replay workflow missing targets surface as warnings', () => {
    const findings = collectCiIntegrityFindings();
    const dbReplayWarnings = findings.filter((finding) => finding.code === 'DB_REPLAY_WORKFLOW_MISSING_TARGET');

    expect(dbReplayWarnings.map((finding) => finding.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('scripts/db-replay-check.sh'),
      expect.stringContaining('scripts/db-audit-rls.js'),
      expect.stringContaining('scripts/check-no-database-folder.js'),
    ]));
    expect(dbReplayWarnings.every((finding) => finding.severity === 'warning')).toBe(true);
  });

  test('dist build outputs are informational, not missing-source warnings', () => {
    const findings = collectCiIntegrityFindings();
    const distFindings = findings.filter((finding) => finding.message.includes('dist/backend/'));

    expect(distFindings.length).toBeGreaterThan(0);
    expect(distFindings.every((finding) => finding.code === 'PACKAGE_SCRIPT_BUILD_ARTIFACT_NOT_PRESENT')).toBe(true);
    expect(distFindings.every((finding) => finding.severity === 'info')).toBe(true);
  });
});
