/**
 * Closure-014 (D-1) — a configured Redis database index is honoured by every
 * hand-built connection, and an invalid one fails closed instead of becoming DB 0.
 *
 * Closure-012 observed `REDIS_URL=redis://127.0.0.1:6379/14` writing to DB 0:
 * both parseRedisUrl implementations (and BullMQ's rawConnectionOptions) dropped
 * the path. These tests pin the shared parser AND the options each client
 * constructor actually receives. No Redis server is contacted (lazy / mocked).
 */
import IORedis from 'ioredis';
import { parseRedisConnectionUrl, RedisUrlConfigError, MAX_REDIS_DB_INDEX } from '../../../lib/redis/redisUrl';

const kind = (fn: () => unknown): string => {
  try { fn(); return 'ok'; } catch (e) { return e instanceof RedisUrlConfigError ? e.kind : `other:${String(e)}`; }
};

describe('parseRedisConnectionUrl', () => {
  it('no path and "/" leave db unset (ioredis default 0, unchanged behaviour)', () => {
    expect(parseRedisConnectionUrl('redis://127.0.0.1:6379')).toEqual({ host: '127.0.0.1', port: 6379 });
    expect(parseRedisConnectionUrl('redis://127.0.0.1:6379/')).toEqual({ host: '127.0.0.1', port: 6379 });
  });
  it('"/0" selects db 0 explicitly; "/14" selects 14; the max index is accepted', () => {
    expect(parseRedisConnectionUrl('redis://127.0.0.1:6379/0').db).toBe(0);
    expect(parseRedisConnectionUrl('redis://127.0.0.1:6379/14').db).toBe(14);
    expect(parseRedisConnectionUrl('redis://127.0.0.1/14/').db).toBe(14);
    expect(parseRedisConnectionUrl(`redis://h:6379/${MAX_REDIS_DB_INDEX}`).db).toBe(MAX_REDIS_DB_INDEX);
  });
  it.each([
    ['negative', 'redis://h:6379/-1'],
    ['out of range', `redis://h:6379/${MAX_REDIS_DB_INDEX + 1}`],
    ['huge', 'redis://h:6379/99999999999'],
    ['non-integer', 'redis://h:6379/1.5'],
    ['word', 'redis://h:6379/fourteen'],
    ['extra segment', 'redis://h:6379/1/2'],
    ['encoded digits', 'redis://h:6379/%31%34'],
  ])('an invalid database path (%s) fails closed with INVALID_DB — never DB 0', (_n, url) => {
    expect(kind(() => parseRedisConnectionUrl(url))).toBe('INVALID_DB');
  });
  it('percent-encoded credentials are decoded; "default"/empty usernames are not sent; other usernames are (ACL)', () => {
    expect(parseRedisConnectionUrl('redis://:p%40ss%2Fw%3Ard@h:6379')).toEqual({ host: 'h', port: 6379, password: 'p@ss/w:rd' });
    expect(parseRedisConnectionUrl('redis://default:secret@h:6379/3')).toEqual({ host: 'h', port: 6379, password: 'secret', db: 3 });
    expect(parseRedisConnectionUrl('redis://app%2Euser:s@h:6379')).toEqual({ host: 'h', port: 6379, username: 'app.user', password: 's' });
    expect(kind(() => parseRedisConnectionUrl('redis://:%E0%A4%A@h:6379'))).toBe('MALFORMED');
  });
  it('TLS: rediss:// and Upstash hosts get tls; plain redis:// does not', () => {
    expect(parseRedisConnectionUrl('rediss://h:6380/2')).toEqual({ host: 'h', port: 6380, db: 2, tls: {} });
    expect(parseRedisConnectionUrl('redis://x.upstash.io:6379').tls).toEqual({});
    expect(parseRedisConnectionUrl('redis://h:6379').tls).toBeUndefined();
  });
  it('strips a redis-cli prefix, decodes IPv6 brackets, validates the port and protocol', () => {
    expect(parseRedisConnectionUrl('redis-cli --tls -u rediss://h:6380/1')).toEqual({ host: 'h', port: 6380, db: 1, tls: {} });
    expect(parseRedisConnectionUrl('redis://[::1]:6379/4')).toEqual({ host: '::1', port: 6379, db: 4 });
    expect(kind(() => parseRedisConnectionUrl('redis://h:0'))).toBe('INVALID_PORT');
    expect(kind(() => parseRedisConnectionUrl('http://h:6379/1'))).toBe('MALFORMED');
    expect(kind(() => parseRedisConnectionUrl('not a url'))).toBe('MALFORMED');
  });
  it('error messages never echo the URL (it can carry a password)', () => {
    try { parseRedisConnectionUrl('redis://:topsecret@h:6379/77'); } catch (e) { expect(String((e as Error).message)).not.toContain('topsecret'); }
  });
});

