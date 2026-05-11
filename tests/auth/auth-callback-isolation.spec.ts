import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevServer,
  assertCookieState,
  assertStorageIsolation,
  cleanupUsersByEmail,
  createConfirmedUser,
  createSignupLink,
  login,
  openSignupAndWaitForIsolation,
  seedLegacyCompanyKeys,
  snapshot,
  testEmail,
  verifySignupLink,
  withBrowser,
  warmAuthRoutes,
} from './authTestHarness';

test('auth callback isolation: User B verification cannot restore User A', async () => {
  await assertDevServer();
  await warmAuthRoutes();
  const userAEmail = testEmail('auth-a');
  const userBEmail = testEmail('auth-b');
  try {
    await createConfirmedUser(userAEmail);
    const userBLink = await createSignupLink(userBEmail);

    await withBrowser(async (_browser, _context, page) => {
      await login(page, userAEmail);
      const userAState = await snapshot(page);
      assert.equal(userAState.identity.email, userAEmail);

      await seedLegacyCompanyKeys(page, 'stale-company-a');
      await openSignupAndWaitForIsolation(page);
      assertStorageIsolation(await snapshot(page));

      await verifySignupLink(page, userBLink, userBEmail);
      const verifiedState = await snapshot(page);
      assert.equal(verifiedState.identity.email, userBEmail);
      assert.notEqual(verifiedState.identity.email, userAEmail);
      assertCookieState(verifiedState, { omnivyra: 'present', supabase: 'present' });
      assertStorageIsolation(verifiedState);
      assert.match(verifiedState.url, /\/onboarding|\/command-center|\/auth\/set-password|\/login/);
    });
  } finally {
    await cleanupUsersByEmail([userAEmail, userBEmail]);
  }
});
