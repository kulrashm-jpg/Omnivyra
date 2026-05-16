import {
  exitWarnOnly,
  IntegrityFinding,
  listFiles,
  readRepoFile,
} from './integrityUtils';

const RUNTIME_DIRS = ['pages', 'components', 'hooks', 'lib', 'backend'] as const;
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;
const OPERATOR_EXTENSIONS = ['.ts', '.js', '.sh'] as const;
const OPERATOR_REMOTE_TOKENS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'createClient(',
  'new Client(',
  'supabase.auth.admin',
] as const;
const STARTUP_ENV_WRITE_TOKENS = [
  'fs.writeFile',
  'fs.writeFileSync',
  'writeFileSync',
  'Set-Content',
  'Out-File',
  '>> .env',
  '> .env',
] as const;
const STARTUP_FILES = [
  'scripts/start-all.js',
  'scripts/dev-runtime-guard.js',
  'scripts/validate_startup_env.ts',
] as const;
const SAFE_SETUP_GLOBS = ['scripts/setup-helpers/'] as const;

export function collectRuntimeIntegrityFindings(): IntegrityFinding[] {
  // Warn-only governance check: visibility for drift, never a runtime fixer.
  const findings: IntegrityFinding[] = [];
  const pkg = JSON.parse(readRepoFile('package.json')) as { scripts: Record<string, string> };
  const startupScripts = ['dev', 'dev:app', 'dev:full', 'start', 'prestart'];

  for (const name of startupScripts) {
    const command = pkg.scripts[name] ?? '';
    if (command.includes('scripts/operator') || command.includes('auth:repair-login')) {
      findings.push({
        severity: 'warning',
        code: 'STARTUP_REFERENCES_OPERATOR_TOOL',
        message: `package script "${name}" references operator tooling.`,
        file: 'package.json',
        recommendation: 'Keep startup scripts free of mutation-capable operator commands.',
      });
    }
  }

  const startAll = readRepoFile('scripts/start-all.js');
  for (const forbidden of ['scripts/operator', 'repair-local-login', 'auth:repair-login', 'supabase db push']) {
    if (startAll.includes(forbidden)) {
      findings.push({
        severity: 'warning',
        code: 'START_ALL_MUTATION_REFERENCE',
        message: `start-all.js contains forbidden startup token: ${forbidden}`,
        file: 'scripts/start-all.js',
        recommendation: 'Startup must not invoke operator, auth repair, or migration push behavior.',
      });
    }
  }

  for (const file of RUNTIME_DIRS.flatMap((dir) => listFiles(dir, CODE_EXTENSIONS))) {
    const source = readRepoFile(file);
    if (source.includes('scripts/operator') || source.includes('scripts/archive') || source.includes('operatorSafety')) {
      findings.push({
        severity: 'warning',
        code: 'RUNTIME_IMPORTS_OPERATIONAL_TOOLING',
        message: 'Runtime code references operator/archive tooling.',
        file,
        recommendation: 'Keep operational tooling isolated from app runtime bundles and API handlers.',
      });
    }
    if (!file.startsWith('pages/api/') && !file.startsWith('backend/') && source.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      findings.push({
        severity: 'warning',
        code: 'FRONTEND_SERVICE_ROLE_REFERENCE',
        message: 'Frontend-facing file references SUPABASE_SERVICE_ROLE_KEY.',
        file,
        recommendation: 'Service-role keys must stay server-only.',
      });
    }
  }

  const startupEnv = readRepoFile('scripts/validate_startup_env.ts');
  for (const mutationToken of ['.insert(', '.update(', '.upsert(', '.delete(', 'supabase.auth.admin']) {
    if (startupEnv.includes(mutationToken)) {
      findings.push({
        severity: 'warning',
        code: 'STARTUP_ENV_VALIDATOR_MUTATION_TOKEN',
        message: `validate_startup_env.ts contains mutation token ${mutationToken}.`,
        file: 'scripts/validate_startup_env.ts',
        recommendation: 'Startup env validation should remain read-only.',
      });
    }
  }

  findings.push(...collectOperatorSafetyFindings());
  findings.push(...collectStartupEnvWriteFindings(pkg.scripts));

  return findings;
}

