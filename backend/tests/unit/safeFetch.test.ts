/**
 * HARDEN-005 — safeFetch runtime protection tests.
 *
 * DNS resolution + undici are mocked so the validate → resolve → pin → redirect
 * → limit pipeline is exercised deterministically without real network:
 *   - hostname resolving to a private IP (DNS rebinding) is blocked;
 *   - redirect chains are re-validated per hop; a redirect into a private host
 *     is blocked; the redirect count is capped;
 *   - oversized responses (declared Content-Length + streamed bytes) are blocked;
 *   - literal blocked IPs / bad protocols / credentials are blocked pre-DNS;
 *   - a valid public host is allowed and its body read under the cap.
 */

// ── mock DNS ──
const mockLookup = jest.fn();
jest.mock('dns', () => ({
  promises: { lookup: (...a: unknown[]) => mockLookup(...a) },
}));

// ── mock undici (Agent = noop; fetch = scripted) ──
const mockUndiciFetch = jest.fn();
jest.mock('undici', () => ({
  Agent: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
  fetch: (...a: unknown[]) => mockUndiciFetch(...a),
}));

import { safeFetch, safeFetchBuffer, readCapped, assertUrlSafe, SsrfBlockedError } from '../../../lib/security/safeFetch';

/** Build a fake undici Response with a streamable body. */
function makeResponse(opts: { status?: number; headers?: Record<string, string>; bodyChunks?: Uint8Array[]; url?: string }): Response {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const chunks = [...(opts.bodyChunks ?? [])];
  let cancelled = false;
  const body = {
    getReader() {
      let i = 0;
      return {
        read: async () => (cancelled || i >= chunks.length ? { done: true, value: undefined } : { done: false, value: chunks[i++] }),
        cancel: async () => { cancelled = true; },
        releaseLock: () => {},
      };
    },
    cancel: async () => { cancelled = true; },
  };
  return {
    status: opts.status ?? 200,
    url: opts.url ?? '',
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null, forEach: (fn: (v: string, k: string) => void) => headers.forEach(fn) },
    body,
  } as unknown as Response;
}

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const PRIVATE = [{ address: '127.0.0.1', family: 4 }];

beforeEach(() => {
  jest.clearAllMocks();
  mockLookup.mockResolvedValue(PUBLIC);
  mockUndiciFetch.mockResolvedValue(makeResponse({ status: 200, headers: { 'content-type': 'text/plain' }, bodyChunks: [new Uint8Array([104, 105])] }));
});

describe('pre-DNS validation (no request issued)', () => {
  it('blocks literal private IP', async () => {
    await expect(safeFetch('https://127.0.0.1/x')).rejects.toThrow(SsrfBlockedError);
    expect(mockUndiciFetch).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });
  it('blocks metadata endpoint literal', async () => {
    await expect(safeFetch('https://169.254.169.254/latest/meta-data')).rejects.toMatchObject({ reason: 'blocked_ip_literal' });
  });
  it('blocks non-https + credentials + bad url', async () => {
    await expect(safeFetch('http://example.com')).rejects.toMatchObject({ reason: 'blocked_protocol:http:' });
    await expect(safeFetch('https://u:p@example.com')).rejects.toMatchObject({ reason: 'embedded_credentials' });
    await expect(safeFetch('nonsense')).rejects.toMatchObject({ reason: 'invalid_url' });
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });
});

