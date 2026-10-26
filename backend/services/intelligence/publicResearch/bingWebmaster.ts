/**
 * Bing Webmaster Tools — owner-authorised evidence for the Digital Snapshot: inbound links (backlinks)
 * and Bing search performance (impressions, clicks, average position per query).
 *
 * Official API (learn.microsoft.com/bingwebmaster/getting-access; method reference
 * learn.microsoft.com/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi, read 26 Oct 2026):
 *   GET https://ssl.bing.com/webmaster/api.svc/json/<Method>?...&apikey=<key>   → { "d": ... }
 *   GetUserSites()                 → [{ Url, IsVerified, ... }]   sites this key's user can read
 *   GetLinkCounts(siteUrl, page)   → { Links: [{ Url, Count }], TotalPages }   pages with inbound links
 *   GetQueryStats(siteUrl)         → [{ Query, Impressions, Clicks, AvgImpressionPosition, AvgClickPosition, Date }]
 *                                    ("The data will be updated every week.")
 *
 * Access model: ONE platform key (BING_WEBMASTER_API_KEY, the key of Omnivyra's Bing Webmaster user).
 * It reads only sites that user can see: sites it verified, or sites whose owner added it as a user.
 * A company's site that is not in that list is "not authorised for this account" — never "no links".
 *
 * Nothing here is a score input; it is evidence with a date and a source. The key goes only into the
 * request URL handed to fetch; it is never logged, stored or put into an error detail.
 */
export type BingStatus = 'measured' | 'not_configured' | 'site_not_authorised' | 'invalid_key' | 'rate_limited' | 'failed';

export type BingWebmasterEvidence = {
  status: BingStatus;
  checkedAt: string;
  /** The verified site URL the data belongs to, exactly as Bing Webmaster lists it. */
  siteUrl: string | null;
  detail: string;
  links: {
    /** Pages of this site with inbound links, most-linked first (at most `maxLinkPages` API pages read). */
    pages: Array<{ url: string; count: number }>;
    /** Sum of Count over the pages read; a lower bound when `complete` is false. */
    total: number;
    complete: boolean;
  } | null;
  search: {
    /** Top queries by impressions over the period Bing returned. */
    queries: Array<{ query: string; impressions: number; clicks: number; avgImpressionPosition: number | null; avgClickPosition: number | null }>;
    impressions: number;
    clicks: number;
    /** Range of the Date values Bing returned (it updates weekly). */
    from: string | null;
    to: string | null;
    /** The newest data point is older than STALE_SEARCH_DAYS at retrieval (Bing updates weekly). */
    stale?: boolean;
  } | null;
  /** GetCrawlStats: the newest daily row of the last six months Bing returns (updated daily). */
  crawl?: {
    date: string | null;
    inIndex: number | null;
    inLinks: number | null;
    crawledPages: number | null;
    crawlErrors: number | null;
    blockedByRobotsTxt: number | null;
    code4xx: number | null;
    code5xx: number | null;
    from: string | null;
    stale: boolean;
  } | null;
  /** GetUrlLinks, first result page for the most-linked pages: a SAMPLE of linking URLs, never the full list. */
  linkSample?: {
    links: Array<{ target: string; source: string; anchorText: string | null }>;
    /** Distinct linking hosts within the sample only. */
    referringHosts: string[];
    targetsSampled: number;
  } | null;
  /** Optional reports that failed while the core reads succeeded (no key material). */
  partial?: string[];
  provenance?: {
    source: 'Bing Webmaster Tools API';
    methods: string[];
    docUrl: string;
    definitions: Record<string, string>;
  };
};

const STALE_SEARCH_DAYS = 21;
const STALE_CRAWL_DAYS = 7;
const SAMPLE_TARGETS = 3;

/** What each reported number means, as Bing documents it; carried into the evidence ledger. */
export const BING_METRIC_DEFINITIONS: Record<string, string> = {
  inbound_links: 'GetLinkCounts: pages of the verified site that have inbound links, with Bing’s count per page. Bing’s own index, not every link on the web.',
  link_sample: 'GetUrlLinks: linking URLs and anchor text for one page of the site (first result page only — a sample).',
  search_queries: 'GetQueryStats: impressions, clicks and average position per query in Bing search; updated weekly.',
  crawl: 'GetCrawlStats: daily pages crawled, crawl errors, pages in Bing’s index and inbound links Bing counted; last six months, updated daily.',
};

