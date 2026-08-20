/**
 * Focused tests for the passive undici transport probe.
 *
 * The probe's handlers are exercised directly AND through the real
 * diagnostics_channel subscription, so both the correlation logic and the
 * wiring are covered without any network access.
 */
import dc from 'node:diagnostics_channel';
import {
  installSupabaseTransportProbe,
  beginTransportCapture,
  flushTransportTiming,
  readAttempts,
  onRequestCreate,
  onBeforeConnect,
  onConnected,
  onConnectError,
  onSendHeaders,
  onResponseHeaders,
  onTrailers,
  onRequestError,
  __runWithCollectorForTests,
  __resetTransportProbeForTests,
  __inflightSizeForTests,
  type TransportCollector,
} from '../../../lib/platform/supabaseTransportProbe';

const SUPA = 'https://klkiseupptzbecbxwrky.supabase.co';

function collector(): TransportCollector {
  return { records: [] };
}
function req(path: string, origin = SUPA, headers: unknown = []): Record<string, unknown> {
  return { origin, path, method: 'GET', headers };
}
function sock(): object {
  return { fake: 'socket' };
}
/** Deterministic elapsed time without relying on timers. */
function burn(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* spin */ }
}

beforeAll(() => {
  installSupabaseTransportProbe();
});
beforeEach(() => {
  __resetTransportProbeForTests();
});

describe('host filtering', () => {
  it('1. captures Supabase-bound traffic', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    expect(__inflightSizeForTests()).toBe(1);
    onSendHeaders({ request: r, socket: sock() });
    onResponseHeaders({ request: r });
    expect(c.records).toHaveLength(1);
    expect(c.records[0].service).toBe('pgrst');
  });

  it('1b. MUTATION GUARD: ignores non-Supabase hosts entirely', () => {
    const c = collector();
    const hostile = req('/rest/v1/users', 'https://evil.example.com');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: hostile }));
    expect(__inflightSizeForTests()).toBe(0);
    onSendHeaders({ request: hostile, socket: sock() });
    onResponseHeaders({ request: hostile });
    expect(c.records).toHaveLength(0);
  });

  it('1c. does not capture a look-alike suffix host', () => {
    const c = collector();
    const spoof = req('/rest/v1/users', 'https://supabase.co.evil.net');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: spoof }));
    expect(__inflightSizeForTests()).toBe(0);
  });

  it('1d. classifies gotrue vs pgrst by path prefix only', () => {
    const c = collector();
    const a = req('/auth/v1/user');
    const b = req('/rest/v1/companies');
    __runWithCollectorForTests(c, () => { onRequestCreate({ request: a }); onRequestCreate({ request: b }); });
    [a, b].forEach((r) => { onSendHeaders({ request: r, socket: sock() }); onResponseHeaders({ request: r }); });
    expect(c.records.map((r) => r.service)).toEqual(['gotrue', 'pgrst']);
    expect(c.records.map((r) => r.endpoint)).toEqual(['auth', 'rest']);
  });
});

