import { collectCiIntegrityFindings } from '../../config/integrity/ciIntegrity';
import {
  collectEnvironmentIntegrityFindings,
  collectVercelVisibilityFindings,
} from '../../config/integrity/environmentIntegrity';
import {
  buildReport,
  envPresence,
  loadLocalEnvForDiagnostics,
  printReport,
  summarizeFindings,
  type DiagnosticCheck,
} from '../_shared';

export function collectEnvironmentDiagnostics(): DiagnosticCheck[] {
  return [
    {
      name: 'environment.key_presence',
      severity: 'info',
      summary: 'Environment key presence only; values are not printed.',
      details: Object.entries(envPresence([
        'NODE_ENV',
        'VERCEL_ENV',
        'NEXT_PUBLIC_SUPABASE_URL',
        'SUPABASE_URL',
        'SUPABASE_DB_URL',
        'DATABASE_URL',
      ])).map(([key, state]) => `${key}=${state}`),
    },
    summarizeFindings('environment.supabase_target_consistency', collectEnvironmentIntegrityFindings()),
    summarizeFindings('environment.vercel_visibility', collectVercelVisibilityFindings()),
    summarizeFindings('environment.ci_runtime_consistency', collectCiIntegrityFindings()),
  ];
}

export function runEnvironmentDiagnostics(): void {
  loadLocalEnvForDiagnostics();
  printReport(buildReport('environment', collectEnvironmentDiagnostics()));
}

if (require.main === module) {
  runEnvironmentDiagnostics();
}
