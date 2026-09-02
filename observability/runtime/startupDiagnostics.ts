import { collectRuntimeIntegrityFindings } from '../../config/integrity/runtimeIntegrity';
import {
  buildReport,
  envPresence,
  loadLocalEnvForDiagnostics,
  printReport,
  readRepoFile,
  summarizeFindings,
  type DiagnosticCheck,
} from '../_shared';

function shortHash(value: string | undefined): string | null {
  return value ? value.slice(0, 12) : null;
}

export function collectStartupDiagnostics(): DiagnosticCheck[] {
  const pkg = JSON.parse(readRepoFile('package.json')) as {
    version?: string;
    scripts?: Record<string, string>;
  };
  const startupCommands = {
    dev: pkg.scripts?.dev ?? '',
    start: pkg.scripts?.start ?? '',
    prestart: pkg.scripts?.prestart ?? '',
  };
  const startupCommandText = Object.values(startupCommands).join('\n');

  return [
    {
      name: 'startup.metadata',
      severity: 'info',
      summary: 'Startup diagnostic metadata collected without reading secret values.',
      details: [
        `timestamp=${new Date().toISOString()}`,
        `node_env=${process.env.NODE_ENV ?? 'unset'}`,
        `vercel_env=${process.env.VERCEL_ENV ?? 'unset'}`,
        `app_version=${pkg.version ?? 'unknown'}`,
        `build_hash=${shortHash(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT) ?? 'unavailable'}`,
      ],
    },
    {
      name: 'startup.env_presence',
      severity: 'info',
      summary: 'Environment key presence only; values are not printed.',
      details: Object.entries(envPresence([
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_URL',
        'SUPABASE_DB_URL',
        'DATABASE_URL',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
      ])).map(([key, state]) => `${key}=${state}`),
    },
    {
      name: 'startup.operator_separation',
      severity: startupCommandText.includes('scripts/operator') ? 'warning' : 'ok',
      summary: startupCommandText.includes('scripts/operator')
        ? 'Startup commands reference operator tooling.'
        : 'Startup commands do not reference scripts/operator.',
      details: Object.entries(startupCommands).map(([name, command]) => `${name}: ${command}`),
    },
    summarizeFindings('startup.integrity_collectors', collectRuntimeIntegrityFindings()),
  ];
}

export function runStartupDiagnostics(): void {
  loadLocalEnvForDiagnostics();
  printReport(buildReport('startup', collectStartupDiagnostics()));
}

if (require.main === module) {
  runStartupDiagnostics();
}
