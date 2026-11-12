/**
 * CLASS-2 C1 (e9 sweep): the thread reply lock is a compare-and-set. Its acquire was a blind write,
 * so two operators reading a free (or expired) lock both got `locked: true`; its release cleared a
 * lock someone else had just taken. The real route over the fake database.
 */
let mockUser = 'u-a';
jest.mock('../../../lib/platform/routeFactory', () => ({ createApiRoute: (h: unknown) => h }));
jest.mock('../../services/userContextService', () => ({
  resolveUserContext: async () => ({ userId: mockUser, defaultCompanyId: 'co-a' }),
  enforceCompanyAccess: async () => ({ userId: mockUser }),
}));
jest.mock('../../db/supabaseClient', () => ({
  supabase: { from: (t: string) => require('../helpers/fakeWhatsappDb').fakeTable(t) },
}));

import { fakeDb, failNext, resetFakeDb, type Row } from '../helpers/fakeWhatsappDb';
import handler from '../../../pages/api/engagement/thread/reply-lock';

const thread = (): Row => fakeDb.tables.engagement_threads[0];
async function call(user: string, body: Record<string, unknown>) {
  mockUser = user;
  const res: any = { statusCode: 0, body: undefined };
  res.setHeader = () => res;
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (p: unknown) => { res.body = p; return res; };
  await (handler as any)({ method: 'POST', body: { thread_id: 't1', organization_id: 'co-a', ...body }, headers: {} }, res);
  return res;
}
const seed = (over: Row = {}) => resetFakeDb({ engagement_threads: [{ id: 't1', organization_id: 'co-a', reply_lock_user_id: null, reply_lock_expires_at: null, ...over }] });

beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
afterEach(() => jest.restoreAllMocks());

it('NEGATIVE CONTROL: a free lock is acquired', async () => {
  seed();
  expect((await call('u-a', {})).body).toMatchObject({ locked: true, held_by: 'u-a' });
  expect(thread().reply_lock_user_id).toBe('u-a');
});

it('two operators read the lock free; the second one\'s acquire lands after the first: NOT locked, the first holds it', async () => {
  seed();
  const mod = require('../helpers/fakeWhatsappDb');
  const real = mod.fakeTable;
  let interleaved = false;
  jest.spyOn(mod, 'fakeTable').mockImplementation((t: unknown) => {
    // u-b read the free lock; u-a's acquire lands before u-b's write.
    if (!interleaved && fakeDb.calls.includes('engagement_threads:select')) {
      interleaved = true;
      Object.assign(thread(), { reply_lock_user_id: 'u-a', reply_lock_expires_at: '2099-01-01T00:00:00.000Z' });
    }
    return real(t);
  });
  const res = await call('u-b', {});
  expect(res.body).toMatchObject({ locked: false, held_by: 'u-a' });
  expect(thread().reply_lock_user_id).toBe('u-a');
});

it('release clears only the releaser\'s own lock: a lock taken by someone else since the read survives', async () => {
  seed({ reply_lock_user_id: 'u-a', reply_lock_expires_at: '2099-01-01T00:00:00.000Z' });
  const mod = require('../helpers/fakeWhatsappDb');
  const real = mod.fakeTable;
  let interleaved = false;
  jest.spyOn(mod, 'fakeTable').mockImplementation((t: unknown) => {
    if (!interleaved && fakeDb.calls.includes('engagement_threads:select')) {
      interleaved = true;
      Object.assign(thread(), { reply_lock_user_id: 'u-b' }); // u-a's lock expired; u-b took it (force)
    }
    return real(t);
  });
  await call('u-a', { action: 'release' });
  expect(thread().reply_lock_user_id).toBe('u-b');
});

it('an UNREADABLE thread is 500, not 404 "not found"', async () => {
  seed();
  failNext('engagement_threads', 'select');
  expect((await call('u-a', {})).statusCode).toBe(500);
});

it('NEGATIVE CONTROL: force overrides a lock held by someone else (the client\'s deliberate choice)', async () => {
  seed({ reply_lock_user_id: 'u-b', reply_lock_expires_at: '2099-01-01T00:00:00.000Z' });
  expect((await call('u-a', { force: true })).body).toMatchObject({ locked: true, held_by: 'u-a' });
  // ...and the override is RECORDED (05): who forced, whose lock it took.
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('reply_lock_forced'), expect.objectContaining({ forced_by: 'u-a', previous_holder: 'u-b', thread_id: 't1' }));
});