export function collectOperatorSafetyFindings(): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  for (const file of listFiles('scripts/operator', OPERATOR_EXTENSIONS)) {
    if (file.endsWith('/README.md') || file.includes('/sql/')) continue;
    const source = readRepoFile(file);
    const scanSource = stripComments(source);
    const tokenIndexes = OPERATOR_REMOTE_TOKENS
      .map((token) => ({ token, index: scanSource.indexOf(token) }))
      .filter((entry) => entry.index >= 0);
    if (tokenIndexes.length === 0) continue;

    const safetyIndex = findSafetyEntrypointIndex(scanSource);
    const firstRemoteIndex = Math.min(...tokenIndexes.map((entry) => entry.index));

    if (safetyIndex < 0) {
      findings.push({
        severity: 'warning',
        code: 'OPERATOR_REMOTE_ACCESS_WITHOUT_SAFETY',
        message: `Operator script references remote/client configuration without enforceOperatorSafety: ${tokenIndexes.map((entry) => entry.token).join(', ')}`,
        file,
        recommendation: 'Add a warn-only operator safety check before client creation in a later operator-hardening pass.',
      });
      continue;
    }

    if (safetyIndex > firstRemoteIndex) {
      findings.push({
        severity: 'warning',
        code: 'OPERATOR_SAFETY_AFTER_REMOTE_SETUP',
        message: `Operator safety appears after remote/client setup token ${tokenIndexes.find((entry) => entry.index === firstRemoteIndex)?.token}.`,
        file,
        recommendation: 'Move safety checks before client creation without changing operator behavior.',
      });
    }
  }

  return findings;
}

export function collectStartupEnvWriteFindings(scripts: Record<string, string>): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const startupCommands = ['dev', 'dev:app', 'dev:full', 'start', 'prestart', 'env:validate']
    .map((name) => scripts[name] ?? '')
    .join('\n');
  const startupFiles = new Set<string>(STARTUP_FILES);

  for (const file of listFiles('scripts/setup-helpers', CODE_EXTENSIONS)) {
    startupFiles.add(file);
  }

  for (const file of startupFiles) {
    const source = readRepoFile(file);
    const writeTokens = STARTUP_ENV_WRITE_TOKENS.filter((token) => source.includes(token));
    if (writeTokens.length === 0) continue;
    const touchesEnvFile = /(?:^|[^A-Za-z0-9_])\.env(?:\.local|\.production|\.preview|\.test)?\b/.test(source)
      || /envPath|envLocalPath|envContent/i.test(source);
    if (!touchesEnvFile) continue;

    const isSafeSetupTool = SAFE_SETUP_GLOBS.some((prefix) => file.startsWith(prefix))
      && !startupCommands.includes(file);
    findings.push({
      severity: isSafeSetupTool ? 'info' : 'warning',
      code: isSafeSetupTool ? 'SAFE_SETUP_TOOL_ENV_WRITE' : 'STARTUP_ENV_WRITE_RISK',
      message: `${file} contains env/file write token(s): ${writeTokens.join(', ')}`,
      file,
      recommendation: isSafeSetupTool
        ? 'Keep setup env writes opt-in and outside startup scripts.'
        : 'Startup-adjacent scripts should not rewrite env files or runtime configuration.',
    });
  }

  return findings;
}

function findSafetyEntrypointIndex(source: string): number {
  const indexes = [
    source.indexOf('enforceOperatorSafety'),
    source.indexOf('OPERATOR MUTATION SCRIPT'),
    source.indexOf('--target-env='),
  ].filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#(?!\!).*$/gm, '');
}

export function runRuntimeIntegrity(): void {
  exitWarnOnly('Runtime Integrity Diagnostics', collectRuntimeIntegrityFindings());
}

if (require.main === module) {
  runRuntimeIntegrity();
}
