/**
 * resolveRolloutChecked reports whether the rollout admin config could be READ, so a STOP flag
 * can fail safe (the WhatsApp instant stop). Existing resolution is unchanged: any failure still
 * yields env-only data. Real loader; the canonical Redis client is a test double.
 */
const mockRedis: { configured: boolean; get: () => Promise<string | null>; clientThrows: boolean } = {
  configured: true, get: async () => null, clientThrows: false,
};
jest.mock('../../../lib/redis/canonicalClient', () => ({
  redisConfigured: () => mockRedis.configured,
  getStandaloneRedis: async () => {
    if (mockRedis.clientThrows) throw new Error('client unavailable');
    return { get: () => mockRedis.get() };
  },
}));
jest.mock('../../observability', () => ({ recordRawCounter: () => undefined, recordRawHistogram: () => undefined }));

import { defineRolloutFlag, __resetRolloutAdminCache } from '../../../lib/platform/rollout';
import { resolveRollout, resolveRolloutChecked } from '../../../lib/platform/rolloutAdmin';

const FLAG = defineRolloutFlag({ key: 'test-stop-flag', description: 'test', defaultMode: 'enforce' });
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  (process.env as Record<string, string>).NODE_ENV = 'production'; // the loader skips Redis under 'test'
  mockRedis.configured = true; mockRedis.clientThrows = false; mockRedis.get = async () => null;
  __resetRolloutAdminCache();
});
afterAll(() => { (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV; });

const config = (flags: Record<string, unknown>) => JSON.stringify({ v: 1, flags });

it('read, no override stored: readable true, default decision', async () => {
  expect(await resolveRolloutChecked(FLAG)).toEqual({ decision: { mode: 'enforce', source: 'default' }, adminReadable: true });
});

it('read, killed: readable true, admin-kill', async () => {
  mockRedis.get = async () => config({ 'test-stop-flag': { killed: true } });
  expect(await resolveRolloutChecked(FLAG)).toEqual({ decision: { mode: 'off', source: 'admin-kill' }, adminReadable: true });
});

it.each([
  ['the read throws', () => { mockRedis.get = async () => { throw new Error('ECONNRESET'); }; }],
  ['the client cannot be obtained', () => { mockRedis.clientThrows = true; }],
  ['the stored value is not JSON', () => { mockRedis.get = async () => '{not json'; }],
  ['the stored value has the wrong shape', () => { mockRedis.get = async () => JSON.stringify({ v: 1 }); }],
])('UNREADABLE when %s - and plain resolveRollout is unchanged (env-only)', async (_l, arrange) => {
  arrange();
  expect((await resolveRolloutChecked(FLAG)).adminReadable).toBe(false);
  __resetRolloutAdminCache();
  expect(await resolveRollout(FLAG)).toEqual({ mode: 'enforce', source: 'default' });
});

it('UNREADABLE when the read times out (1.5 s)', async () => {
  jest.useFakeTimers();
  try {
    mockRedis.get = () => new Promise<string | null>(() => undefined);
    const pending = resolveRolloutChecked(FLAG);
    await jest.advanceTimersByTimeAsync(1_600);
    expect((await pending).adminReadable).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

it('no admin layer (Redis not configured): readable null, not false', async () => {
  mockRedis.configured = false;
  expect((await resolveRolloutChecked(FLAG)).adminReadable).toBeNull();
});

it('the readability is cached with the data (one read per TTL)', async () => {
  let reads = 0;
  mockRedis.get = async () => { reads += 1; throw new Error('down'); };
  await resolveRolloutChecked(FLAG);
  expect((await resolveRolloutChecked(FLAG)).adminReadable).toBe(false);
  expect(reads).toBe(1);
});
