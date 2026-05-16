import {
  exitWarnOnly,
  extractScriptPaths,
  extractWorkflowRunPaths,
  fileExists,
  IntegrityFinding,
  listFiles,
  readRepoFile,
} from './integrityUtils';

export function collectCiIntegrityFindings(): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> };

  for (const [name, command] of Object.entries(pkg.scripts)) {
    for (const scriptPath of extractScriptPaths(command)) {
      if (!fileExists(scriptPath)) {
        if (isExpectedBuildArtifact(scriptPath)) {
          findings.push({
            severity: 'info',
            code: 'PACKAGE_SCRIPT_BUILD_ARTIFACT_NOT_PRESENT',
            message: `package script "${name}" references expected build artifact ${scriptPath}, which may not exist before build.`,
            file: 'package.json',
            recommendation: 'Run the relevant build before using this command; no source path repair is implied.',
          });
          continue;
        }
        findings.push({
          severity: 'warning',
          code: 'PACKAGE_SCRIPT_TARGET_MISSING',
          message: `package script "${name}" references missing path ${scriptPath}.`,
          file: 'package.json',
          recommendation: 'Update the package script path or restore the referenced script.',
        });
      }
    }
  }

  for (const workflow of listFiles('.github/workflows', ['.yml', '.yaml'])) {
    const source = readRepoFile(workflow);
    for (const scriptPath of extractWorkflowRunPaths(source)) {
      if (!fileExists(scriptPath)) {
        findings.push({
          severity: 'warning',
          code: 'WORKFLOW_SCRIPT_TARGET_MISSING',
          message: `${workflow} references missing path ${scriptPath}.`,
          file: workflow,
          recommendation: 'Restore the workflow target or update the workflow path before relying on CI.',
        });
      }
    }
  }

  const dbReplay = fileExists('.github/workflows/db-replay.yml')
    ? readRepoFile('.github/workflows/db-replay.yml')
    : '';
  for (const expected of ['scripts/db-replay-check.sh', 'scripts/db-audit-rls.js', 'scripts/check-no-database-folder.js']) {
    if (dbReplay.includes(expected) && !fileExists(expected)) {
      findings.push({
        severity: 'warning',
        code: 'DB_REPLAY_WORKFLOW_MISSING_TARGET',
        message: `db-replay workflow references ${expected}, but it does not exist.`,
        file: '.github/workflows/db-replay.yml',
        recommendation: 'Recover the missing readonly CI script or update db-replay.yml in a dedicated CI repair phase.',
      });
    }
  }

  return findings;
}

function isExpectedBuildArtifact(scriptPath: string): boolean {
  return scriptPath.startsWith('dist/')
    || scriptPath.startsWith('build/')
    || scriptPath.startsWith('.next/')
    || scriptPath.includes('/dist/');
}

export function runCiIntegrity(): void {
  exitWarnOnly('CI Integrity Diagnostics', collectCiIntegrityFindings());
}

if (require.main === module) {
  runCiIntegrity();
}
