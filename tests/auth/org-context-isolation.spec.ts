import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevServer,
  assertStorageIsolation,
  cleanupUsersByEmail,
  createConfirmedUser,
  login,
  logoutInBrowser,
  seedLegacyCompanyKeys,
  snapshot,
  testEmail,
  withBrowser,
  warmAuthRoutes,
} from './authTestHarness';

test('account switching never restores global company or org context', async () => {
  await assertDevServer();
  await warmAuthRoutes();
  const userAEmail = testEmail('auth-org-a');
  const userBEmail = testEmail('auth-org-b');
  try {
    await createConfirmedUser(userAEmail);
    await createConfirmedUser(userBEmail);

    await withBrowser(async (_browser, _context, page) => {
      await login(page, userAEmail);
      await seedLegacyCompanyKeys(page, 'stale-org-a');
      await logoutInBrowser(page);
      assertStorageIsolation(await snapshot(page));

      await login(page, userBEmail);
      const userBState = await snapshot(page);
      assert.equal(userBState.identity.email, userBEmail);
      assertStorageIsolation(userBState);
      assert(!userBState.localStorageKeys.some((key) => key.endsWith(':stale-org-a')));

      await logoutInBrowser(page);
      await login(page, userAEmail);
      const userAState = await snapshot(page);
      assert.equal(userAState.identity.email, userAEmail);
      assertStorageIsolation(userAState);
    });
  } finally {
    await cleanupUsersByEmail([userAEmail, userBEmail]);
  }
});
