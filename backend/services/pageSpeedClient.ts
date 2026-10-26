/**
 * Google PageSpeed Insights — the ONE client every PageSpeed call goes through (the snapshot
 * report's performance evidence and the public-research provider check).
 *
 * Shared service, not a tenant integration: PageSpeed measures a supplied PUBLIC page, so all
 * tenant reports use one application-level key managed in Super Admin ("Google PageSpeed
 * Insights" card → providerCredentialResolver 'pagespeed', env fallback PAGESPEED_API_KEY).
 * Tenants never supply a Google key. Nothing tenant-private is sent or cached: the request is a
 * public URL, and the cache holds the provider's public lab result for that URL only.
 *
 * Access policy (resolvePageSpeedAccess):
 *   disabled in Super Admin            → no call            issue `disabled`
 *   Super Admin key, else env key      → call with the key
 *   no key, PAGESPEED_ENABLED=true     → keyless call on Google's shared quota
 *   no key, keyless not enabled        → no call            issue `not_configured`
 *   (`allowKeyless` lets a single diagnostic check use the keyless route regardless.)
 *
 * Every failure is classified from Google's own error body, never from the status alone where the
 * body says more: invalid_key · api_disabled · quota_exhausted · timeout · provider_failure ·
 * malformed_response. A failure is never cached and never becomes a score.
 *
 * The key is placed only in the request URL handed to fetch; it is never logged, returned,
 * stored in the cache key, or included in an error detail.
 */
// The resolver (and its database client) is loaded on first use, so importing this module stays
// pure for the parsers and tests that only need the types and the classifier.
export const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

export type PageSpeedStrategy = 'mobile' | 'desktop';
export type PageSpeedIssue =
  | 'disabled' | 'not_configured' | 'invalid_key' | 'api_disabled' | 'quota_exhausted'
  | 'timeout' | 'provider_failure' | 'malformed_response';

export const PAGESPEED_ISSUE_TEXT: Record<PageSpeedIssue, string> = {
  disabled: 'PageSpeed Insights is disabled in Super Admin.',
  not_configured: 'No PageSpeed Insights API key is configured (Super Admin or PAGESPEED_API_KEY), and keyless use is not enabled.',
  invalid_key: 'Google rejected the PageSpeed Insights API key (invalid or restricted).',
  api_disabled: 'The PageSpeed Insights API is not enabled in the Google Cloud project that owns the key.',
  quota_exhausted: 'PageSpeed quota exceeded: the PageSpeed Insights allowance is used up.',
  timeout: 'PageSpeed Insights did not answer in time.',
  provider_failure: 'PageSpeed Insights failed to answer.',
  malformed_response: 'PageSpeed Insights answered with a body that could not be read.',
};

export type PageSpeedAccess = {
  allowed: boolean;
  /** For the request only. Never logged or returned to a client. */
  key: string | null;
  source: 'managed' | 'environment' | 'keyless' | 'disabled' | 'none';
  issue: PageSpeedIssue | null;
  detail: string;
};

const keylessEnabled = () => /^(1|true|on|yes)$/i.test(process.env.PAGESPEED_ENABLED ?? '');

let accessMemo: { at: number; value: PageSpeedAccess } | null = null;
const ACCESS_MEMO_MS = 60_000;

/** Which credential (if any) PageSpeed may use right now. Memoised briefly: one DB read per minute, not per call. */
export async function resolvePageSpeedAccess(opts: { allowKeyless?: boolean; now?: number } = {}): Promise<PageSpeedAccess> {
  const now = opts.now ?? Date.now();
  let base = accessMemo && now - accessMemo.at < ACCESS_MEMO_MS ? accessMemo.value : null;
  if (!base) {
    const { resolveProviderCredential } = await import('./providerCredentialResolver');
    const cred = await resolveProviderCredential('pagespeed');
    base = cred.source === 'disabled'
      ? { allowed: false, key: null, source: 'disabled', issue: 'disabled', detail: PAGESPEED_ISSUE_TEXT.disabled }
      : cred.value
        ? { allowed: true, key: cred.value, source: cred.source === 'managed' ? 'managed' : 'environment', issue: null, detail: cred.source === 'managed' ? 'Using the Super Admin key.' : `Using the ${cred.envName ?? 'environment'} key.` }
        : { allowed: false, key: null, source: 'none', issue: 'not_configured', detail: PAGESPEED_ISSUE_TEXT.not_configured };
    accessMemo = { at: now, value: base };
  }
  if (!base.allowed && base.source === 'none' && (keylessEnabled() || opts.allowKeyless)) {
    return { allowed: true, key: null, source: 'keyless', issue: null, detail: 'No key configured: using Google’s shared keyless quota, which is often exhausted.' };
  }
  return base;
}