describe('ioredis URL handling (aiResponseCache constructs `new IORedis(url, …)`)', () => {
  it('honours the database path natively', () => {
    const c = new IORedis('redis://127.0.0.1:6379/14', { lazyConnect: true });
    expect(c.options.db).toBe(14);
    c.disconnect();
  });
});

/** Captures the options every mocked IORedis constructor receives. */
function captureIoredis() {
  const seen: Record<string, unknown>[] = [];
  class FakeRedis {
    status = 'wait';
    options: Record<string, unknown>;
    constructor(opts: Record<string, unknown>) { this.options = opts; seen.push(opts); }
    on() { return this; }
    connect() { return Promise.resolve(); }
    disconnect() { /* noop */ }
    quit() { return Promise.resolve('OK'); }
    duplicate() { return this; }
  }
  return { seen, FakeRedis };
}

describe('standalone Redis client (rate limits, rollout overrides, caches)', () => {
  const OLD = process.env.REDIS_URL;
  afterEach(() => { process.env.REDIS_URL = OLD; jest.resetModules(); });

  it('a configured nonzero database reaches the IORedis constructor', () => {
    const { seen, FakeRedis } = captureIoredis();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/14';
    jest.isolateModules(() => {
      jest.doMock('ioredis', () => ({ __esModule: true, default: FakeRedis }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../queue/standaloneRedisClient').getSharedStandaloneRedisClient();
    });
    expect(seen[0]).toMatchObject({ host: '127.0.0.1', port: 6379, db: 14 });
  });

  it('an invalid database index fails closed (throws) instead of connecting to DB 0', () => {
    const { seen, FakeRedis } = captureIoredis();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/99';
    let thrown: unknown;
    jest.isolateModules(() => {
      jest.doMock('ioredis', () => ({ __esModule: true, default: FakeRedis }));
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../queue/standaloneRedisClient').getSharedStandaloneRedisClient();
      } catch (e) { thrown = e; }
    });
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('RedisUrlConfigError');
    expect(seen).toEqual([]);
  });

  it('an unparseable URL keeps the long-standing localhost fallback (optional Redis)', () => {
    const { seen, FakeRedis } = captureIoredis();
    process.env.REDIS_URL = 'not-a-url';
    jest.isolateModules(() => {
      jest.doMock('ioredis', () => ({ __esModule: true, default: FakeRedis }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../queue/standaloneRedisClient').getSharedStandaloneRedisClient();
    });
    expect(seen[0]).toMatchObject({ host: 'localhost', port: 6379 });
    expect(seen[0].db).toBeUndefined();
  });
});

describe('BullMQ client raw connection options (queues, workers, probe, spread consumers)', () => {
  afterEach(() => jest.resetModules());

  function rawFor(url: string): Record<string, unknown> {
    let raw: Record<string, unknown> = {};
    jest.isolateModules(() => {
      jest.doMock('@/config', () => ({ config: { REDIS_URL: url } }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      raw = require('../../queue/bullmqClient').getRawConnectionOptions();
    });
    return raw;
  }

  it('keeps db and the ACL username (both were dropped by the field-by-field copy)', () => {
    expect(rawFor('redis://ops:pw@127.0.0.1:6379/14')).toMatchObject({ host: '127.0.0.1', port: 6379, username: 'ops', password: 'pw', db: 14 });
  });
  it('no path → no db key (production Upstash URLs are byte-for-byte unchanged)', () => {
    const raw = rawFor('rediss://default:pw@x.upstash.io:6379');
    expect(raw).toMatchObject({ host: 'x.upstash.io', port: 6379, password: 'pw', tls: {} });
    expect('db' in raw).toBe(false);
    expect('username' in raw).toBe(false);
  });
  it('an invalid database index aborts module load (fail closed at boot)', () => {
    expect(() => rawFor('redis://127.0.0.1:6379/abc')).toThrow(/INVALID_DB/);
  });
});

describe('intelligence-polling queue connection', () => {
  const OLD = process.env.REDIS_URL;
  afterEach(() => { process.env.REDIS_URL = OLD; jest.resetModules(); });

  it('passes the selected database to the BullMQ Queue', () => {
    const queues: { connection: Record<string, unknown> }[] = [];
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/14';
    jest.isolateModules(() => {
      jest.doMock('bullmq', () => ({ Queue: class { constructor(_n: string, o: { connection: Record<string, unknown> }) { queues.push(o); } on() { return this; } } }));
      jest.doMock('../../queue/bullmqClient', () => ({ applyQueueProtection: (q: unknown) => q, getQueuePrefix: () => 'test:' }));
      jest.doMock('../../queue/queueInstrumentation', () => ({ instrumentQueue: (q: unknown) => q }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../queue/intelligencePollingQueue').getIntelligencePollingQueue();
    });
    expect(queues[0].connection).toMatchObject({ host: '127.0.0.1', port: 6379, db: 14 });
  });
});
