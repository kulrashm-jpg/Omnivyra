import { supabase } from '../db/supabaseClient';
import { ensureCanonicalDomain, hashKey, normalizeHost, normalizeUrl, resolveCompanyWebsite } from './ingestionUtils';
import { ownedDbTable } from '../db/writeOwner';

/**
 * BETA-ROADMAP-EXEC-002 — static-parser evidence depth. Signals recovered from the SAME regex/static
 * parse (no headless): structured data, canonical, i18n/pagination/feeds, image alt coverage, forms/tables,
 * publication date + author, and HTTP response metadata (security/compression headers). Persisted into the
 * existing `crawl_metadata` JSONB (no schema change) and read by the existing engines' placeholder checks.
 */
export interface PageSignals {
  canonical: boolean;
  jsonld_count: number;
  jsonld_types: string[];
  hreflang_count: number;
  has_pagination: boolean;
  feed_links: number;
  lang: string | null;
  img_count: number;
  img_with_alt: number;
  form_count: number;
  table_count: number;
  published_time: string | null;
  author: string | null;
  /**
   * BETA-AUTHORITY-EXEC-002 (Wave-1) — declared entity identity + credentials parsed from the already-fetched
   * JSON-LD. Evidence-only: never scored, never verified, never a recommendation. Optional/additive.
   */
  same_as?: string[];
  declared_credentials?: string[];
  response: {
    content_encoding: string | null;
    cache_control: string | null;
    security: { hsts: boolean; csp: boolean; x_frame_options: boolean; x_content_type_options: boolean };
    security_header_count: number;
  } | null;
  /** Domain-level signals attached to the root page only (robots.txt / sitemap.xml). */
  site?: { robots_txt: boolean; sitemap_xml: boolean; sitemap_url_count: number };
}

export interface CrawlPageResult {
  url: string;
  pageType: string;
  title: string;
  metaTitle: string | null;
  metaDescription: string | null;
  headings: Array<{ level: 1 | 2 | 3; text: string }>;
  contentBlocks: Array<{ blockType: 'heading' | 'paragraph' | 'list' | 'cta' | 'other'; headingLevel?: number; text: string; metadata?: Record<string, unknown> }>;
  ctas: Array<{ text: string; href: string | null }>;
  internalLinks: Array<{ url: string; anchorText: string }>;
  metaTags: Record<string, string>;
  signals: PageSignals;
  httpStatus: number;
  crawlDepth: number;
}

export interface CrawlCompanyWebsiteInput {
  companyId: string;
  rootUrl?: string;
  maxPages?: number;
  timeoutMs?: number;
}

export interface CrawlCompanyWebsiteResult {
  source: 'crawler';
  pagesProcessed: number;
  pagesInserted: number;
  linksInserted: number;
  contentBlocksInserted: number;
  rootUrl: string;
}

type QueueItem = {
  url: string;
  depth: number;
};

const CTA_PATTERNS = /\b(start|book|demo|try|contact|learn more|get started|request|sign up|talk to sales|download)\b/i;

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function cleanHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/\s+/g, ' ');
}

function extractTagContents(html: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const text = stripTags(match[1]);
    if (text) values.push(text);
  }
  return values;
}

function extractMetaTags(html: string): Record<string, string> {
  const regex = /<meta\s+([^>]+)>/gi;
  const tags: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const attrs = match[1];
    const name = /(?:name|property)=["']?([^"' >]+)["']?/i.exec(attrs)?.[1];
    const content = /content=["']([^"']*)["']/i.exec(attrs)?.[1];
    if (name && content != null) {
      tags[name.toLowerCase()] = decodeHtmlEntities(content.trim());
    }
  }
  return tags;
}

