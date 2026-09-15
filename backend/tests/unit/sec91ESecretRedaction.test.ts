/**
 * STEP 3AH-91 SEC-E3 — credentials carried in URLs must never reach an error
 * message, a metric label, or a provider "unavailable" reason.
 *
 * Before the fix SsrfBlockedError embedded the full URL (`SSRF blocked (...)
 * for https://api.hunter.io/...&api_key=<key>`) and vendorAdapter copied that
 * message into the provider result's `detail`, which is persisted/logged by
 * the enrichment orchestrator. The fix redacts centrally in safeFetch
 * (lib/security/redactUrl) and again at the vendor boundary.
 *
 * No network: DNS and undici are mocked exactly as in safeFetch.test.ts.
 */
const mockLookup = jest.fn();
jest.mock('dns', () => ({
  promises: { lookup: (...a: unknown[]) => mockLookup(...a) },
}));
const mockUndiciFetch = jest.fn();
jest.mock('undici', () => ({
  Agent: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
  fetch: (...a: unknown[]) => mockUndiciFetch(...a),
}));
const mockRawCounter = jest.fn();
jest.mock('../../observability', () => ({
  recordRawCounter: (...a: unknown[]) => mockRawCounter(...a),
  recordExternal: () => undefined,
}));

import { safeFetch, readCapped, SsrfBlockedError } from '../../../lib/security/safeFetch';
import { redactUrl, redactSecretsInText, REDACTED } from '../../../lib/security/redactUrl';
import { hunterProvider, builtWithProvider } from '../../services/companyIntelligence/providers/adapters';

const KEY = 'sk-live-SECRET-9f8e7d6c5b4a';
const PUBLIC = [{ address: '93.184.216.34', family: 4 }];

function res(opts: { status?: number; headers?: Record<string, string>; chunks?: Uint8Array[]; url?: string }): Response {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const chunks = [...(opts.chunks ?? [])];
  return {
    status: opts.status ?? 200,
    url: opts.url ?? '',
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body: {
      getReader() {
        let i = 0;
        return {
          read: async () => (i >= chunks.length ? { done: true, value: undefined } : { done: false, value: chunks[i++] }),
          cancel: async () => undefined,
          releaseLock: () => undefined,
        };
      },
      cancel: async () => undefined,
    },
  } as unknown as Response;
}

async function caught(p: Promise<unknown>): Promise<SsrfBlockedError> {
  try { await p; } catch (e) { return e as SsrfBlockedError; }
  throw new Error('expected a rejection');
}

function expectNoKey(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(encodeURIComponent(KEY));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLookup.mockResolvedValue(PUBLIC);
  mockUndiciFetch.mockResolvedValue(res({ status: 200 }));
});

describe('redactUrl / redactSecretsInText', () => {
  it('replaces every query value and userinfo, keeps scheme/host/path/param names', () => {
    const out = redactUrl(`https://u:p@api.hunter.io/v2/domain-search?domain=acme.test&api_key=${KEY}#frag`);
    expectNoKey(out);
    expect(out).not.toContain('u:p');
    expect(out).toBe(`https://${REDACTED}@api.hunter.io/v2/domain-search?domain=${REDACTED}&api_key=${REDACTED}#${REDACTED}`);
  });
  it('redacts a non-parseable URL-ish string textually', () => {
    expectNoKey(redactUrl(`not a url?KEY=${KEY}&LOOKUP=acme.test`));
  });
  it('redacts URLs, name=value pairs, JSON fields and bearer tokens inside free text', () => {
    const text = [
      `request to https://api.builtwith.com/v21/api.json?KEY=${KEY}&LOOKUP=a.test failed`,
      `client_secret=${KEY}`,
      `{"access_token": "${KEY}"}`,
      `Authorization: Bearer ${KEY}`,
    ].join(' | ');
    const out = redactSecretsInText(text);
    expectNoKey(out);
    expect(out).toContain('https://api.builtwith.com/v21/api.json?KEY=');
  });
  it('redacts userinfo in non-http connection strings', () => {
    const out = redactSecretsInText(`DATABASE_URL invalid: postgres://svc:${KEY}@db.internal:5432/app and rediss://default:${KEY}@r:6379`);
    expectNoKey(out);
    expect(out).toContain('postgres://[REDACTED]@db.internal:5432/app');
  });
  it('leaves ordinary text alone', () => {
    expect(redactSecretsInText('HTTP 503 from upstream')).toBe('HTTP 503 from upstream');
  });
});

