/**
 * GAP-17 — the brand label the AI-surface subsystem queries with.
 *
 * THE DEFECT
 * `deriveCitationQueries` builds the `branded` query class ("What is X?", "Tell me about X.")
 * only when it is given a brand name. That name comes from the company profile
 * (`resolved.companyName` → `company_profiles.name`), which is frequently empty. When it is,
 * the single most meaningful AI-visibility class is skipped entirely and every one of its cells
 * is recorded as `unavailable` with `reason_unavailable: "No queries derived for branded."` —
 * not because the provider failed, but because nothing asked it anything.
 *
 * WHAT THIS READS
 * Only evidence the crawl has ALREADY stored for this company: the site's own declared name on
 * the page that matches the report's domain (`og:site_name`, then `application-name`, then the
 * brand segment of the homepage `<title>`). No fetch, no provider, no new acquisition.
 *
 * WHAT IT WILL NOT DO
 * It never invents a name from the domain, and it never rewrites one the site declared: both are
 * inferences about identity, and this file's only job is to report what the site says it is called.
 * When the site declares nothing, this returns null and the branded class stays honestly
 * unavailable, exactly as today.
 */
import { supabase } from '../../db/supabaseClient';

type CrawlMetadata = {
  meta_tags?: Record<string, string> | null;
} | null;

type PageRow = {
  url: string | null;
  title: string | null;
  meta_title: string | null;
  crawl_metadata: CrawlMetadata;
};

/** Title separators sites use between the page name and the brand: "Page | Brand". */
const TITLE_SEPARATORS = /\s+[|·•–—]\s+/;

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  return trimmed;
}

/** `example.com` / `www.example.com` / `https://example.com/path` → `example.com`. */
export function normalizeHost(value: string | null | undefined): string | null {
  const raw = clean(value);
  if (!raw) return null;
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase() || null;
}

/** The brand segment of a title: the last "Page | Brand" part, when the title declares one. */
function brandFromTitle(title: string | null, host: string | null): string | null {
  const raw = clean(title);
  if (!raw) return null;
  const parts = raw.split(TITLE_SEPARATORS).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const candidate = clean(parts[parts.length - 1]);
  if (!candidate) return null;
  const label = host ? host.split('.')[0].toLowerCase() : null;
  // Accept the trailing segment only when it corroborates the domain — otherwise it is a
  // marketing phrase, not a name.
  if (!label || !candidate.toLowerCase().replace(/[^a-z0-9]/g, '').includes(label.replace(/[^a-z0-9]/g, ''))) {
    return null;
  }
  return candidate;
}

/**
 * Pick the site-declared name from pages already crawled for this company, restricted to the
 * report's own domain. A company's page set can contain more than one host (an earlier scan of a
 * different domain), so the host match is what keeps this grounded in the right site.
 */
export function selectObservedBrandName(pages: PageRow[], domain: string | null): string | null {
  const host = normalizeHost(domain);
  if (!host) return null;
  const onDomain = pages.filter((page) => {
    const pageHost = normalizeHost(page.url);
    return pageHost === host;
  });
  if (onDomain.length === 0) return null;

  // Prefer the homepage's declaration, then any page on the same host.
  const isHome = (page: PageRow) => /^https?:\/\/[^/]+\/?$/i.test(page.url ?? '');
  const ordered = [...onDomain.filter(isHome), ...onDomain.filter((page) => !isHome(page))];

  for (const key of ['og:site_name', 'application-name'] as const) {
    for (const page of ordered) {
      const declared = clean(page.crawl_metadata?.meta_tags?.[key]);
      // Verbatim: this is the site's own declaration. Trimming it ("Calendly.com" → "Calendly")
      // would be our inference layered on top of observed evidence, and the label's only job is
      // to phrase the query.
      if (declared) return declared;
    }
  }
  for (const page of ordered) {
    const fromTitle = brandFromTitle(page.meta_title ?? page.title, host);
    if (fromTitle) return fromTitle;
  }
  return null;
}

/**
 * Resolve the site-declared brand name from already-crawled pages. Returns null — never a guess —
 * when the company has no crawled page on the domain, or none of them declares a name.
 */
export async function resolveObservedBrandName(params: {
  companyId: string | null | undefined;
  domain: string | null | undefined;
}): Promise<string | null> {
  const host = normalizeHost(params.domain);
  if (!params.companyId || !host) return null;
  try {
    const { data, error } = await supabase
      .from('canonical_pages')
      .select('url, title, meta_title, crawl_metadata')
      .eq('company_id', params.companyId)
      .limit(200);
    if (error || !Array.isArray(data)) return null;
    return selectObservedBrandName(data as PageRow[], host);
  } catch {
    // The AI surface must degrade to today's behaviour, never block the report.
    return null;
  }
}
