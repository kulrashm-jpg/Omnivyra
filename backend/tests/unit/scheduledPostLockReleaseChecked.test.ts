/**
 * Interim (e9 ruling, 2026-11-11): the scheduled-post lock release result is CHECKED.
 * supabase-js returns { data, error } and does not throw; a SESSION advisory lock released through a
 * different pooled connection returns data=false. Either way the lock may still be held, so release
 * reports "lock not released" instead of assuming success. The lock design itself is pending C11.
 */
const rpcResults: Record<string, any> = {};
jest.mock('../../db/supabaseClient', () => ({
  supabase: { rpc: jest.fn(async (name: string) => {
    const r = rpcResults[name];
    if (r instanceof Error) throw r;
    return r;
  }) },
}));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: jest.fn() }));
jest.mock('../../queue/bullmqClient', () => ({ getQueue: jest.fn() }));
jest.mock('../../middleware/queueBackpressure', () => ({ enqueueOrThrow: jest.fn() }));
jest.mock('../../db/queries', () => ({ createQueueJob: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { tryAcquireScheduledPostQueueLock } = require('../../scheduler/schedulerPostQueueControl');

const POST = '00000000-0000-0000-0000-0000000000aa';
let err: jest.SpyInstance;
beforeEach(() => {
  err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  rpcResults.try_scheduled_post_lock = { data: true, error: null };
});
afterEach(() => err.mockRestore());

const released = () => !err.mock.calls.some((c) => c[0] === '[scheduled-post-lock] lock not released');

describe('scheduled-post lock release is checked (interim)', () => {
  it('data=true: released, nothing reported', async () => {
    rpcResults.release_scheduled_post_lock = { data: true, error: null };
    const lock = await tryAcquireScheduledPostQueueLock(POST);
    expect(lock).toMatchObject({ acquired: true, mode: 'advisory' });
    await lock.release();
    expect(released()).toBe(true);
  });

  it.each([
    ['data=false (a different pooled session did not hold it)', { data: false, error: null }, 'not_held_by_this_session'],
    ['an rpc error returned, not thrown', { data: null, error: { code: '42883', message: 'function does not exist' } }, 'rpc_error'],
    ['the rpc throws', new Error('network'), 'threw'],
  ])('%s: reported as "lock not released"', async (_l, result, reason) => {
    rpcResults.release_scheduled_post_lock = result;
    const lock = await tryAcquireScheduledPostQueueLock(POST);
    await lock.release();
    expect(err).toHaveBeenCalledWith('[scheduled-post-lock] lock not released', expect.objectContaining({ scheduledPostId: POST, reason }));
  });
});
