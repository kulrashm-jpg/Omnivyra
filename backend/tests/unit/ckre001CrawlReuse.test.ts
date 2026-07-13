/**
 * CKRE-001 §2/§7 — crawl-reuse cache prevents duplicate fetches within a workflow.
 */

jest.mock('../../../lib/security/safeFetch', () => ({
  safeFetch: jest.fn(),
  readCapped: jest.fn(async (r: any) => Buffer.from(r.__body ?? '', 'utf8')),
}));
jest.mock('../../observability', () => ({ recordRawCounter: jest.fn() }));

import { safeFetch } from '../../../lib/security/safeFetch';
import { recordRawCounter } from '../../observability';
import { fetchPageCached, clearCrawlResultCache, crawlResultCacheSize } from '../../services/crawl/crawlResultCache';

const mockFetch = safeFetch as jest.MockedFunction<typeof safeFetch>;
const mockCounter = recordRawCounter as jest.Mock;

function response(body: string, ok = true, headers: Record<string, string> = {}) {
  return {
    ok, status: ok ? 200 : 404,
    headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    __body: body,
  } as any;
}

beforeEach(() => { clearCrawlResultCache(); mockFetch.mockReset(); mockCounter.mockReset(); });

describe('CKRE-001 §2/§7 — duplicate fetch prevention', () => {
  test('first fetch hits the network; second (same URL, same window) is served from cache', async () => {
    mockFetch.mockResolvedValueOnce(response('<html>hi</html>', true, { etag: 'v1', 'content-length': '13' }));
    const now = 1_000_000;

    const first = await fetchPageCached('https://acme.com', {}, now);
    expect(first.fromCache).toBe(false);
    expect(first.ok).toBe(true);
    expect(first.html).toBe('<html>hi</html>');
    expect(first.headers.etag).toBe('v1');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = await fetchPageCached('https://acme.com', {}, now + 1000);
    expect(second.fromCache).toBe(true);
    expect(second.html).toBe('<html>hi</html>');
    expect(mockFetch).toHaveBeenCalledTimes(1); // NOT fetched again
    // §6 — network-saved metrics recorded on the cache hit.
    expect(mockCounter).toHaveBeenCalledWith('crawl.duplicate_prevented', 1, {});
    expect(mockCounter).toHaveBeenCalledWith('crawl.network_requests_saved', 1, {});
  });

  test('cache expires after the TTL window → refetch', async () => {
    mockFetch.mockResolvedValue(response('<html>hi</html>'));
    const now = 2_000_000;
    await fetchPageCached('https://acme.com', {}, now);
    await fetchPageCached('https://acme.com', {}, now + 200_000); // > 120s TTL
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('failed fetches are NOT cached (transient errors must not stick)', async () => {
    mockFetch.mockResolvedValueOnce(response('', false));
    mockFetch.mockResolvedValueOnce(response('<html>ok</html>', true));
    const now = 3_000_000;
    const a = await fetchPageCached('https://acme.com', {}, now);
    expect(a.ok).toBe(false);
    expect(crawlResultCacheSize()).toBe(0);
    const b = await fetchPageCached('https://acme.com', {}, now + 1);
    expect(b.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('network throw is swallowed → not-ok result, not cached', async () => {
    mockFetch.mockRejectedValueOnce(new Error('SSRF blocked'));
    const r = await fetchPageCached('https://internal', {}, 4_000_000);
    expect(r.ok).toBe(false);
    expect(r.html).toBe('');
    expect(crawlResultCacheSize()).toBe(0);
  });

  test('distinct URLs are cached independently', async () => {
    mockFetch.mockResolvedValue(response('x'));
    const now = 5_000_000;
    await fetchPageCached('https://a.com', {}, now);
    await fetchPageCached('https://b.com', {}, now);
    expect(crawlResultCacheSize()).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