/** Remove anything key-shaped from provider text before it is kept. */
const scrub = (s: string) => s.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').replace(/([?&]key=)[^&\s"']+/gi, '$1[redacted]');

/** Classify a PageSpeed error from Google's own body; the status only narrows. Pure. */
export function classifyPageSpeedError(status: number | null, body: unknown): { issue: PageSpeedIssue; detail: string } {
  const err = (body && typeof body === 'object' ? (body as any).error : null) ?? {};
  const reasons = [err.status, ...(Array.isArray(err.errors) ? err.errors.map((e: any) => e?.reason) : []),
    ...(Array.isArray(err.details) ? err.details.map((d: any) => d?.reason) : [])].filter((x) => typeof x === 'string').join(' ');
  const message = scrub(String(err.message ?? '')).slice(0, 200);
  const text = `${reasons} ${message}`;
  const said = message ? ` Google said: “${message}”` : '';
  let issue: PageSpeedIssue;
  if (/API_KEY_INVALID|keyInvalid|API key not valid|API_KEY_.*BLOCKED|API_KEY_.*DENIED|requests from this referer|referer.*blocked/i.test(text)) issue = 'invalid_key';
  else if (/SERVICE_DISABLED|accessNotConfigured|has not been used in project|it is disabled|API is disabled/i.test(text)) issue = 'api_disabled';
  else if (status === 429 || /RESOURCE_EXHAUSTED|rateLimitExceeded|dailyLimitExceeded|userRateLimitExceeded|quota/i.test(text)) issue = 'quota_exhausted';
  else if (status === 400 && /key/i.test(text)) issue = 'invalid_key';
  else issue = 'provider_failure';
  return { issue, detail: `${PAGESPEED_ISSUE_TEXT[issue]}${status ? ` (HTTP ${status})` : ''}${said}` };
}

export type PageSpeedResult =
  | { ok: true; body: unknown; fetchedAt: string; fromCache: boolean; source: PageSpeedAccess['source'] }
  | { ok: false; issue: PageSpeedIssue; detail: string; httpStatus: number | null; source: PageSpeedAccess['source'] };

export type PageSpeedSuccess = Extract<PageSpeedResult, { ok: true }>;
export type PageSpeedFailure = Extract<PageSpeedResult, { ok: false }>;
/** Narrowing helpers: this codebase compiles without `strict`, where `if (!r.ok)` does not narrow the union. */
export const pageSpeedFailure = (r: PageSpeedResult): PageSpeedFailure | null => (r.ok === false ? r as PageSpeedFailure : null);
export const pageSpeedSuccess = (r: PageSpeedResult): PageSpeedSuccess | null => (r.ok === true ? r as PageSpeedSuccess : null);

// ── Cache, in-flight de-duplication and a small concurrency cap ───────────────
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; body: unknown; fetchedAt: string }>();
const inflight = new Map<string, Promise<PageSpeedResult>>();
let running = 0;
const waiting: Array<() => void> = [];

const cacheTtlMs = () => Math.max(0, Number(process.env.PAGESPEED_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000));
const maxConcurrency = () => Math.max(1, Number(process.env.PAGESPEED_MAX_CONCURRENCY ?? 2));

/** Cache identity: the public URL (normalised), strategy and category. Never the key, never a tenant. */
export function pageSpeedCacheKey(url: string, strategy: PageSpeedStrategy, category = 'performance'): string {
  let u = url;
  try { const p = new URL(url); p.hash = ''; p.hostname = p.hostname.toLowerCase(); u = p.toString(); } catch { /* keep as given */ }
  return `${u}|${strategy}|${category}`;
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= maxConcurrency()) await new Promise<void>((r) => waiting.push(r));
  running += 1;
  try { return await fn(); } finally { running -= 1; waiting.shift()?.(); }
}

