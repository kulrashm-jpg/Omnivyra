import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevServer,
  assertNoResidualAuth,
  cleanupUsersByEmail,
  createSignupLink,
  replayExpiredLink,
  snapshot,
  testEmail,
  verifySignupLink,
  withBrowser,
  warmAuthRoutes,
} from './authTestHarness';
import { findAuthStateKeys } from './authStateKeys';

test('expired or reused verification link fails closed and leaves no auth state', async () => {
  await assertDevServer();
  await warmAuthRoutes();
  const email = testEmail('auth-expired');
  try {
    const actionLink = await createSignupLink(email);

    await withBrowser(async (_browser, _context, page) => {
      await verifySignupLink(page, actionLink, email);
      const verifiedState = await snapshot(page);
      assert.equal(verifiedState.identity.email, email);

      await replayExpiredLink(page, actionLink);
      const expiredState = await snapshot(page);
      assert.match(expiredState.url, /\/login\?error=verification_invalid_or_expired/);
      assertNoResidualAuth(expiredState);
      assert.equal(expiredState.orgContext.status, null);
      // Auth-specific, not "sessionStorage must be empty": anonymous visitor
      // telemetry (omn_session / omn_journey) legitimately survives.
      assert.deepEqual(findAuthStateKeys(expiredState.sessionStorageKeys), []);
    });
  } finally {
    await cleanupUsersByEmail([email]);
  }
});