const BASE = 'https://ssl.bing.com/webmaster/api.svc/json/';
const scrub = (s: string, key?: string) => (key ? s.split(key).join('[redacted]') : s).replace(/(apikey=)[^&\s"']+/gi, '$1[redacted]').replace(/\b[a-f0-9]{24,}\b/gi, '[redacted]');

/** "/Date(1316156400000-0700)/" → ISO date (day), or null. Pure. */
export function bingDate(v: unknown): string | null {
  const m = /\/Date\((-?\d+)/.exec(String(v ?? ''));
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null;
}

const host = (u: string) => { try { return new URL(u.includes('://') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** Pick the verified site that is this domain (apex or www, http or https). Pure. */
export function matchVerifiedSite(sites: Array<{ Url?: unknown; IsVerified?: unknown }>, domain: string): string | null {
  const want = host(domain);
  const candidates = sites.filter((s) => s.IsVerified === true && typeof s.Url === 'string' && host(String(s.Url)) === want).map((s) => String(s.Url));
  // Prefer https, then the shortest (the site root over a subfolder property).
  return candidates.sort((a, b) => Number(b.startsWith('https')) - Number(a.startsWith('https')) || a.length - b.length)[0] ?? null;
}

class BingCallError extends Error {
  constructor(readonly status: BingStatus, readonly httpStatus: number | null, message: string) { super(message); }
}

async function call(method: string, params: Record<string, string>, key: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<any> {
  const q = new URLSearchParams({ ...params, apikey: key });
  let res: Response;
  try {
    // ssrf-ok: fixed Microsoft endpoint; the site URL is a query parameter, never a host.
    res = await fetchImpl(`${BASE}${method}?${q.toString()}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new BingCallError('failed', null, scrub(`${method}: ${e instanceof Error ? e.message : String(e)}`, key).slice(0, 200));
  }
  const text = await res.text().catch(() => '');
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON fault body */ }
  if (!res.ok) {
    const said = scrub(String(body?.Message ?? body?.d?.Message ?? text ?? ''), key).slice(0, 200);
    const status: BingStatus = res.status === 429 || /throttl|quota|too many/i.test(said) ? 'rate_limited'
      : /not authori[sz]ed|not verified|access denied|unauthori[sz]ed site/i.test(said) ? 'site_not_authorised'
        : res.status === 401 || res.status === 403 || /invalid api ?key|apikey/i.test(said) ? 'invalid_key' : 'failed';
    throw new BingCallError(status, res.status, `${method}: HTTP ${res.status}${said ? ` — ${said}` : ''}`);
  }
  return body?.d ?? null;
}

/**
 * Read inbound links and Bing search performance for this company's domain. Never throws.
 * `key` comes from the caller (resolveProviderCredential('bing_webmaster')); null → not_configured.
 */
export async function fetchBingWebmaster(domain: string, key: string | null, opts: { fetchImpl?: typeof fetch; timeoutMs?: number; maxLinkPages?: number; now?: () => Date } = {}): Promise<BingWebmasterEvidence> {
  const checkedAt = (opts.now ?? (() => new Date()))().toISOString();
  const base = { checkedAt, siteUrl: null, links: null, search: null };
  if (!key) return { ...base, status: 'not_configured', detail: 'No Bing Webmaster Tools API key is configured (BING_WEBMASTER_API_KEY).' };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  try {
    const sites = await call('GetUserSites', {}, key, fetchImpl, timeoutMs);
    const siteUrl = matchVerifiedSite(Array.isArray(sites) ? sites : [], domain);
    if (!siteUrl) {
      return { ...base, status: 'site_not_authorised', detail: `${host(domain)} is not a verified site for this Bing Webmaster account. The site owner verifies it in Bing Webmaster Tools, or adds Omnivyra's Bing account as a user of the site.` };
    }

    const pages: Array<{ url: string; count: number }> = [];
    const maxPages = Math.max(1, opts.maxLinkPages ?? 5);
    let totalPages = 1;
    for (let page = 0; page < Math.min(totalPages, maxPages); page++) {
      const d = await call('GetLinkCounts', { siteUrl, page: String(page) }, key, fetchImpl, timeoutMs);
      totalPages = Math.max(1, Number(d?.TotalPages) || 1);
      for (const l of Array.isArray(d?.Links) ? d.Links : []) {
        if (typeof l?.Url === 'string') pages.push({ url: l.Url, count: Number(l.Count) || 0 });
      }
    }
    pages.sort((a, b) => b.count - a.count);

    const rows = await call('GetQueryStats', { siteUrl }, key, fetchImpl, timeoutMs);
    const list = (Array.isArray(rows) ? rows : []).filter((r: any) => typeof r?.Query === 'string');
    const byQuery = new Map<string, { query: string; impressions: number; clicks: number; ip: number[]; cp: number[] }>();
    const dates: string[] = [];
    for (const r of list) {
      const e = byQuery.get(r.Query) ?? { query: r.Query, impressions: 0, clicks: 0, ip: [], cp: [] };
      e.impressions += Number(r.Impressions) || 0;
      e.clicks += Number(r.Clicks) || 0;
      if (Number.isFinite(Number(r.AvgImpressionPosition))) e.ip.push(Number(r.AvgImpressionPosition));
      if (Number.isFinite(Number(r.AvgClickPosition)) && Number(r.AvgClickPosition) > 0) e.cp.push(Number(r.AvgClickPosition));
      byQuery.set(r.Query, e);
      const d = bingDate(r.Date);
      if (d) dates.push(d);
    }
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    const queries = [...byQuery.values()].sort((a, b) => b.impressions - a.impressions).slice(0, 25)
      .map((q) => ({ query: q.query, impressions: q.impressions, clicks: q.clicks, avgImpressionPosition: avg(q.ip), avgClickPosition: avg(q.cp) }));
    dates.sort();
    const ageDays = (d: string | null) => (d ? (Date.parse(checkedAt) - Date.parse(d)) / 86_400_000 : Infinity);

    // Optional reports: a failure here keeps the links and search data and is recorded in `partial`.
    const partial: string[] = [];
    const optional = <T>(label: string, p: Promise<T>): Promise<T | null> => p.catch((e) => {
      partial.push(`${label}: ${e instanceof BingCallError ? e.message : scrub(String(e), key).slice(0, 160)}`);
      return null;
    });
    const targets = pages.filter((p) => p.count > 0).slice(0, SAMPLE_TARGETS);
    const [crawlRows, ...linkDetails] = await Promise.all([
      optional('GetCrawlStats', call('GetCrawlStats', { siteUrl }, key, fetchImpl, timeoutMs)),
      ...targets.map((t) => optional(`GetUrlLinks ${t.url}`, call('GetUrlLinks', { siteUrl, link: t.url, page: '0' }, key, fetchImpl, timeoutMs))),
    ]);

    const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const crawlList = (Array.isArray(crawlRows) ? crawlRows : []).map((r: any) => ({ r, date: bingDate(r?.Date) })).filter((x) => x.date).sort((a, b) => a.date!.localeCompare(b.date!));
    const last = crawlList[crawlList.length - 1];
    const crawl = last ? {
      date: last.date, inIndex: n(last.r.InIndex), inLinks: n(last.r.InLinks), crawledPages: n(last.r.CrawledPages), crawlErrors: n(last.r.CrawlErrors),
      blockedByRobotsTxt: n(last.r.BlockedByRobotsTxt), code4xx: n(last.r.Code4xx), code5xx: n(last.r.Code5xx), from: crawlList[0].date, stale: ageDays(last.date) > STALE_CRAWL_DAYS,
    } : null;

    const sampled = targets.flatMap((t, i) => (Array.isArray((linkDetails[i] as any)?.Details) ? (linkDetails[i] as any).Details : [])
      .filter((d: any) => typeof d?.Url === 'string')
      .map((d: any) => ({ target: t.url, source: String(d.Url), anchorText: typeof d.AnchorText === 'string' && d.AnchorText.trim() ? d.AnchorText.trim().slice(0, 120) : null })));
    const linkSample = targets.length ? { links: sampled.slice(0, 30), referringHosts: [...new Set(sampled.map((s) => host(s.source)).filter(Boolean))].sort(), targetsSampled: targets.length } : null;

    const methods = ['GetUserSites', 'GetLinkCounts', 'GetQueryStats', 'GetCrawlStats', ...(targets.length ? ['GetUrlLinks'] : [])];
    return {
      checkedAt, siteUrl, status: 'measured',
      detail: `Read from Bing Webmaster Tools for ${siteUrl}: ${pages.length} linked page${pages.length === 1 ? '' : 's'}${totalPages > maxPages ? ` (first ${maxPages} of ${totalPages} result pages)` : ''}; ${byQuery.size} search quer${byQuery.size === 1 ? 'y' : 'ies'}${partial.length ? `; ${partial.length} optional report${partial.length === 1 ? '' : 's'} unavailable` : ''}.`,
      links: { pages: pages.slice(0, 50), total: pages.reduce((s, p) => s + p.count, 0), complete: totalPages <= maxPages },
      search: { queries, impressions: [...byQuery.values()].reduce((s, q) => s + q.impressions, 0), clicks: [...byQuery.values()].reduce((s, q) => s + q.clicks, 0), from: dates[0] ?? null, to: dates[dates.length - 1] ?? null,
        stale: dates.length ? ageDays(dates[dates.length - 1]) > STALE_SEARCH_DAYS : false },
      crawl, linkSample, partial,
      provenance: { source: 'Bing Webmaster Tools API', methods, docUrl: 'https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi', definitions: BING_METRIC_DEFINITIONS },
    };
  } catch (e) {
    const err = e instanceof BingCallError ? e : new BingCallError('failed', null, scrub(String(e), key ?? undefined).slice(0, 200));
    return { ...base, status: err.status, detail: err.message };
  }
}
