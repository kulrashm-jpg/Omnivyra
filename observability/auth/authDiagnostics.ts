import {
  buildReport,
  printReport,
  requiredTokensCheck,
  type DiagnosticCheck,
} from '../_shared';

export function collectAuthDiagnostics(): DiagnosticCheck[] {
  return [
    requiredTokensCheck('auth.login_precheck_contract', 'pages/api/auth/login.ts', [
      'proceed: true',
      'INVALID_CREDENTIALS',
      'NO_PASSWORD',
      '.from(\'users\')',
    ]),
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
      'verifySupabaseAuthHeader',
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