describe('privacy', () => {
  it('2. record carries no URL, path, query string or table name', () => {
    const c = collector();
    const r = req('/rest/v1/companies?select=id,name&company_id=eq.SECRET-TENANT-123');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: sock() });
    onResponseHeaders({ request: r });
    const rec = c.records[0];
    expect(Object.keys(rec).sort()).toEqual(
      ['attempts', 'connectMs', 'endpoint', 'service', 'state', 'totalMs', 'ttfbMs'].sort(),
    );
    const blob = JSON.stringify(rec);
    expect(blob).not.toContain('SECRET-TENANT-123');
    expect(blob).not.toContain('select=');
    expect(blob).not.toContain('companies');
    expect(blob).not.toContain('supabase');
  });

  it('3. never records authorization, apikey or cookie header values', () => {
    const c = collector();
    const headers = [
      'authorization', 'Bearer SUPER-SECRET-TOKEN',
      'apikey', 'SECRET-API-KEY',
      'cookie', 'sb-access-token=SECRET-COOKIE',
      'x-retry-count', '1',
    ];
    const r = req('/rest/v1/users', SUPA, headers);
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: sock() });
    onResponseHeaders({ request: r });
    const blob = JSON.stringify(c.records[0]);
    expect(blob).not.toContain('SUPER-SECRET-TOKEN');
    expect(blob).not.toContain('SECRET-API-KEY');
    expect(blob).not.toContain('SECRET-COOKIE');
    expect(blob).not.toContain('Bearer');
    // The only header-derived value that survives is the numeric attempt.
    expect(c.records[0].attempts).toBe(2);
  });

  it('3b. Server-Timing names expose no identifiers', () => {
    const c = collector();
    c.records.push({ service: 'pgrst', endpoint: 'rest', connectMs: 12, ttfbMs: 34, totalMs: 56, state: 'cold', attempts: 1 });
    const headers: Record<string, string> = {};
    const res = {
      headersSent: false,
      getHeader: (k: string) => headers[k],
      setHeader: (k: string, v: string) => { headers[k] = v; },
    } as never;
    flushTransportTiming(res, c);
    expect(headers['Server-Timing']).toBe('tx1_pgrst_cold_a1_conn;dur=12, tx1_pgrst_cold_a1_ttfb;dur=34, tx1_pgrst_cold_a1_tot;dur=56');
  });
});

describe('correlation lifecycle', () => {
  it('4. correlation map stays bounded under a flood', () => {
    const c = collector();
    __runWithCollectorForTests(c, () => {
      for (let i = 0; i < 900; i += 1) onRequestCreate({ request: req(`/rest/v1/t${i}`) });
    });
    expect(__inflightSizeForTests()).toBeLessThanOrEqual(256);
  });

  it('5. MUTATION GUARD: terminal cleanup removes the entry', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    expect(__inflightSizeForTests()).toBe(1);
    onSendHeaders({ request: r, socket: sock() });
    onResponseHeaders({ request: r });
    expect(__inflightSizeForTests()).toBe(0);
    onTrailers({ request: r });
    expect(__inflightSizeForTests()).toBe(0);
  });

  it('5b. a second headers event cannot double-record', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: sock() });
    onResponseHeaders({ request: r });
    onResponseHeaders({ request: r });
    expect(c.records).toHaveLength(1);
  });

  it('6. request error cleans up and records nothing', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onRequestError({ request: r });
    expect(__inflightSizeForTests()).toBe(0);
    expect(c.records).toHaveLength(0);
  });

  it('6b. connect error drains the pending-connect queue', () => {
    onBeforeConnect({ connectParams: { hostname: 'x.supabase.co' } });
    onConnectError({ connectParams: { hostname: 'x.supabase.co' } });
    // With the failed start drained, a later connect has no stale start to
    // pair with, so it must report connect as unknown rather than a bogus span.
    const s = sock();
    onConnected({ connectParams: { hostname: 'x.supabase.co' }, socket: s });
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: s });
    onResponseHeaders({ request: r });
    expect(c.records[0].state).toBe('cold');
    expect(c.records[0].connectMs).toBeNull();
  });

  it('8. concurrent requests are correlated independently', () => {
    const a = collector();
    const b = collector();
    const ra = req('/rest/v1/users');
    const rb = req('/auth/v1/user');
    __runWithCollectorForTests(a, () => onRequestCreate({ request: ra }));
    __runWithCollectorForTests(b, () => onRequestCreate({ request: rb }));
    onSendHeaders({ request: ra, socket: sock() });
    onSendHeaders({ request: rb, socket: sock() });
    onResponseHeaders({ request: rb });
    onResponseHeaders({ request: ra });
    expect(a.records).toHaveLength(1);
    expect(b.records).toHaveLength(1);
    expect(a.records[0].service).toBe('pgrst');
    expect(b.records[0].service).toBe('gotrue');
  });
});

