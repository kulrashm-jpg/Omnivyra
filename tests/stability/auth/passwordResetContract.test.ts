import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

/**
 * REGRESSION-LOCK: password reset (recovery) flow.
 *
 * Locks all four moving parts:
 *   1. pages/login.tsx handleForgotPassword posts /api/auth/reset then calls
 *      resetPasswordForEmail with redirectTo /auth/set-password?flow=recovery.
 *   2. pages/api/auth/reset.ts always returns { ok: true } (no enumeration,
 *      never calls resetPasswordForEmail / supabase.auth.admin server-side).
 *   3. pages/auth/set-password.tsx consumes ?token_hash=…&type=recovery via
 *      verifyOtp (prefetch-resistant) AND keeps the recovery-aware expired
 *      screen ("Request a new reset link" -> /login?mode=forgot).
 *
 * Pure static substring asserts — no network, no DB, no Supabase calls.
 */
describe('stability/auth password reset contract', () => {
  test('login.tsx forgot-password posts /api/auth/reset then calls resetPasswordForEmail to set-password recovery', () => {
    const page = readRepoFile('pages/login.tsx');

    expectContainsAll(page, [
      "fetch('/api/auth/reset'",
      'resetPasswordForEmail(',
      '/auth/set-password?flow=recovery',
    ]);

    expectMatchesAll(page, [
      /resetPasswordForEmail\(\s*trimmed,\s*\{[\s\S]*?redirectTo:[\s\S]*?\/auth\/set-password\?flow=recovery/,
    ]);
  });

  test('reset.ts keeps the constant non-enumerating { ok: true } contract', () => {
    const reset = readRepoFile('pages/api/auth/reset.ts');

    expectContainsAll(reset, [
      'type SuccessResponse = { ok: true }',
      'return res.status(200).json({ ok: true })',
      "return res.status(400).json({ error: 'email is required' })",
    ]);
    // The server endpoint must NOT itself send the reset email or use admin.
    expect(reset).not.toMatch(/await\s+.*resetPasswordForEmail\(/);
    expect(reset).not.toMatch(/supabase\.auth\.admin/);
  });

  test('set-password.tsx keeps the token_hash recovery verifyOtp branch', () => {
    const sp = readRepoFile('pages/auth/set-password.tsx');

    expectContainsAll(sp, [
      "searchParams.get('token_hash')",
      'if (tokenHash) {',
      'supabase.auth.verifyOtp({',
      'token_hash: tokenHash,',
      "type: otpType as 'recovery'",
    ]);

    expectMatchesAll(sp, [
      /verifyOtp\(\{\s*token_hash:\s*tokenHash,\s*type:\s*otpType as 'recovery'/,
    ]);
  });

  test('set-password.tsx keeps the recovery-aware expired screen', () => {
    const sp = readRepoFile('pages/auth/set-password.tsx');

    expectContainsAll(sp, [
      "flow === 'recovery'",
      'Reset link expired',
      'Request a new reset link',
      '/login?mode=forgot',
    ]);

    // Expired-link CTA in recovery mode must route back to forgot-password.
    expectMatchesAll(sp, [
      /flow === 'recovery' \? \(\s*<Link href="\/login\?mode=forgot"/,
    ]);
  });
});
