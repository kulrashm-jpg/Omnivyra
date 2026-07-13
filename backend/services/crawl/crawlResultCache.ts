/**
 * crawlResultCache.ts — one-fetch-per-workflow page cache (CKRE-001 §2/§7).
 *
 * A bounded, short-TTL, per-process memo over the SSRF-safe page fetch. Its
 * sole job is to guarantee "do not fetch the same URL twice during one
 * workflow" — the duplicate-crawl elimination the audit called for:
 *   - within crawlWebsiteSources the root is fetched, then re-fetched as the
 *     root summary; both now share one fetch.
 *   - onboarding's step-5 crawl and step-5b profile-refinement crawl fetch the
 *     same root+subpages; both now share one fetch within the TTL window.
 *
 * It is NOT a content cache or a change-detection store — it is a
 * request-coalescing layer with a small TTL so a single onboarding/refresh
 * workflow reuses one crawl result. Failures are never cached (a transient
 * error must not stick). Every cache HIT records the network-saved metrics
 * (CKRE-001 §6). This wraps the EXISTING safeFetch — no new crawler.
 */

import { recordRawCounter } from '../../observability';

/** Result of a cached page fetch. Headers carry the Level-0 change signals. */
export interface CachedPageFetch {
  ok: boolean;
  status: number;
  /** Lowercased header subset used for Level-0 fingerprints. */
  headers: { etag: string | null; lastModified: string | null; contentLength: string | null; contentType: string | null };
  html: string;
  fetchedAt: number;
  /** True when this result was served from the memo (a duplicate fetch was prevented). */
  fromCache: boolean;
}

interface Entry { value: CachedPageFetch; expiresAt: number }

const TTL_MS = 120_000;      // one onboarding/refresh workflow window
const MAX_ENTRIES = 256;     // bounded — evict oldest
const cache = new Map<string, Entry>();

function evictIfNeeded(): void {
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

function countSaved(): void {
  try {
    recordRawCounter('crawl.duplicate_prevented', 1, {});
    recordRawCounter('crawl.network_requests_saved', 1, {});
  } catch { /* fail-safe */ }
}

/**
 * Fetch a page through the SSRF-safe fetcher, coalescing duplicate fetches of
 * the same URL within the TTL window. Never throws — network/SSRF failures
 * return `{ ok:false, status:0, html:'' }` (and are NOT cached).
 *
 * @param nowMs injectable clock for tests (defaults to Date.now()).
 */
export async function fetchPageCached(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
  nowMs: number = Date.now(),
): Promise<CachedPageFetch> {
  const key = url.trim();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > nowMs) {
    countSaved();
    return { ...hit.value, fromCache: true };
  }

  try {
    const { safeFetch, readCapped } = await import('../../../lib/security/safeFetch');
    const response = await safeFetch(
      url,
      { method: 'GET' },
      { timeoutMs: opts.timeoutMs ?? 8000, maxBytes: opts.maxBytes ?? 5 * 1024 * 1024 },
    );
    const html = response.ok ? (await readCapped(response)).toString('utf8') : '';
    const value: CachedPageFetch = {
      ok: response.ok,
      status: response.status,
      headers: {
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        contentLength: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
      },
      html,
      fetchedAt: nowMs,
      fromCache: false,
    };
    // Only successful fetches are cached — a transient failure must not stick.
    if (response.ok) {
      cache.set(key, { value, expiresAt: nowMs + TTL_MS });
      evictIfNeeded();
    }
    return value;
  } catch {
    return {
      ok: false, status: 0,
      headers: { etag: null, lastModified: null, contentLength: null, contentType: null },
      html: '', fetchedAt: nowMs, fromCache: false,
    };
  }
}

/** Clear the memo (tests / explicit workflow boundaries). */
export function clearCrawlResultCache(): void {
  cache.clear();
}

/** Current entry count (diagnostics/tests). */
export function crawlResultCacheSize(): number {
  return cache.size;
}
