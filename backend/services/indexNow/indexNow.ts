/**
 * IndexNow — notify participating search engines (Bing, Yandex, Seznam, Naver…) that a PUBLIC page of
 * the platform's own site was added, updated or deleted. A notification protocol, not analytics: an
 * HTTP 200 means "received", never "indexed".
 *
 * Protocol (indexnow.org/documentation, read 26 Oct 2026):
 *   key       8–128 characters of a-z, A-Z, 0-9 and "-"
 *   key file  https://<host>/<key>.txt, UTF-8, containing the key (served by pages/api/indexnow-key.ts)
 *   submit    POST https://api.indexnow.org/indexnow, JSON { host, key, keyLocation, urlList } (≤ 10,000)
 *   replies   200 ok · 202 accepted, key validation pending · 400 bad request · 403 key not valid ·
 *             422 URLs not of this host / key mismatch · 429 too many requests
 *
 * Safety:
 *   - OFF unless INDEXNOW_SUBMIT_ENABLED === 'true'; no key (INDEXNOW_API_KEY) → not_configured. No network
 *     call in either case. Nothing in the platform calls submitIndexNow yet.
 *   - The key file is served only when INDEXNOW_PUBLISH_KEY_FILE === 'true' as well (publishing it is a
 *     separate, deliberate step from having the key in the environment).
 *   - Only URLs the site already lists in its sitemaps are eligible: the static marketing pages of
 *     pages/sitemap.xml.ts and /blog, /blog/<slug> — on the canonical https host, with no query, fragment,
 *     credentials, port, or path tricks. Tenant, auth, API, prospect and user-supplied URLs never match.
 *   - Duplicate suppression and a minimum interval per process; bounded retries on 429 / 5xx / network.
 *   - The key never appears in a result, detail string or log line.
 */
import { SITEMAP_PATHS } from '../../../lib/seo/sitemapPaths';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const BLOG_SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

export type IndexNowConfig = {
  key: string | null;
  submitEnabled: boolean;
  publishKeyFile: boolean;
  /** Canonical origin, e.g. https://www.omnivyra.com (no trailing slash). */
  origin: string;
};

/** Reads INDEXNOW_API_KEY / INDEXNOW_SUBMIT_ENABLED / INDEXNOW_PUBLISH_KEY_FILE. A malformed key is treated as absent. */
export function readIndexNowConfig(origin: string, env: Record<string, string | undefined> = process.env): IndexNowConfig {
  const key = (env.INDEXNOW_API_KEY ?? '').trim();
  return { key: INDEXNOW_KEY_PATTERN.test(key) ? key : null, submitEnabled: env.INDEXNOW_SUBMIT_ENABLED === 'true', publishKeyFile: env.INDEXNOW_PUBLISH_KEY_FILE === 'true', origin: origin.replace(/\/+$/, '') };
}

/** Constant-time string comparison (equal lengths compared byte by byte). */
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The key-file response for a request to /<name>.txt: the key itself only when <name> IS the configured
 * key and publishing is switched on. Anything else → 404, so the route never confirms or reveals a key
 * that was not asked for exactly.
 */
export function indexNowKeyFile(requested: string | null | undefined, cfg: Pick<IndexNowConfig, 'key' | 'publishKeyFile'>): { status: 200; body: string } | { status: 404 } {
  const name = String(requested ?? '');
  if (!cfg.publishKeyFile || !cfg.key || !INDEXNOW_KEY_PATTERN.test(name) || !sameKey(name, cfg.key)) return { status: 404 };
  return { status: 200, body: cfg.key };
}

export type Eligibility = { ok: true; url: string } | { ok: false; reason: string };