describe('connection state', () => {
  it('9. a newly established socket is cold with a measured connect span', () => {
    const s = sock();
    onBeforeConnect({ connectParams: { hostname: 'x.supabase.co' } });
    burn(20);
    onConnected({ connectParams: { hostname: 'x.supabase.co' }, socket: s });
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: s });
    onResponseHeaders({ request: r });
    expect(c.records[0].state).toBe('cold');
    expect(c.records[0].connectMs).toBeGreaterThanOrEqual(15);
  });

  it('10. a socket already consumed is warm with connect 0 (proven by identity)', () => {
    const s = sock();
    onBeforeConnect({ connectParams: { hostname: 'x.supabase.co' } });
    onConnected({ connectParams: { hostname: 'x.supabase.co' }, socket: s });
    const c = collector();
    const first = req('/rest/v1/users');
    const second = req('/rest/v1/companies');
    __runWithCollectorForTests(c, () => { onRequestCreate({ request: first }); onRequestCreate({ request: second }); });
    onSendHeaders({ request: first, socket: s });
    onResponseHeaders({ request: first });
    onSendHeaders({ request: second, socket: s });
    onResponseHeaders({ request: second });
    expect(c.records[0].state).toBe('cold');
    expect(c.records[1].state).toBe('warm');
    expect(c.records[1].connectMs).toBe(0);
  });

  it('11. MUTATION GUARD: an unseen socket is unknown, never guessed warm', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: sock() }); // socket never seen in a connected event
    onResponseHeaders({ request: r });
    expect(c.records[0].state).toBe('unknown');
    expect(c.records[0].connectMs).toBeNull();
  });

  it('11b. a missing socket on sendHeaders is unknown', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r });
    onResponseHeaders({ request: r });
    expect(c.records[0].state).toBe('unknown');
  });

  it('11c. ambiguous FIFO connect pairing yields unknown connect, not a guess', () => {
    onBeforeConnect({ connectParams: { hostname: 'x.supabase.co' } });
    onBeforeConnect({ connectParams: { hostname: 'x.supabase.co' } }); // two in flight
    const s = sock();
    onConnected({ connectParams: { hostname: 'x.supabase.co' }, socket: s });
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onSendHeaders({ request: r, socket: s });
    onResponseHeaders({ request: r });
    expect(c.records[0].state).toBe('cold');
    expect(c.records[0].connectMs).toBeNull();
  });
});

describe('ttfb', () => {
  it('12. TTFB spans sendHeaders -> response headers, not create -> headers', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    burn(40); // queue/connect time, must NOT land in TTFB
    onSendHeaders({ request: r, socket: sock() });
    burn(25);
    onResponseHeaders({ request: r });
    const rec = c.records[0];
    expect(rec.ttfbMs).toBeGreaterThanOrEqual(20);
    expect(rec.ttfbMs).toBeLessThan(rec.totalMs as number);
    expect(rec.totalMs).toBeGreaterThanOrEqual(60);
  });

  it('12b. TTFB is null when the request was never observed on the wire', () => {
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => onRequestCreate({ request: r }));
    onResponseHeaders({ request: r });
    expect(c.records[0].ttfbMs).toBeNull();
    expect(c.records[0].totalMs).not.toBeNull();
  });
});

