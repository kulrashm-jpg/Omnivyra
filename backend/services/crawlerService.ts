import axios from 'axios';
import { supabase } from '../db/supabaseClient';
import { ensureCanonicalDomain, hashKey, normalizeHost, normalizeUrl, resolveCompanyWebsite } from './ingestionUtils';

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
  if (pathname.split('/').filter(Boolean).length <= 1) return 'landing';
  return 'other';
}

function parsePage(html: string, url: string, depth: number): CrawlPageResult {
  const cleaned = cleanHtml(html);
  const metaTags = extractMetaTags(cleaned);
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
    httpStatus: 200,
    crawlDepth: depth,
  };
}

async function fetchHtml(url: string, timeoutMs: number): Promise<{ html: string; status: number }> {
  const response = await axios.get<string>(url, {
    timeout: timeoutMs,
    maxRedirects: 5,
    responseType: 'text',
    headers: {
      'User-Agent': 'OmnivyraBot/1.0 (+https://omnivyra.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    validateStatus: (status) => status >= 200 && status < 400,
  });

  return {
    html: String(response.data ?? ''),
    status: response.status,
  };
}

async function persistCrawledPage(companyId: string, domainId: string, page: CrawlPageResult): Promise<{
  pageId: string;
  insertedContentBlocks: number;
  insertedLinks: number;
  pageInserted: boolean;
}> {
  const { data: pageRow, error: pageError } = await supabase
    .from('canonical_pages')
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

  await supabase.from('page_content').delete().eq('company_id', companyId).eq('page_id', pageId);
  await supabase.from('page_links').delete().eq('company_id', companyId).eq('from_page_id', pageId);

  if (page.contentBlocks.length > 0) {
    const { error } = await supabase.from('page_content').insert(
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
    const { error } = await supabase.from('page_links').insert(
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

  await supabase
    .from('page_links')
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
      await supabase
        .from('canonical_pages')
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

    const parsed = parsePage(fetched.html, current.url, current.depth);
    parsed.httpStatus = fetched.status;

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
