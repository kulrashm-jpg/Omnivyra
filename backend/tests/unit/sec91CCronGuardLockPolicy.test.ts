/**
 * SEC-C3 (STEP 3AH-91) — scheduler cycle lock (CronGuard) failure policy.
 *
 * Pins:
 *   1. A client that is still CONNECTING is not "Redis unavailable": the lock
 *      waits (bounded) for readiness and honours a lock held by another
 *      instance. Before the fix every cycle that started during the initial
 *      connect ran unguarded — exactly the deploy-overlap boot cycle where a
 *      second instance exists.
 *   2. Genuine unavailability keeps the documented single-replica policy
 *      (run the cycle; the dangerous side effects carry their own DB claims)
 *      but is now LOUD (structured warning), and CRON_LOCK_FAIL_CLOSED=1
 *      switches it to skip — required before numReplicas > 1.
 *   3. Local development without Redis keeps working (fail-open default).
 */
import { EventEmitter } from 'events';

type FakeClient = EventEmitter & {
  status: string;
  set: jest.Mock;
  get: jest.Mock;
  eval: jest.Mock;
};

let client: FakeClient;

function makeClient(status: string): FakeClient {
  const c = new EventEmitter() as FakeClient;
  c.status = status;
  c.set = jest.fn();
  c.get = jest.fn().mockResolvedValue(null);
  c.eval = jest.fn().mockResolvedValue(1);
  return c;
}

jest.mock('../../queue/standaloneRedisClient', () => ({
  getInstrumentedStandaloneRedisClient: () => client,
  getSharedStandaloneRedisClient: () => client,
  isSharedStandaloneRedisAvailable: () => client?.status === 'ready',
}));

// eslint-disable-next-line import/first
import { CronGuard } from '../../utils/cronGuard';

const OLD = process.env.CRON_LOCK_FAIL_CLOSED;
afterEach(() => {
  if (OLD === undefined) delete process.env.CRON_LOCK_FAIL_CLOSED;
  else process.env.CRON_LOCK_FAIL_CLOSED = OLD;
  jest.useRealTimers();
});

describe('CronGuard.tryAcquireLock', () => {
  it('ready + lock free → acquires; ready + lock held → refuses (unchanged)', async () => {
    client = makeClient('ready');
    client.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const g = new CronGuard();
    await expect(g.tryAcquireLock('me')).resolves.toBe(true);
    await expect(g.tryAcquireLock('me')).resolves.toBe(false);
    expect(client.set).toHaveBeenCalledWith('omnivyra:cron:lock', 'me', 'EX', 90, 'NX');
  });

  it('while the client is still connecting it waits for readiness and honours a held lock', async () => {
    client = makeClient('connecting');
    client.set.mockResolvedValue(null); // another instance holds the cycle lock
    const g = new CronGuard();
    const pending = g.tryAcquireLock('booting-instance');
    setTimeout(() => { client.status = 'ready'; client.emit('ready'); }, 20);
    await expect(pending).resolves.toBe(false);
    expect(client.set).toHaveBeenCalledTimes(1);
  });

  it('restores persisted timestamps once a connecting client becomes ready (no all-tasks boot run)', async () => {
    client = makeClient('connecting');
    client.get.mockResolvedValue(JSON.stringify({ confidenceCalibration: 123 }));
    const g = new CronGuard();
    const pending = g.load();
    setTimeout(() => { client.status = 'ready'; client.emit('ready'); }, 20);
    await expect(pending).resolves.toEqual({ confidenceCalibration: 123 });
  });

  it('a client that never becomes ready is bounded (does not hang the scheduler)', async () => {
    client = makeClient('connecting');
    const g = new CronGuard();
    const started = Date.now();
    await g.tryAcquireLock('me');
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(client.set).not.toHaveBeenCalled();
  }, 10_000);

  it('genuinely unavailable → runs the cycle by default (documented single-replica policy) and says so', async () => {
    client = makeClient('end');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const g = new CronGuard();
    await expect(g.tryAcquireLock('me')).resolves.toBe(true);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/cron_lock_fail_open/);
    warn.mockRestore();
  });

  it('a SET error behaves like unavailability (open by default, loud)', async () => {
    client = makeClient('ready');
    client.set.mockRejectedValue(new Error('ERR max daily request limit exceeded'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(new CronGuard().tryAcquireLock('me')).resolves.toBe(true);
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/cron_lock_fail_open/);
    warn.mockRestore();
  });

  it('CRON_LOCK_FAIL_CLOSED=1 skips the cycle when the lock cannot be verified', async () => {
    process.env.CRON_LOCK_FAIL_CLOSED = '1';
    client = makeClient('end');
    const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(new CronGuard().tryAcquireLock('me')).resolves.toBe(false);
    client = makeClient('ready');
    client.set.mockRejectedValue(new Error('ETIMEDOUT'));
    await expect(new CronGuard().tryAcquireLock('me')).resolves.toBe(false);
    err.mockRestore();
  });
});
