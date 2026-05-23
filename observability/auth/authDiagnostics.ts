import {
  buildReport,
  fileExists,
  printReport,
  readRepoFile,
  requiredTokensCheck,
  type DiagnosticCheck,
} from '../_shared';

function collectAuthPasswordTruthSourceCheck(): DiagnosticCheck {
  const loginPath = 'pages/api/auth/login.ts';
  const migrationPath = 'supabase/migrations/20260422_auth_user_has_password_fn.sql';
  const details: string[] = [];
  let severity: DiagnosticCheck['severity'] = 'ok';

  if (!fileExists(loginPath)) {
    return {
      name: 'auth.password_truth_source',
      severity: 'warning',
      summary: `${loginPath} is missing.`,
    };
  }

  const login = readRepoFile(loginPath);
  const migration = fileExists(migrationPath) ? readRepoFile(migrationPath) : '';

  const loginUsesAuthRpc = login.includes("supabase.rpc('auth_user_has_password'")
    || login.includes('supabase.rpc("auth_user_has_password"');
  const loginSelectsSupabaseUid = login.includes('supabase_uid');
  const hasCompatibilityFallback = login.includes('publicHasPassword')
    && login.includes('authHasPassword');
  const migrationDefinesRpc = migration.includes('CREATE OR REPLACE FUNCTION public.auth_user_has_password')
    && migration.includes('FROM auth.users')
    && migration.includes('GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role');

  if (!loginUsesAuthRpc) {
    severity = 'warning';
    details.push('login precheck no longer calls auth_user_has_password');
  }
  if (!loginSelectsSupabaseUid) {
    severity = 'warning';
    details.push('login precheck no longer selects users.supabase_uid');
  }
  if (!hasCompatibilityFallback) {
    severity = 'warning';
    details.push('login precheck no longer keeps explicit public/users compatibility variables');
  }
  if (!migrationDefinesRpc) {
    severity = 'warning';
    details.push(`migration contract missing or incomplete: ${migrationPath}`);
  }

  return {
    name: 'auth.password_truth_source',
    severity,
    summary: severity === 'ok'
      ? 'Supabase Auth password state is protected as the login truth source.'
      : 'Password truth-source contract needs review.',
    details,
  };
}

export function collectAuthDiagnostics(): DiagnosticCheck[] {
  return [
    requiredTokensCheck('auth.login_precheck_contract', 'pages/api/auth/login.ts', [
      'proceed: true',
      'INVALID_CREDENTIALS',
      'NO_PASSWORD',
      '.from(\'users\')',
      'supabase_uid',
      "supabase.rpc('auth_user_has_password'",
    ]),
    collectAuthPasswordTruthSourceCheck(),
    requiredTokensCheck('auth.frontend_password_flow_contract', 'pages/login.tsx', [
      '/api/auth/login',
      'signInWithPassword',
      '/api/auth/sync-supabase-user',
      '/api/auth/post-login-route',
      'mfa_required',
    ]),
    requiredTokensCheck('auth.session_shape_contract', 'pages/api/auth/session.ts', [
      'authenticated: true',
      'supabaseUid',
      'activeOrgId',
      'organizations',
      'mfa',
      'stepUp',
      'device',
    ]),
    requiredTokensCheck('auth.user_sync_contract', 'pages/api/auth/sync-supabase-user.ts', [
      'extractAccessToken',
      'validateAuthToken',
      'supabase_uid',
      'ensureSessionForUser',
      'mfa_required',
      'user_company_roles',
      'active_company_id',
    ]),
    requiredTokensCheck('auth.recovery_contract', 'pages/api/auth/reset.ts', [
      'POST',
      'email',
    ]),
  ];
}

export function runAuthDiagnostics(): void {
  printReport(buildReport('auth', collectAuthDiagnostics()));
}

if (require.main === module) {
  runAuthDiagnostics();
}