describe('DNS rebinding defense', () => {
  it('blocks a hostname that resolves to a private IP', async () => {
    mockLookup.mockResolvedValue(PRIVATE);
    await expect(safeFetch('https://rebind.example')).rejects.toMatchObject({ reason: 'resolved_to_blocked_ip' });
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });
  it('blocks when ANY resolved address is private (mixed A records)', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]);
    await expect(safeFetch('https://mixed.example')).rejects.toMatchObject({ reason: 'resolved_to_blocked_ip' });
  });
  it('blocks a DNS resolution failure (fail-closed)', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(safeFetch('https://nope.example')).rejects.toMatchObject({ reason: 'dns_resolution_failed' });
  });
  it('allows a public host and pins the connection to the validated IP', async () => {
    const res = await safeFetch('https://example.com');
    expect(res.status).toBe(200);
    expect(mockLookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
    expect(mockUndiciFetch).toHaveBeenCalledTimes(1);
    // The dispatcher (pinned Agent) was passed to the fetch.
    expect((mockUndiciFetch.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });
});

describe('redirect protection', () => {
  it('follows a redirect to a public host, re-validating the hop', async () => {
    mockUndiciFetch
      .mockResolvedValueOnce(makeResponse({ status: 302, headers: { location: 'https://final.example/ok' } }))
      .mockResolvedValueOnce(makeResponse({ status: 200, headers: { 'content-type': 'text/plain' }, bodyChunks: [new Uint8Array([1])] }));
    const res = await safeFetch('https://start.example');
    expect(res.status).toBe(200);
    expect(mockUndiciFetch).toHaveBeenCalledTimes(2);
    // The redirect target hostname was resolved + validated (2 lookups).
    expect(mockLookup).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect into a private host (re-validated post-redirect)', async () => {
    mockUndiciFetch.mockResolvedValueOnce(makeResponse({ status: 301, headers: { location: 'https://169.254.169.254/latest' } }));
    await expect(safeFetch('https://start.example')).rejects.toMatchObject({ reason: 'blocked_ip_literal' });
  });

  it('blocks a redirect whose hostname resolves to a private IP', async () => {
    mockLookup.mockResolvedValueOnce(PUBLIC).mockResolvedValueOnce(PRIVATE);
    mockUndiciFetch.mockResolvedValueOnce(makeResponse({ status: 302, headers: { location: 'https://rebind.example/x' } }));
    await expect(safeFetch('https://start.example')).rejects.toMatchObject({ reason: 'resolved_to_blocked_ip' });
  });

  it('caps the redirect count', async () => {
    mockUndiciFetch.mockResolvedValue(makeResponse({ status: 302, headers: { location: 'https://loop.example/next' } }));
    await expect(safeFetch('https://start.example', {}, { maxRedirects: 2 })).rejects.toMatchObject({ reason: 'too_many_redirects' });
    // initial + 2 follows = 3 requests, then the 3rd redirect trips the cap.
    expect(mockUndiciFetch).toHaveBeenCalledTimes(3);
  });
});

describe('size limits', () => {
  it('rejects a declared Content-Length over the cap before reading', async () => {
    mockUndiciFetch.mockResolvedValue(makeResponse({ status: 200, headers: { 'content-length': String(100 * 1024 * 1024) } }));
    await expect(safeFetch('https://big.example', {}, { maxBytes: 1024 })).rejects.toMatchObject({ reason: 'response_too_large' });
  });

  it('aborts a streamed body that exceeds the cap (Content-Length lied)', async () => {
    const chunk = new Uint8Array(1024).fill(65);
    mockUndiciFetch.mockResolvedValue(makeResponse({ status: 200, url: 'https://liar.example', bodyChunks: [chunk, chunk, chunk] }));
    const res = await safeFetch('https://liar.example', {}, { maxBytes: 1500 });
    await expect(readCapped(res)).rejects.toMatchObject({ reason: 'stream_exceeded_max_bytes' });
  });

  it('reads a small body fully under the cap', async () => {
    const { buffer, status, contentType } = await safeFetchBuffer('https://ok.example', { maxBytes: 1024 });
    expect(buffer.toString('utf8')).toBe('hi');
    expect(status).toBe(200);
    expect(contentType).toBe('text/plain');
  });
});

describe('assertUrlSafe (pre-check without request)', () => {
  it('passes for a public host, throws for private, never fetches', async () => {
    await expect(assertUrlSafe('https://example.com')).resolves.toBeUndefined();
    mockLookup.mockResolvedValue(PRIVATE);
    await expect(assertUrlSafe('https://rebind.example')).rejects.toMatchObject({ reason: 'resolved_to_blocked_ip' });
    await expect(assertUrlSafe('https://127.0.0.1')).rejects.toMatchObject({ reason: 'blocked_ip_literal' });
    expect(mockUndiciFetch).not.toHaveBeenCalled();
  });
});

describe('allow-list enforcement via safeFetch', () => {
  it('blocks a host not on the allow-list before DNS', async () => {
    await expect(safeFetch('https://evil.example', {}, { allowedHosts: ['openai.com'] })).rejects.toMatchObject({ reason: 'host_not_in_allowlist' });
    expect(mockLookup).not.toHaveBeenCalled();
  });
  it('allows an allow-listed host', async () => {
    const res = await safeFetch('https://api.openai.com/v1', {}, { allowedHosts: ['openai.com'] });
    expect(res.status).toBe(200);
  });
});
