import { expectContainsAll, expectMatchesAll, readRepoFile } from '../contracts/stabilityTestUtils';

/**
 * REGRESSION-LOCK: magic-link (passwordless) login.
 *
 * Locks the two halves of the prefetch-resistant magic-link flow so a future
 * refactor cannot silently regress it:
 *   1. pages/login.tsx requests the link via signInWithOtp with
 *      shouldCreateUser:false and an emailRedirectTo pointing at
 *      /auth/callback?mode=passwordless.
 *   2. pages/auth/callback.tsx consumes ?token_hash=…&type=… by calling
 *      supabase.auth.verifyOtp({ token_hash, type }) defaulting to 'magiclink'.
 *
 * Pure static substring asserts — no network, no DB, no Supabase calls.
 */
describe('stability/auth magic-link login contract', () => {
  test('login.tsx requests a magic link via signInWithOtp without creating users', () => {
    const page = readRepoFile('pages/login.tsx');

    expectContainsAll(page, [
      'signInWithOtp({',
      'shouldCreateUser:  false',
      '/auth/callback?mode=passwordless',
    ]);

    // The OTP request must remain a non-account-creating passwordless sign-in.
    expectMatchesAll(page, [
      /signInWithOtp\(\{[\s\S]*?shouldCreateUser:\s+false[\s\S]*?emailRedirectTo:[\s\S]*?\/auth\/callback\?mode=passwordless/,
    ]);
  });

  test('callback.tsx keeps the prefetch-resistant token_hash verifyOtp magiclink branch', () => {
    const callback = readRepoFile('pages/auth/callback.tsx');

    expectContainsAll(callback, [
      "params.get('token_hash')",
      "params.get('type')",
      'if (tokenHash) {',
      'supabase.auth.verifyOtp({',
      'token_hash: tokenHash,',
      "type: (otpType || 'magiclink')",
    ]);

    // Token must only be consumed by client-side verifyOtp (a mail scanner's
    // plain GET must not be able to burn it).
    expectMatchesAll(callback, [
      /verifyOtp\(\{\s*token_hash:\s*tokenHash,\s*type:\s*\(otpType \|\| 'magiclink'\)/,
    ]);
  });
});
