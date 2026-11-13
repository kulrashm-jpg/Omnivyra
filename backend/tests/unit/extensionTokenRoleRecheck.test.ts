/**
 * e9 BLOCKING (b): an extension token's user must STILL hold EXECUTE_ACTIONS (Publisher / Admin) in the token's company
 * on every request - a role downgrade revokes the token. Lookup failure is 503 (retryable, nothing granted), never a
 * silent allow and never read as a revocation. Only ALLOWED results are cached.
 */
const mockDb: { rows: Array<{ role: string }>; error: { message: string } | null; superAdmin: boolean; reads: number } = {
  rows: [], error: null, superAdmin: false, reads: 0,
};
jest.mock('@/backend/db/supabaseClient', () => ({
  supabase: {
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.then = (res: any, rej: any) => { mockDb.reads += 1; return Promise.resolve({ data: mockDb.error ? null : mockDb.rows, error: mockDb.error }).then(res, rej); };
      return b;
    },
  },
}));
jest.mock('@/backend/services/rbacService', () => ({
  ...jest.requireActual('@/backend/services/rbacService'),
  isPlatformSuperAdmin: async () => mockDb.superAdmin,
}));

import { extensionUserMayExecute, EXTENSION_ROLE_CACHE_MS, __resetExtensionRoleCacheForTests } from '@/backend/middleware/extensionAuthMiddleware';

const U = 'user-1'; const O = 'org-1'; const T0 = 1_800_000_000_000;
beforeEach(() => { mockDb.rows = []; mockDb.error = null; mockDb.superAdmin = false; mockDb.reads = 0; __resetExtensionRoleCacheForTests(); });

it.each(['CONTENT_PUBLISHER', 'COMPANY_ADMIN', 'company_admin'])('%s holds EXECUTE_ACTIONS -> allow', async (role) => {
  mockDb.rows = [{ role }];
  expect(await extensionUserMayExecute(U, O, T0)).toBe('allow');
});

it.each(['VIEWER', 'CONTENT_ENGAGER', 'CONTENT_CREATOR', 'CONTENT_REVIEWER'])('%s does NOT -> deny', async (role) => {
  mockDb.rows = [{ role }];
  expect(await extensionUserMayExecute(U, O, T0)).toBe('deny');
});

it('no active membership -> deny; a platform super-admin -> allow', async () => {
  expect(await extensionUserMayExecute(U, O, T0)).toBe('deny');
  mockDb.superAdmin = true;
  expect(await extensionUserMayExecute(U, O, T0)).toBe('allow');
});

it('a lookup ERROR -> unavailable (503 at the middleware), never allow, never deny', async () => {
  mockDb.rows = [{ role: 'COMPANY_ADMIN' }];
  mockDb.error = { message: 'connection reset' };
  expect(await extensionUserMayExecute(U, O, T0)).toBe('unavailable');
});

it('DOWNGRADE revokes: allowed (cached) -> role lowered -> denied once the cache lapses', async () => {
  mockDb.rows = [{ role: 'COMPANY_ADMIN' }];
  expect(await extensionUserMayExecute(U, O, T0)).toBe('allow');
  mockDb.rows = [{ role: 'VIEWER' }];
  expect(await extensionUserMayExecute(U, O, T0 + 1000)).toBe('allow'); // within the cache window (stated bound)
  expect(await extensionUserMayExecute(U, O, T0 + EXTENSION_ROLE_CACHE_MS + 1)).toBe('deny');
});

it('a DENY is not cached: a re-grant takes effect on the next request', async () => {
  mockDb.rows = [{ role: 'VIEWER' }];
  expect(await extensionUserMayExecute(U, O, T0)).toBe('deny');
  mockDb.rows = [{ role: 'CONTENT_PUBLISHER' }];
  expect(await extensionUserMayExecute(U, O, T0 + 1)).toBe('allow');
});

it('the cache saves the read for frequent polling (commands): one read per window', async () => {
  mockDb.rows = [{ role: 'COMPANY_ADMIN' }];
  for (let i = 0; i < 5; i++) await extensionUserMayExecute(U, O, T0 + i * 1000);
  expect(mockDb.reads).toBe(1);
});

it('the middleware answers 403 / 503 from the decision (source pin: both branches exist after signature verification)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const src: string = require('fs').readFileSync(require('path').resolve(__dirname, '../../middleware/extensionAuthMiddleware.ts'), 'utf8');
  const sigAt = src.indexOf("error: 'SIGNATURE_INVALID'");
  const recheckAt = src.indexOf('await extensionUserMayExecute(session.userId, session.orgId)');
  expect(sigAt).toBeGreaterThan(0);
  expect(recheckAt).toBeGreaterThan(sigAt);
  expect(src.slice(recheckAt)).toMatch(/status\(503\)[\s\S]*ROLE_CHECK_UNAVAILABLE[\s\S]*status\(403\)[\s\S]*EXTENSION_ROLE_REVOKED[\s\S]*return \{ session \}/);
});

it('05: the cache is BOUNDED - expired entries are pruned on write', async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const m = require('@/backend/middleware/extensionAuthMiddleware');
  mockDb.rows = [{ role: 'COMPANY_ADMIN' }];
  for (let i = 0; i < 10; i++) await extensionUserMayExecute(`u${i}`, O, T0);
  expect(m.__extensionRoleCacheSizeForTests()).toBe(10);
  await extensionUserMayExecute('u-late', O, T0 + EXTENSION_ROLE_CACHE_MS + 1); // all 10 expired -> pruned on this write
  expect(m.__extensionRoleCacheSizeForTests()).toBe(1);
});