function resolveLink(baseUrl: string, href: string | null | undefined): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:') || trimmed.startsWith('javascript:')) {
    return null;
  }
  try {
    return normalizeUrl(new URL(trimmed, baseUrl).toString());
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: string, host: string): Array<{ url: string; anchorText: string; isInternal: boolean }> {
  const regex = /<a\s+([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const links: Array<{ url: string; anchorText: string; isInternal: boolean }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) != null) {
    const href = /href=["']([^"']+)["']/i.exec(match[1])?.[1];
    const url = resolveLink(baseUrl, href);
    if (!url) continue;
    const anchorText = stripTags(match[2]);
    const isInternal = normalizeHost(url) === host;
    links.push({ url, anchorText, isInternal });
  }

  return links;
}

function inferPageType(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname === '/' || pathname === '') return 'home';
  if (pathname.includes('/pricing')) return 'pricing';
  if (pathname.includes('/blog')) return 'blog';
  if (pathname.includes('/product')) return 'product';
  if (pathname.includes('/feature')) return 'feature';
  if (pathname.includes('/docs') || pathname.includes('/documentation')) return 'docs';
  if (pathname.includes('/contact')) return 'contact';
  // BETA-AUTHORITY-EXEC-002 (Wave-1) — legal-transparency page recognition via the existing classifier.
  if (/(?:^|\/)(?:privacy|terms|terms-of-service|tos|cookie|cookies|imprint|impressum|legal|legal-notice|disclosure|disclaimer)(?:[-/]|$)/.test(pathname)) return 'legal';
  if (pathname.split('/').filter(Boolean).length <= 1) return 'landing';
  return 'other';
}

/**
 * BETA-ROADMAP-EXEC-002 — recover static signals from the RAW html (JSON-LD lives in <script> which
 * cleanHtml strips, so this reads the raw markup) + HTTP response headers. No headless, no new requests.
 */
