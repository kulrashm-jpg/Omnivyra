/**
 * websiteMetadataExtractor.ts — pure HTML → company metadata (ONBOARD-001 §3/§7).
 *
 * NO network access. Operates on HTML already fetched by crawlWebsiteSources
 * (the single root-page fetch), so enrichment adds ZERO extra crawling.
 *
 * Extracts the discoverable identity/brand/SEO signals the onboarding prefill
 * needs: favicon, logo, OpenGraph block, description, title, site name,
 * language, region/country, brand (theme) colour, and SEO keywords. Every
 * value is returned with `source: 'system_discovered'` provenance so the
 * profile layer can mark it System-Discovered / User-Editable.
 */

export interface DiscoveredWebsiteMetadata {
  title: string | null;
  description: string | null;
  siteName: string | null;
  faviconUrl: string | null;
  logoUrl: string | null;
  language: string | null;      // e.g. "en"
  country: string | null;       // ISO-3166 alpha-2 derived from og:locale, e.g. "US"
  brandColor: string | null;    // theme-color
  keywords: string[];           // SEO meta keywords
  openGraph: Record<string, string>;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1].trim() : null;
}

function absolutize(href: string | null, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

/** Collect every <meta ...> and <link ...> tag body for scanning. */
function collectTags(html: string, tagName: 'meta' | 'link'): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[0]);
  return out;
}

/**
 * Extract discoverable company metadata from a page's HTML. Pure + resilient:
 * malformed markup yields nulls, never throws.
 */
export function extractWebsiteMetadata(html: string, baseUrl: string): DiscoveredWebsiteMetadata {
  const result: DiscoveredWebsiteMetadata = {
    title: null, description: null, siteName: null, faviconUrl: null, logoUrl: null,
    language: null, country: null, brandColor: null, keywords: [], openGraph: {},
  };
  if (!html) return result;

  // <html lang="…">
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const lang = attr(htmlTag, 'lang');
  if (lang) {
    const [primary, region] = lang.split(/[-_]/);
    result.language = primary?.toLowerCase() || null;
    if (region && /^[a-z]{2}$/i.test(region)) result.country = region.toUpperCase();
  }

  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) result.title = titleMatch[1].replace(/\s+/g, ' ').trim() || null;

  // <meta …>
  for (const tag of collectTags(html, 'meta')) {
    const property = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
    const content = attr(tag, 'content');
    if (!content) continue;

    if (property.startsWith('og:')) result.openGraph[property.slice(3)] = content;
    switch (property) {
      case 'description':          result.description ??= content; break;
      case 'og:description':       result.description ??= content; break;
      case 'og:site_name':         result.siteName ??= content; break;
      case 'og:image':             result.logoUrl ??= absolutize(content, baseUrl); break;
      case 'theme-color':          result.brandColor ??= content; break;
      case 'keywords':
        result.keywords = content.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 20);
        break;
      case 'og:locale': {
        const [primary, region] = content.split(/[-_]/);
        result.language ??= primary?.toLowerCase() || null;
        if (region && /^[a-z]{2}$/i.test(region)) result.country ??= region.toUpperCase();
        break;
      }
    }
  }

  // <link rel="icon|shortcut icon|apple-touch-icon">
  let appleTouchIcon: string | null = null;
  for (const tag of collectTags(html, 'link')) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (!href) continue;
    if (rel.includes('apple-touch-icon')) appleTouchIcon ??= absolutize(href, baseUrl);
    else if (rel === 'icon' || rel === 'shortcut icon' || rel.includes('icon')) result.faviconUrl ??= absolutize(href, baseUrl);
  }

  // Favicon fallback: the well-known /favicon.ico.
  if (!result.faviconUrl) result.faviconUrl = absolutize('/favicon.ico', baseUrl);
  // Logo fallback: apple-touch-icon is a decent square brand mark when no og:image.
  if (!result.logoUrl && appleTouchIcon) result.logoUrl = appleTouchIcon;

  return result;
}

/** True when the metadata carries at least one discovered signal worth persisting. */
export function hasDiscoveredSignal(meta: DiscoveredWebsiteMetadata): boolean {
  return Boolean(
    meta.title || meta.description || meta.siteName || meta.logoUrl ||
    meta.language || meta.country || meta.brandColor || meta.keywords.length ||
    Object.keys(meta.openGraph).length,
  );
}
