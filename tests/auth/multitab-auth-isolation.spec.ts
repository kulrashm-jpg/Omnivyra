import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevServer,
  assertCookieState,
  assertStorageIsolation,
  cleanupUsersByEmail,
  configurePage,
  createConfirmedUser,
  createSignupLink,
  login,
  openSignupAndWaitForIsolation,
  snapshot,
  testEmail,
  verifySignupLink,
  withBrowser,
  warmAuthRoutes,
} from './authTestHarness';

test('multi-tab verification resolves to one stable verified identity', async () => {
  await assertDevServer();
  await warmAuthRoutes();
  const userAEmail = testEmail('auth-tab-a');
  const userBEmail = testEmail('auth-tab-b');
  try {
    await createConfirmedUser(userAEmail);
    const userBLink = await createSignupLink(userBEmail);

    await withBrowser(async (_browser, context) => {
      const tab1 = await context.newPage();
      const tab2 = await context.newPage();
      configurePage(tab1);
      configurePage(tab2);

      await login(tab1, userAEmail);
      assert.equal((await snapshot(tab1)).identity.email, userAEmail);

      await openSignupAndWaitForIsolation(tab2);
      assertStorageIsolation(await snapshot(tab2));

      await tab1.close();
      await verifySignupLink(tab2, userBLink, userBEmail);

      const finalTab2 = await snapshot(tab2);
      assert.equal(finalTab2.identity.email, userBEmail);
      assertStorageIsolation(finalTab2);
      assertCookieState(finalTab2, { omnivyra: 'present', supabase: 'present' });
    });
  } finally {
    await cleanupUsersByEmail([userAEmail, userBEmail]);
  }
});