function extractPageSignals(rawHtml: string, metaTags: Record<string, string>, headers: Record<string, string> | null): PageSignals {
  const count = (re: RegExp) => (rawHtml.match(re) || []).length;

  // Structured data (JSON-LD) — count blocks + collect @type values.
  const jsonldTypes: string[] = [];
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ld: RegExpExecArray | null;
  let jsonldCount = 0;
  while ((ld = ldRegex.exec(rawHtml)) != null) {
    jsonldCount += 1;
    for (const t of ld[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) if (!jsonldTypes.includes(t[1])) jsonldTypes.push(t[1]);
  }
  const ldDatePublished = /"datePublished"\s*:\s*"([^"]+)"/i.exec(rawHtml)?.[1] ?? null;
  const ldAuthor = /"author"\s*:\s*\{[^}]*"name"\s*:\s*"([^"]+)"/i.exec(rawHtml)?.[1] ?? null;

  // BETA-AUTHORITY-EXEC-002 (Wave-1) — declared entity identity (sameAs) + declared credentials, parsed from
  // the already-fetched JSON-LD. Evidence-only; no additional fetch, no scoring, no verification.
  const sameAs: string[] = [];
  for (const m of rawHtml.matchAll(/"sameAs"\s*:\s*(\[[^\]]*\]|"[^"]*")/gi)) {
    for (const u of m[1].matchAll(/"(https?:\/\/[^"\s]+)"/g)) sameAs.push(u[1]);
  }
  const declaredCredentials: string[] = [];
  for (const key of ['award', 'hasCredential', 'certification', 'memberOf', 'professionalQualification']) {
    const strRe = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'gi');
    let matched = false;
    for (const m of rawHtml.matchAll(strRe)) { declaredCredentials.push(`${key}: ${m[1]}`); matched = true; }
    if (!matched && new RegExp(`"${key}"\\s*:`, 'i').test(rawHtml)) declaredCredentials.push(key);
  }

  const imgCount = count(/<img\b/gi);
  const imgWithAlt = count(/<img\b[^>]*\balt=/gi);

  const h = headers || {};
  const hv = (k: string) => (typeof h[k] === 'string' ? h[k] : (typeof h[k.toLowerCase()] === 'string' ? h[k.toLowerCase()] : null));
  const security = {
    hsts: Boolean(hv('strict-transport-security')),
    csp: Boolean(hv('content-security-policy')),
    x_frame_options: Boolean(hv('x-frame-options')),
    x_content_type_options: Boolean(hv('x-content-type-options')),
  };
  const response = headers
    ? {
        content_encoding: hv('content-encoding'),
        cache_control: hv('cache-control'),
        security,
        security_header_count: Object.values(security).filter(Boolean).length,
      }
    : null;

  return {
    canonical: /<link[^>]+rel=["']canonical["']/i.test(rawHtml),
    jsonld_count: jsonldCount,
    jsonld_types: jsonldTypes.slice(0, 12),
    hreflang_count: count(/<link[^>]+rel=["']alternate["'][^>]+hreflang=/gi),
    has_pagination: /<link[^>]+rel=["'](?:prev|next)["']/i.test(rawHtml),
    feed_links: count(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["']/gi),
    lang: /<html[^>]+\blang=["']([^"']+)["']/i.exec(rawHtml)?.[1]?.trim() ?? null,
    img_count: imgCount,
    img_with_alt: imgWithAlt,
    form_count: count(/<form\b/gi),
    table_count: count(/<table\b/gi),
    published_time: metaTags['article:published_time'] ?? ldDatePublished ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(rawHtml)?.[1] ?? null,
    author: metaTags['author'] ?? ldAuthor ?? null,
    same_as: [...new Set(sameAs)].slice(0, 25),
    declared_credentials: [...new Set(declaredCredentials)].slice(0, 25),
    response,
  };
}

/** BETA-ROADMAP-EXEC-002 — fetch robots.txt + sitemap.xml once per domain (2 cheap GETs; degrades to absent). */
async function fetchSiteFiles(rootUrl: string, timeoutMs: number): Promise<PageSignals['site']> {
  const origin = new URL(rootUrl).origin;
  // HARDEN-005: the crawl origin comes from a user-writable website row, and the
  // robots.txt-declared sitemap URL is fully attacker-controllable (e.g.
  // `Sitemap: http://169.254.169.254/…`). Both go through the SSRF-safe fetcher
  // (validated host, DNS-pinned, redirect-revalidated, size-capped).
  const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
  const getUrl = async (u: string): Promise<string | null> => {
    try {
      const r = await safeFetch(u, { method: 'GET', headers: { 'User-Agent': 'OmnivyraBot/1.0 (+https://omnivyra.com)' } }, { timeoutMs, maxBytes: 10 * 1024 * 1024 });
      if (r.status < 200 || r.status >= 400) return null;
      return (await readCapped(r)).toString('utf8');
    } catch { return null; }
  };
  const robots = await getUrl(`${origin}/robots.txt`);
  let sitemap = await getUrl(`${origin}/sitemap.xml`);
  // robots.txt may point at a differently-named sitemap.
  if (sitemap == null && robots) {
    const declared = /Sitemap:\s*(\S+)/i.exec(robots)?.[1];
    if (declared) { sitemap = await getUrl(declared); }
  }
  return {
    robots_txt: robots != null && robots.trim().length > 0,
    sitemap_xml: sitemap != null && /<(?:urlset|sitemapindex)\b/i.test(sitemap),
    sitemap_url_count: sitemap ? (sitemap.match(/<loc>/gi) || []).length : 0,
  };
}

function parsePage(html: string, url: string, depth: number, headers: Record<string, string> | null = null): CrawlPageResult {
  const cleaned = cleanHtml(html);
  const metaTags = extractMetaTags(cleaned);
  // BETA-ROADMAP-EXEC-002: recover the additional static signals from the RAW html + response headers.
  const signals = extractPageSignals(html, metaTags, headers);
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)?.[1] ?? '');
  const headings = [1, 2, 3].flatMap((level) =>
    extractTagContents(cleaned, `h${level}`).map((text) => ({ level: level as 1 | 2 | 3, text }))
  );
  const paragraphs = extractTagContents(cleaned, 'p');
  const lists = extractTagContents(cleaned, 'li');
  const host = normalizeHost(url);
  const links = extractLinks(cleaned, url, host);
  const ctas = links
    .filter((link) => CTA_PATTERNS.test(link.anchorText))
    .map((link) => ({ text: link.anchorText, href: link.url }));

  const contentBlocks: CrawlPageResult['contentBlocks'] = [];
  headings.forEach((heading) => {
    contentBlocks.push({
      blockType: 'heading',
      headingLevel: heading.level,
      text: heading.text,
    });
  });
  paragraphs.forEach((paragraph) => {
    contentBlocks.push({ blockType: 'paragraph', text: paragraph });
  });
  lists.forEach((item) => {
    contentBlocks.push({ blockType: 'list', text: item });
  });
  ctas.forEach((cta) => {
    contentBlocks.push({
      blockType: 'cta',
      text: cta.text,
      metadata: { href: cta.href },
    });
  });

  return {
    url,
    pageType: inferPageType(url),
    title,
    metaTitle: metaTags['og:title'] ?? metaTags.title ?? (title || null),
    metaDescription: metaTags.description ?? metaTags['og:description'] ?? null,
    headings,
    contentBlocks,
    ctas,
    internalLinks: links.filter((link) => link.isInternal).map((link) => ({ url: link.url, anchorText: link.anchorText })),
    metaTags,
    signals,
    httpStatus: 200,
    crawlDepth: depth,
  };
}

async function fetchHtml(url: string, timeoutMs: number): Promise<{ html: string; status: number; headers: Record<string, string> }> {
  // HARDEN-005: crawl target is user-controlled — SSRF-safe fetch (validated
  // host, DNS-pinned, each redirect hop re-validated up to the cap, 10MB cap).
  // Preserves the old 200–399 "ok" contract (throw on 4xx/5xx like axios did).
  const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
  const response = await safeFetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'OmnivyraBot/1.0 (+https://omnivyra.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
  }, { timeoutMs, maxRedirects: 5, maxBytes: 10 * 1024 * 1024 });

  if (response.status < 200 || response.status >= 400) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  // Retain the HTTP response headers so security / compression / caching
  // metadata can be recovered without any extra request.
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const html = (await readCapped(response)).toString('utf8');
  return { html, status: response.status, headers };
}

async function persistCrawledPage(companyId: string, domainId: string, page: CrawlPageResult): Promise<{
  pageId: string;
  insertedContentBlocks: number;
  insertedLinks: number;
  pageInserted: boolean;
}> {
  const { data: pageRow, error: pageError } = await ownedDbTable('canonical_pages')
    .upsert(
      {
        company_id: companyId,
        domain_id: domainId,
        url: page.url,
        page_type: page.pageType,
        title: page.title || null,
        meta_title: page.metaTitle,
        meta_description: page.metaDescription,
        headings: page.headings,
        ctas: page.ctas,
        internal_link_count: page.internalLinks.length,
        last_crawled_at: new Date().toISOString(),
        crawl_depth: page.crawlDepth,
        http_status: page.httpStatus,
        crawl_metadata: {
          meta_tags: page.metaTags,
          cta_count: page.ctas.length,
          // BETA-ROADMAP-EXEC-002: recovered static + response-header signals (single representation).
          signals: page.signals,
        },
      },
      { onConflict: 'company_id,url' }
    )
    .select('id')
    .single();

  if (pageError) {
    throw new Error(`Failed to persist crawled page ${page.url}: ${pageError.message}`);
  }

  const pageId = (pageRow as { id: string }).id;

  await ownedDbTable('page_content').delete().eq('company_id', companyId).eq('page_id', pageId);
  await ownedDbTable('page_links').delete().eq('company_id', companyId).eq('from_page_id', pageId);

  if (page.contentBlocks.length > 0) {
    const { error } = await ownedDbTable('page_content').insert(
      page.contentBlocks.map((block, index) => ({
        company_id: companyId,
        page_id: pageId,
        block_index: index,
        block_type: block.blockType,
        heading_level: block.headingLevel ?? null,
        content_text: block.text,
        metadata: block.metadata ?? {},
      }))
    );
    if (error) {
      throw new Error(`Failed to persist page content for ${page.url}: ${error.message}`);
    }
  }

  if (page.internalLinks.length > 0) {
    const { error } = await ownedDbTable('page_links').insert(
      page.internalLinks.map((link, index) => ({
        company_id: companyId,
        from_page_id: pageId,
        to_url: link.url,
        anchor_text: link.anchorText || null,
        is_internal: true,
        position_index: index,
        metadata: {},
      }))
    );
    if (error) {
      throw new Error(`Failed to persist page links for ${page.url}: ${error.message}`);
    }
  }

  await ownedDbTable('page_links')
    .update({ to_page_id: pageId })
    .eq('company_id', companyId)
    .eq('to_url', page.url)
    .is('to_page_id', null);

  return {
    pageId,
    insertedContentBlocks: page.contentBlocks.length,
    insertedLinks: page.internalLinks.length,
    pageInserted: true,
  };
}

export async function crawlCompanyWebsite(input: CrawlCompanyWebsiteInput): Promise<CrawlCompanyWebsiteResult> {
  const resolvedRootUrl = input.rootUrl ?? (await resolveCompanyWebsite(input.companyId)) ?? null;
  if (!resolvedRootUrl) {
    throw new Error(`No website configured for company ${input.companyId}`);
  }

  const rootUrl = normalizeUrl(resolvedRootUrl);

  const maxPages = Math.max(1, Math.min(input.maxPages ?? 250, 1000));
  const timeoutMs = Math.max(2000, input.timeoutMs ?? 10000);
  const rootHost = normalizeHost(rootUrl);
  const domain = await ensureCanonicalDomain(input.companyId, rootUrl);
  // BETA-ROADMAP-EXEC-002: one-time domain-level fetch of robots.txt + sitemap.xml (2 cheap GETs).
  const siteFiles = await fetchSiteFiles(rootUrl, timeoutMs).catch(() => undefined);

  const visited = new Set<string>();
  const queue: QueueItem[] = [{ url: rootUrl, depth: 0 }];
  let pagesProcessed = 0;
  let pagesInserted = 0;
  let linksInserted = 0;
  let contentBlocksInserted = 0;

  while (queue.length > 0 && pagesProcessed < maxPages) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);

    let fetched;
    try {
      fetched = await fetchHtml(current.url, timeoutMs);
    } catch (error) {
      await ownedDbTable('canonical_pages')
        .upsert(
          {
            company_id: input.companyId,
            domain_id: domain.id,
            url: current.url,
            page_type: inferPageType(current.url),
            http_status: 0,
            crawl_depth: current.depth,
            last_crawled_at: new Date().toISOString(),
            crawl_metadata: {
              fetch_error: (error as Error)?.message ?? String(error),
            },
          },
          { onConflict: 'company_id,url' }
        );
      continue;
    }

    const parsed = parsePage(fetched.html, current.url, current.depth, fetched.headers);
    parsed.httpStatus = fetched.status;
    // Attach the one-time domain-level robots/sitemap signals to the root page.
    if (current.depth === 0 && siteFiles) parsed.signals.site = siteFiles;

    const persisted = await persistCrawledPage(input.companyId, domain.id, parsed);
    pagesProcessed += 1;
    pagesInserted += persisted.pageInserted ? 1 : 0;
    linksInserted += persisted.insertedLinks;
    contentBlocksInserted += persisted.insertedContentBlocks;

    for (const link of parsed.internalLinks) {
      if (visited.has(link.url)) continue;
      if (normalizeHost(link.url) !== rootHost) continue;
      queue.push({ url: link.url, depth: current.depth + 1 });
    }
  }

  return {
    source: 'crawler',
    pagesProcessed,
    pagesInserted,
    linksInserted,
    contentBlocksInserted,
    rootUrl,
  };
}

export function buildCrawlerRunKey(companyId: string, rootUrl: string): string {
  return hashKey('crawler', companyId, rootUrl);
}
