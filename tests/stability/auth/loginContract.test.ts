import { authSessionContract, supabasePasswordLoginSuccess } from '../contracts/contractFixtures';
import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

describe('stability/auth login contract', () => {
  test('password login remains a two-step server precheck plus Supabase password sign-in flow', () => {
    const page = readRepoFile('pages/login.tsx');

    expectContainsAll(page, [
      "fetch('/api/auth/login'",
      'signInWithPassword',
      // Post-login sync and routing now go through apiFetch (Phase 3
      // standardization). The wrapper attaches Bearer via the canonical
      // browser Supabase singleton.
      "apiFetch('/api/auth/sync-supabase-user'",
      "apiFetch('/api/auth/post-login-route'",
      'mfa_required',
      'factors',
      'Incorrect email or password.',
    ]);
  });

  // e1 2026-11-13 (e9 ruling, no CAPTCHA): the pre-check is no longer an account-existence oracle. It used to
  // answer INVALID_CREDENTIALS vs NO_PASSWORD per account; the contract is now ONE uniform 200 and no reads.
  test('login precheck API answers uniformly and reads no account state', () => {
    const api = readRepoFile('pages/api/auth/login.ts');

    expectContainsAll(api, [
      'type SuccessResponse = { proceed: true }',
      "type ErrorResponse   = { error: string; code?: string }",
      "return res.status(200).json({ proceed: true })",
    ]);
    expect(api).not.toContain("code: 'INVALID_CREDENTIALS'");
    expect(api).not.toContain("code: 'NO_PASSWORD'");
    expect(api).not.toMatch(/supabase\.(from|rpc)\(/);
    expect(api).not.toContain('supabase.auth.admin');
  });

  test('the password-capability RPC stays service_role only (no longer called by the login pre-check)', () => {
    const migration = readRepoFile('supabase/migrations/20260422_auth_user_has_password_fn.sql');

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