describe('SsrfBlockedError never carries URL credentials', () => {
  it('pre-DNS rejection (host not on the allow-list)', async () => {
    const err = await caught(safeFetch(`https://evil.example/x?api_key=${KEY}`, {}, { allowedHosts: ['api.hunter.io'] }));
    expect(err).toBeInstanceOf(SsrfBlockedError);
    expect(err.reason).toBe('host_not_in_allowlist');
    expectNoKey(err.message);
    expectNoKey(err.target);
    expect(err.target).toContain('evil.example');
    for (const call of mockRawCounter.mock.calls) expectNoKey(call);
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });

  it('declared response too large', async () => {
    mockUndiciFetch.mockResolvedValueOnce(res({ status: 200, headers: { 'content-length': String(10 * 1024 * 1024 * 1024) } }));
    const err = await caught(safeFetch(`https://api.hunter.io/v2/domain-search?api_key=${KEY}`));
    expect(err.reason).toBe('response_too_large');
    expectNoKey(err.message);
    expectNoKey(err.target);
  });

  it('too many redirects (redirect target carries a key)', async () => {
    mockUndiciFetch.mockResolvedValue(res({ status: 302, headers: { location: `https://api.hunter.io/loop?access_token=${KEY}` } }));
    const err = await caught(safeFetch(`https://api.hunter.io/start?api_key=${KEY}`, {}, { maxRedirects: 1 }));
    expect(err.reason).toBe('too_many_redirects');
    expectNoKey(err.message);
    expectNoKey(err.target);
  });

  it('streamed body over the cap', async () => {
    const r = res({ status: 200, chunks: [new Uint8Array(8), new Uint8Array(8)], url: `https://api.hunter.io/x?api_key=${KEY}` });
    const err = await caught(readCapped(r, 10));
    expect(err.reason).toBe('stream_exceeded_max_bytes');
    expectNoKey(err.message);
    expectNoKey(err.target);
  });
});

describe('vendor adapters never leak their credential into a provider result', () => {
  const PRIOR = { HUNTER_API_KEY: process.env.HUNTER_API_KEY, BUILTWITH_API_KEY: process.env.BUILTWITH_API_KEY };
  beforeEach(() => { process.env.HUNTER_API_KEY = KEY; process.env.BUILTWITH_API_KEY = KEY; });
  afterAll(() => {
    for (const [k, v] of Object.entries(PRIOR)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('Hunter: a safeFetch failure becomes provider_error with a redacted detail', async () => {
    mockUndiciFetch.mockResolvedValueOnce(res({ status: 200, headers: { 'content-length': String(10 * 1024 * 1024 * 1024) } }));
    const result = await hunterProvider.fetch({ domain: 'acme.test', asOf: '2026-09-15' } as any, 'identity');
    expect(result.state).toBe('unavailable');
    expect(result.reasonUnavailable).toBe('provider_error');
    expectNoKey(result);
    // The request itself still carried the key (the provider requires it).
    expect(String(mockUndiciFetch.mock.calls[0][0])).toContain('api_key=');
  });

  it('BuiltWith: an arbitrary thrown error that echoes the URL is redacted', async () => {
    mockUndiciFetch.mockRejectedValueOnce(new Error(`connect failed for https://api.builtwith.com/v21/api.json?KEY=${KEY}&LOOKUP=acme.test`));
    const result = await builtWithProvider.fetch({ domain: 'acme.test', asOf: '2026-09-15' } as any, 'technology');
    expect(result.state).toBe('unavailable');
    expectNoKey(result);
  });
});