/** Test hook: forget cached results, in-flight requests and the memoised access decision. */
export function resetPageSpeedClientState(): void {
  cache.clear(); inflight.clear(); accessMemo = null;
}

/** After a Super Admin change: the next call re-reads the credential (cached results stay valid — they are public data). */
export function invalidatePageSpeedAccess(): void {
  accessMemo = null;
}

/** The access the environment alone grants (no Super Admin lookup): a PAGESPEED_API_KEY, else keyless. */
export function environmentPageSpeedAccess(): PageSpeedAccess {
  const key = process.env.PAGESPEED_API_KEY?.trim() || null;
  return key ? { allowed: true, key, source: 'environment', issue: null, detail: 'Using the PAGESPEED_API_KEY key.' }
    : { allowed: true, key: null, source: 'keyless', issue: null, detail: 'No key configured: using Google’s shared keyless quota, which is often exhausted.' };
}

/**
 * Run PageSpeed for one public URL. Never throws. A fresh cached success for the same URL,
 * strategy and category is returned without a new request; concurrent identical requests share one.
 */
export async function runPageSpeed(params: {
  url: string;
  strategy: PageSpeedStrategy;
  category?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  allowKeyless?: boolean;
  now?: number;
  /** An access decision the caller already made (one per report run), instead of resolving per call. */
  access?: PageSpeedAccess;
  /** Always ask Google (a credential check must test the key, not the cache). */
  noCache?: boolean;
}): Promise<PageSpeedResult> {
  const category = params.category ?? 'performance';
  const access = params.access ?? await resolvePageSpeedAccess({ allowKeyless: params.allowKeyless, now: params.now });
  if (!access.allowed) return { ok: false, issue: access.issue ?? 'not_configured', detail: access.detail, httpStatus: null, source: access.source };

  const key = pageSpeedCacheKey(params.url, params.strategy, category);
  const now = params.now ?? Date.now();
  const hit = params.noCache ? undefined : cache.get(key);
  if (hit && now - hit.at < cacheTtlMs()) return { ok: true, body: hit.body, fetchedAt: hit.fetchedAt, fromCache: true, source: access.source };
  const pending = params.noCache ? undefined : inflight.get(key);
  if (pending) return pending;

  const timeoutMs = params.timeoutMs ?? Math.max(10_000, Number(process.env.PAGESPEED_TIMEOUT_MS) || 60_000);
  const task = slot(async (): Promise<PageSpeedResult> => {
    const query = new URLSearchParams({ url: params.url, strategy: params.strategy, category });
    if (access.key) query.set('key', access.key);
    try {
      // ssrf-ok: fixed Google endpoint; the tenant URL is a query parameter, never a host.
      const res = await (params.fetchImpl ?? fetch)(`${PSI_ENDPOINT}?${query.toString()}`, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return { ok: false, ...classifyPageSpeedError(res.status, body), httpStatus: res.status, source: access.source };
      }
      let body: unknown;
      try { body = await res.json(); } catch (e) {
        return { ok: false, issue: 'malformed_response', detail: `${PAGESPEED_ISSUE_TEXT.malformed_response} ${scrub(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, httpStatus: res.status, source: access.source };
      }
      const fetchedAt = new Date(now).toISOString();
      if (cacheTtlMs() > 0) {
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
        cache.set(key, { at: now, body, fetchedAt });
      }
      return { ok: true, body, fetchedAt, fromCache: false, source: access.source };
    } catch (e) {
      const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
      return /abort|timeout/i.test(m)
        ? { ok: false, issue: 'timeout', detail: `PageSpeed timed out after ${timeoutMs}ms.`, httpStatus: null, source: access.source }
        : { ok: false, issue: 'provider_failure', detail: `${PAGESPEED_ISSUE_TEXT.provider_failure} ${scrub(m).slice(0, 160)}`, httpStatus: null, source: access.source };
    }
  }).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