/** Is `raw` a public page of this site that may be announced? Pure. */
export function eligibleIndexNowUrl(raw: unknown, origin: string): Eligibility {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return { ok: false, reason: 'not a URL' };
  let u: URL;
  let site: URL;
  try { u = new URL(raw.trim()); site = new URL(origin); } catch { return { ok: false, reason: 'not a URL' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'not https' };
  if (u.hostname.toLowerCase() !== site.hostname.toLowerCase()) return { ok: false, reason: 'not the canonical host' };
  if (u.username || u.password || u.port) return { ok: false, reason: 'credentials or port in URL' };
  if (u.search || u.hash || raw.includes('?') || raw.includes('#')) return { ok: false, reason: 'query or fragment' };
  if (/%2f|%5c|%2e/i.test(u.pathname) || /\/\/|\/\.\.?(\/|$)/.test(u.pathname)) return { ok: false, reason: 'encoded or dot path' };
  const path = u.pathname.replace(/\/+$/, '');
  const isStatic = SITEMAP_PATHS.includes(path);
  const blog = /^\/blog(?:\/([^/]+))?$/.exec(path);
  if (!isStatic && !(blog && (blog[1] === undefined || BLOG_SLUG.test(blog[1])))) return { ok: false, reason: 'not a page listed in the site’s sitemaps' };
  return { ok: true, url: `${site.origin}${path}` };
}

export type IndexNowChange = { url: string; change: 'added' | 'updated' | 'deleted' };

export type IndexNowOutcome =
  | 'disabled' | 'not_configured' | 'nothing_to_submit' | 'rate_limited_local'
  | 'received' | 'received_key_pending' | 'bad_request' | 'key_invalid' | 'urls_rejected' | 'rate_limited' | 'failed';

export type IndexNowResult = {
  outcome: IndexNowOutcome;
  /** Final HTTP status from the endpoint (null when no request was made or none answered). */
  httpStatus: number | null;
  attempts: number;
  at: string;
  submitted: string[];
  rejected: Array<{ url: string; reason: string }>;
  suppressed: string[];
  /** Human-readable; never contains the key. 'received' means the engine got the list — NOT that pages are indexed. */
  detail: string;
};

/** Per-process memory of what was sent (duplicate suppression + minimum interval). Injectable for tests. */
export type IndexNowStore = { lastSent: Map<string, number>; lastSubmitAt: number | null };
const defaultStore: IndexNowStore = { lastSent: new Map(), lastSubmitAt: null };

const OUTCOME_BY_STATUS: Record<number, IndexNowOutcome> = { 200: 'received', 202: 'received_key_pending', 400: 'bad_request', 403: 'key_invalid', 422: 'urls_rejected', 429: 'rate_limited' };

export async function submitIndexNow(changes: IndexNowChange[], cfg: IndexNowConfig, opts: {
  fetchImpl?: typeof fetch;
  store?: IndexNowStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Same URL again within this window is suppressed. Default 1 hour. */
  dedupWindowMs?: number;
  /** Minimum time between two submissions from this process. Default 60 s. */
  minIntervalMs?: number;
  /** URLs per request; the protocol allows 10,000, this platform sends far fewer. Default 100. */
  maxBatch?: number;
  maxRetries?: number;
  timeoutMs?: number;
} = {}): Promise<IndexNowResult> {
  const now = opts.now ?? Date.now;
  const store = opts.store ?? defaultStore;
  const at = new Date(now()).toISOString();
  const empty = { httpStatus: null, attempts: 0, at, submitted: [] as string[], rejected: [] as IndexNowResult['rejected'], suppressed: [] as string[] };
  if (!cfg.submitEnabled) return { ...empty, outcome: 'disabled', detail: 'IndexNow submission is switched off (INDEXNOW_SUBMIT_ENABLED is not "true"). Nothing was sent.' };
  if (!cfg.key) return { ...empty, outcome: 'not_configured', detail: 'No valid IndexNow key is configured (INDEXNOW_API_KEY). Nothing was sent.' };
  const key = cfg.key;
  const scrub = (s: string) => s.split(key).join('[key]');

  const rejected: IndexNowResult['rejected'] = [];
  const suppressed: string[] = [];
  const urls: string[] = [];
  const window = opts.dedupWindowMs ?? 3_600_000;
  for (const c of changes) {
    const el = eligibleIndexNowUrl(c?.url, cfg.origin);
    if (el.ok === false) { rejected.push({ url: String(c?.url ?? '').slice(0, 200), reason: el.reason }); continue; }
    const last = store.lastSent.get(el.url);
    if (urls.includes(el.url) || (last != null && now() - last < window)) { suppressed.push(el.url); continue; }
    urls.push(el.url);
  }
  const batch = urls.slice(0, opts.maxBatch ?? 100);
  const deferred = urls.slice(batch.length);
  const base = { ...empty, rejected, suppressed: [...suppressed, ...deferred] };
  if (!batch.length) return { ...base, outcome: 'nothing_to_submit', detail: `No eligible new URLs (${rejected.length} rejected, ${suppressed.length} already sent recently).` };
  const minInterval = opts.minIntervalMs ?? 60_000;
  if (store.lastSubmitAt != null && now() - store.lastSubmitAt < minInterval) {
    return { ...base, suppressed: [...base.suppressed, ...batch], outcome: 'rate_limited_local', detail: `Held back: the previous submission was less than ${Math.round(minInterval / 1000)} s ago.` };
  }

  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 2;
  const host = new URL(cfg.origin).hostname;
  const body = JSON.stringify({ host, key, keyLocation: `${cfg.origin}/${key}.txt`, urlList: batch });
  store.lastSubmitAt = now();
  let attempts = 0;
  let httpStatus: number | null = null;
  let detail = '';
  for (;;) {
    attempts++;
    let retryAfterMs: number | null = null;
    try {
      // ssrf-ok: fixed IndexNow endpoint; the URL list is validated to the platform's own host above.
      const res = await fetchImpl(INDEXNOW_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
      httpStatus = res.status;
      detail = scrub((await res.text().catch(() => '')).slice(0, 200));
      const ra = Number(res.headers.get('retry-after'));
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = Math.min(ra * 1000, 60_000);
    } catch (e) {
      httpStatus = null;
      detail = scrub(e instanceof Error ? e.message : String(e)).slice(0, 200);
    }
    const retryable = httpStatus == null || httpStatus === 429 || httpStatus >= 500;
    if (!retryable || attempts > maxRetries) break;
    await sleep(retryAfterMs ?? 1000 * 2 ** (attempts - 1));
  }

  const outcome: IndexNowOutcome = httpStatus == null ? 'failed' : OUTCOME_BY_STATUS[httpStatus] ?? 'failed';
  if (outcome === 'received' || outcome === 'received_key_pending') for (const u of batch) store.lastSent.set(u, now());
  const what = outcome === 'received' ? 'Received by IndexNow (HTTP 200). This does not mean the pages are indexed.'
    : outcome === 'received_key_pending' ? 'Received by IndexNow; key validation pending (HTTP 202). Not proof of indexing.'
      : `IndexNow ${httpStatus == null ? 'did not answer' : `answered HTTP ${httpStatus}`}${detail ? ` — ${detail}` : ''}.`;
  return { ...base, outcome, httpStatus, attempts, submitted: outcome.startsWith('received') ? batch : [], detail: what };
}