describe('retry detection', () => {
  it('13. reads a real x-retry-count as a 1-based attempt', () => {
    expect(readAttempts(['x-retry-count', '2'], 'pgrst')).toBe(3);
    expect(readAttempts(['X-Retry-Count', '0'], 'pgrst')).toBe(1);
  });

  it('13b. absence on PostgREST means first attempt', () => {
    expect(readAttempts(['accept', 'application/json'], 'pgrst')).toBe(1);
  });

  it('14. unknown when the header is absent on a non-retrying service', () => {
    expect(readAttempts(['accept', 'application/json'], 'gotrue')).toBeNull();
  });

  it('14b. unknown when the header shape is unexpected', () => {
    expect(readAttempts('x-retry-count: 2', 'pgrst')).toBeNull();
    expect(readAttempts(undefined, 'pgrst')).toBeNull();
    expect(readAttempts(null, 'pgrst')).toBeNull();
  });

  it('14c. rejects a non-numeric or oversized retry value', () => {
    expect(readAttempts(['x-retry-count', 'DROP TABLE users'], 'pgrst')).toBeNull();
    expect(readAttempts(['x-retry-count', '999'], 'pgrst')).toBeNull();
    expect(readAttempts(['x-retry-count', ''], 'pgrst')).toBeNull();
  });
});

describe('robustness', () => {
  it('15. malformed or unexpected payloads never throw', () => {
    const bad: Array<Record<string, unknown>> = [
      {}, { request: null }, { request: 'string' }, { request: 42 },
      { request: { origin: null, path: null } },
      { request: { origin: 'not a url', path: '/rest/v1/x' } },
      { socket: null }, { connectParams: {} }, { connectParams: { hostname: 42 } },
    ];
    for (const m of bad) {
      expect(() => onRequestCreate(m)).not.toThrow();
      expect(() => onBeforeConnect(m)).not.toThrow();
      expect(() => onConnected(m)).not.toThrow();
      expect(() => onConnectError(m)).not.toThrow();
      expect(() => onSendHeaders(m)).not.toThrow();
      expect(() => onResponseHeaders(m)).not.toThrow();
      expect(() => onTrailers(m)).not.toThrow();
      expect(() => onRequestError(m)).not.toThrow();
    }
  });

  it('7. MUTATION GUARD: a throwing observer cannot escape into request execution', () => {
    // Publishing on the real channel exercises the installed try/catch wrapper.
    // A subscriber that throws must not propagate to the publisher.
    const poison = { get request() { throw new Error('observer exploded'); } };
    expect(() => dc.channel('undici:request:create').publish(poison)).not.toThrow();
    expect(() => dc.channel('undici:client:sendHeaders').publish(poison)).not.toThrow();
    expect(() => dc.channel('undici:request:headers').publish(poison)).not.toThrow();
  });

  it('16. installing twice does not double-subscribe', () => {
    installSupabaseTransportProbe();
    installSupabaseTransportProbe();
    const c = collector();
    const r = req('/rest/v1/users');
    __runWithCollectorForTests(c, () => {
      dc.channel('undici:request:create').publish({ request: r });
    });
    dc.channel('undici:client:sendHeaders').publish({ request: r, socket: sock() });
    dc.channel('undici:request:headers').publish({ request: r });
    expect(c.records).toHaveLength(1);
  });

  it('capture outside a started window records nothing', () => {
    const r = req('/rest/v1/users');
    onRequestCreate({ request: r }); // no collector in scope
    expect(__inflightSizeForTests()).toBe(0);
  });

  it('flush tolerates a null collector and emits no fabricated zeroes', () => {
    const headers: Record<string, string> = {};
    const res = {
      headersSent: false,
      getHeader: (k: string) => headers[k],
      setHeader: (k: string, v: string) => { headers[k] = v; },
    } as never;
    expect(() => flushTransportTiming(res, null)).not.toThrow();
    const c = collector();
    c.records.push({ service: 'gotrue', endpoint: 'auth', connectMs: null, ttfbMs: 5, totalMs: 9, state: 'unknown', attempts: null });
    flushTransportTiming(res, c);
    expect(headers['Server-Timing']).toBe('tx1_gotrue_unknown_au_ttfb;dur=5, tx1_gotrue_unknown_au_tot;dur=9');
    expect(headers['Server-Timing']).not.toContain('conn');
  });

  it('beginTransportCapture returns a live collector', () => {
    const c = beginTransportCapture();
    expect(c).not.toBeNull();
    expect((c as TransportCollector).records).toEqual([]);
  });
});
