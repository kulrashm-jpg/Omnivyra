import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevServer,
  assertNoResidualAuth,
  cleanupUsersByEmail,
  createConfirmedUser,
  gotoApp,
  login,
  logoutInBrowser,
  snapshot,
  testEmail,
  withBrowser,
  warmAuthRoutes,
} from './authTestHarness';

test('logout revokes server and Supabase browser session across refresh', async () => {
  await assertDevServer();
  await warmAuthRoutes();
  const email = testEmail('auth-logout');
  try {
    await createConfirmedUser(email);

    await withBrowser(async (_browser, _context, page) => {
      await login(page, email);
      const loggedInState = await snapshot(page);
      assert.equal(loggedInState.identity.email, email);
      assert(loggedInState.cookies.includes('omnivyra_session'));
      assert(loggedInState.cookies.some((name) => name.startsWith('sb-')));

      await logoutInBrowser(page);
      await gotoApp(page, '/command-center');
      const afterRefresh = await snapshot(page);
      assert.match(afterRefresh.url, /\/login|\/command-center/);
      assertNoResidualAuth(afterRefresh);
    });
  } finally {
    await cleanupUsersByEmail([email]);
  }
});
