import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/auth user sync and company context contract', () => {
  test('sync-supabase-user preserves public user mapping and MFA gate response shape', () => {
    const sync = readRepoFile('pages/api/auth/sync-supabase-user.ts');

    expectContainsAll(sync, [
      'type SuccessResponse = {',
      'ok: true',
      'mfa_required?: true',
      "factors?: ReadonlyArray<'totp' | 'webauthn'>",
      'verifySupabaseAuthHeader',
      '.eq(\'supabase_uid\', supabaseUid)',
      'supabase_uid',
      'has_password',
      'ensureSessionForUser',
    ]);
  });

  test('post-login routing remains based on user/company role context', () => {
    const route = readRepoFile('pages/api/auth/post-login-route.ts');

    expectContainsAll(route, [
      'user_company_roles',
      'company_id',
      'role',
      'status',
      'route',
      'selectCompatibleCompanyRole',
      'deprecated runtime authorities',
    ]);
    expectMatchesAll(route, [
      /res\.status\(200\)\.json\(\{[^}]*route/s,
      /sendAuthError\(res, AUTH_ERROR_CODE\.(INVALID_SESSION|USER_NOT_FOUND|ACCOUNT_DELETED)/,
    ]);
  });
});
