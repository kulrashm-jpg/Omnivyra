import { authSessionContract, supabasePasswordLoginSuccess } from '../contracts/contractFixtures';
import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/auth login contract', () => {
  test('password login remains a two-step server precheck plus Supabase password sign-in flow', () => {
    const page = readRepoFile('pages/login.tsx');

    expectContainsAll(page, [
      "fetch('/api/auth/login'",
      'signInWithPassword',
      "fetch('/api/auth/sync-supabase-user'",
      "fetch('/api/auth/post-login-route'",
      'data.session.access_token',
      'mfa_required',
      'factors',
      'Incorrect email or password.',
    ]);
  });

  test('login precheck API keeps stable success and generic failure contracts', () => {
    const api = readRepoFile('pages/api/auth/login.ts');

    expectContainsAll(api, [
      'type SuccessResponse = { proceed: true }',
      "type ErrorResponse   = { error: string; code?: string }",
      "code: 'INVALID_CREDENTIALS'",
      "code: 'NO_PASSWORD'",
      'supabase_uid',
      "supabase.rpc('auth_user_has_password'",
      "return res.status(200).json({ proceed: true })",
    ]);
    expect(api).not.toContain('supabase.auth.admin');
  });

  test('login password capability uses Supabase Auth as the source of truth', () => {
    const api = readRepoFile('pages/api/auth/login.ts');
    const migration = readRepoFile('supabase/migrations/20260422_auth_user_has_password_fn.sql');

    expectContainsAll(api, [
      'supabase_uid',
      'authHasPassword',
      'publicHasPassword',
      "supabase.rpc('auth_user_has_password'",
      "p_user_id: supabaseUid",
    ]);
    // Source was intentionally refactored (commit 341d46c8 "source password
    // capability from Supabase Auth"): when the user has a supabase_uid, Auth
    // is the source of truth (authHasPassword !== true → NO_PASSWORD);
    // otherwise fall back to public.users.has_password. Lock that decision.
    expect(api).toMatch(/noPassword\s*=\s*hasSupabaseUid\s*\?\s*authHasPassword !== true\s*:\s*!publicHasPassword/);

    expectContainsAll(migration, [
      'CREATE OR REPLACE FUNCTION public.auth_user_has_password',
      'FROM auth.users',
      'encrypted_password IS NOT NULL',
      'GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role',
    ]);
  });

  test('Supabase password session fixture exposes required fields consumed by login', () => {
    const session = supabasePasswordLoginSuccess.data.session;

    expect(session.access_token).toEqual(expect.any(String));
    expect(session.refresh_token).toEqual(expect.any(String));
    expect(session.user.id).toEqual(expect.any(String));
    expect(session.user.email).toEqual(expect.any(String));
    expect(supabasePasswordLoginSuccess.error).toBeNull();
  });

  test('session summary API keeps role, organization, MFA, and step-up shape stable', () => {
    const sessionApi = readRepoFile('pages/api/auth/session.ts');

    expectContainsAll(sessionApi, [
      'authenticated: true',
      "via: p.legacyCookieSuperAdmin ? 'legacy_cookie_bridge' : 'supabase'",
      'supabaseUid: p.supabaseUid',
      'activeOrgId: p.activeOrgId',
      'organizations: p.organizations.map',
      'mfa: {',
      'stepUp: {',
      'legacyCookieSuperAdmin: p.legacyCookieSuperAdmin',
    ]);

    expect(Object.keys(authSessionContract)).toEqual(expect.arrayContaining([
      'authenticated',
      'via',
      'user',
      'session',
      'activeOrgId',
      'organizations',
      'mfa',
      'stepUp',
      'device',
    ]));
  });

  test('password recovery endpoints keep constant response and recovery-login structures stable', () => {
    const reset = readRepoFile('pages/api/auth/reset.ts');
    const recovery = readRepoFile('pages/api/auth/recovery-login.ts');

    expectContainsAll(reset, [
      'type SuccessResponse = { ok: true }',
      "return res.status(200).json({ ok: true })",
      "return res.status(400).json({ error: 'email is required' })",
    ]);
    expect(reset).not.toMatch(/await\s+.*resetPasswordForEmail\(/);
    expect(reset).not.toMatch(/supabase\.auth\.admin/);

    expectMatchesAll(recovery, [
      /return res\.status\(200\)\.json\(\{\s*ok: true,/s,
      /userId,/,
      /revokedOtherSessions: revoked,/,
      /mustReenrollMfa: true,/,
      /code: 'RECOVERY_INVALID'/,
    ]);
  });
});
