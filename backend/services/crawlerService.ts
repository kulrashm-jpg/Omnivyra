import { supabase } from '../db/supabaseClient';
import { ensureCanonicalDomain, hashKey, normalizeHost, normalizeUrl, resolveCompanyWebsite } from './ingestionUtils';
import { ownedDbTable } from '../db/writeOwner';
// CKRE-001 §1 — boundary instrumentation for the Website Intelligence crawl
// (reuses the AUTH-001 event infra; correlation ties to the company journey).
import { emitCrawlEvent, resolveCrawlCorrelationId } from './crawl/crawlEventService';
// D2 — canonical reachability vocabulary. One classifier, used by the crawler and
// by the checks that read what it wrote.
import {
  classifyFetchError,
  isHttpErrorOutcome,
  observationFromStatus,
  NO_HTTP_RESPONSE_STATUS,
  type ReachabilityObservation,
} from './crawl/reachabilityOutcome';

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
  /**
   * R1-C — interactive controls present in the SERVED markup.
   *
   * Recorded so that "no CTA was detected" can be told apart from "the page has no
   * interactive controls at all". A page with buttons but no CTA-phrased label is a
   * wording finding; a page with neither is a structural one. Optional so every
   * already-stored `crawl_metadata` row stays valid; absence means "not measured by
   * this crawl", never zero.
   */
  button_count?: number;
  submit_control_count?: number;
  published_time: string | null;
  /**
   * DG-010 — the page's own DECLARED last-update date, read from `article:modified_time` or JSON-LD
   * `dateModified`. Same evidence class as `published_time`: a claim the page makes about itself,
   * recovered from the SAME static parse (no extra fetch, no headless).
   *
   * Deliberately NOT sourced from:
   *   • the HTTP `Last-Modified` response header — it is emitted by the server, not declared by the
   *     page. Dynamically rendered and CDN-served pages routinely return the response time, so
   *     reading it would report "updated today" for every such site. That is a fabricated date.
   *   • sitemap `<lastmod>` — commonly auto-stamped by the CMS for every URL at build time, so it
   *     records a deploy, not a content change.
   * Both are in scope at the call site and are left unread on purpose.
   *
   * Optional so every existing constructor and already-stored `crawl_metadata` row stays valid.
   * Absence means the page declared nothing — that is `unavailable`, never a guess.
   */
  modified_time?: string | null;
  author: string | null;
  /**
   * BETA-AUTHORITY-EXEC-002 (Wave-1) — declared entity identity + credentials parsed from the already-fetched
   * JSON-LD. Evidence-only: never scored, never verified, never a recommendation. Optional/additive.
   */
  same_as?: string[];
  declared_credentials?: string[];
  /**
   * PO-3 — the legal entity name the site DECLARES for itself, read from a JSON-LD
   * `Organization.legalName` and from nowhere else.
   *
   * ─── WHY THIS IS PARSED, NOT REGEXED ──────────────────────────────────────
   * Every other field above is recovered with a document-wide regex, which is fine for a
   * publication date or a `sameAs` URL: a stray match is a weak signal among many. An identity
   * claim is different. A document-wide `"legalName"` match would happily read the legal name of
   * a partner, a parent company, a review author or an embedded widget's vendor, and Report 1
   * would then compare a Google-verified advertiser against a name belonging to somebody else.
   * So the JSON-LD blocks are PARSED and the field is read only from a node whose `@type` is
   * Organization-like. A block that does not parse yields nothing — there is no fallback regex.
   *
   * ─── WHAT IT IS, AND IS NOT ───────────────────────────────────────────────
   * `PUBLIC_OBSERVED` evidence that the site DECLARES this legal name. It is NOT an externally
   * verified legal-entity record and must never be labelled as one. Its evidentiary strength comes
   * from being a first-party declaration by whoever controls the domain, corroborated
   * independently on the advertiser side.
   *
   * Optional so every existing constructor and already-stored `crawl_metadata` row stays valid.
   * Absence means the site declared nothing — `unavailable`, never a guess.
   */
  legal_name?: string | null;
  /** PO-3 — declared `Organization.address.addressCountry`, same parse. Jurisdiction CORROBORATION only. */
  address_country?: string | null;
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
  /**
   * Every heading ELEMENT found in the served HTML.
   *
   * `textSource` is present only when the text did not come from ordinary text
   * content: `'image_alt'` / `'aria_label'` when it was recovered from the
   * accessible name, `'none'` when the element exists but carries no readable text
   * at all. A reader must use it to distinguish "no H1 element" from "an H1 that
   * says nothing" — those are different findings about the page.
   */
  headings: Array<{ level: 1 | 2 | 3; text: string; textSource?: HeadingTextSource }>;
  contentBlocks: Array<{ blockType: 'heading' | 'paragraph' | 'list' | 'cta' | 'other'; headingLevel?: number; text: string; metadata?: Record<string, unknown> }>;
  /** `source` records WHICH control was observed; absent on rows crawled before R1-C. */
  ctas: Array<{ text: string; href: string | null; source?: 'anchor' | 'button' | 'form_submit' }>;
  internalLinks: Array<{ url: string; anchorText: string }>;
  metaTags: Record<string, string>;
  signals: PageSignals;
  httpStatus: number;
  /** D2 — what the fetch actually observed. Optional so existing constructors stay valid. */
  reachability?: ReachabilityObservation;
  /**
   * R1-C — the redirect this page's fetch traversed, when the response came from a
   * different URL than the one requested. Absent means no redirect was observed.
   *
   * It carries the ENDPOINTS, not the hop chain: `safeFetch` follows and re-validates
   * each hop internally and surfaces only the final response, so the intermediate 3xx
   * statuses are not observable from here. See the note at the call site.
   */
  redirect?: { requestedUrl: string; finalUrl: string };
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

/**
 * R1-C — one matched element occurrence, WITH its position in the cleaned markup.
 *
 * Positions are not decoration: they are what lets the extractor tell a `<p>` nested
 * inside an `<li>` from a second, separate paragraph, which is the difference between
 * counting a page's copy once and counting part of it twice.
 */
type TagOccurrence = {
  readonly start: number;
  readonly end: number;
  /** The open tag verbatim, so attributes (`aria-label`, `value`) stay readable. */
  readonly open: string;
  readonly inner: string;
};

/**
 * R1-C — occurrences of ONE element, by tag name.
 *
 * ─── WHAT WAS WRONG ────────────────────────────────────────────────────────────
 * The previous pattern was `<${tagName}[^>]*>`, which matches any tag whose name
 * merely BEGINS with the name asked for, because `[^>]*` happily absorbs the rest
 * of the name. Measured on synthetic markup, not argued:
 *
 *   • asking for `li` matched `<link rel="stylesheet" href="/a.css">` in `<head>`
 *     and then ran lazily to the first REAL `</li>` in the body — so one "list
 *     item" swallowed the entire navigation. Eight words of chrome were recorded
 *     as body copy that no list on the page contains.
 *   • asking for `p` matched `<path …>` inside inline SVG and `<picture …>`, and
 *     again ran to the next `</p>`, absorbing whatever markup sat between.
 *
 * Both inflate every word count derived from `page_content`, which is what the
 * thin-content and answerable-content measurements are computed from. The error
 * runs in the direction that makes a site look better than it is.
 *
 * ─── THE FIX ───────────────────────────────────────────────────────────────────
 * `(?=[\s/>])` requires a tag-NAME boundary straight after the name, so `<li` can
 * only match `<li>`, `<li …>` or `<li/>` — never `<link`. The closing tag is
 * anchored the same way (`</p\s*>` cannot match `</path>`).
 */
function extractTagOccurrences(html: string, tagName: string): TagOccurrence[] {
  const regex = new RegExp(`(<${tagName}(?=[\\s/>])[^>]*>)([\\s\\S]*?)<\\/${tagName}\\s*>`, 'gi');
  const occurrences: TagOccurrence[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    occurrences.push({
      start: match.index,
      end: match.index + match[0].length,
      open: match[1],
      inner: match[2],
    });
  }
  return occurrences;
}

/**
 * R1-C — drop occurrences fully CONTAINED in another occurrence (outer wins).
 *
 * `<li><p>First item</p></li>` previously produced a list block "First item" AND a
 * paragraph block "First item", so the page's copy was counted twice. The outer
 * element already carries the inner element's text, so keeping the outer one keeps
 * the words exactly once. Deterministic: sorted by start, then widest first.
 */
function selectNonNested<T extends { start: number; end: number }>(items: readonly T[]): T[] {
  const sorted = [...items].sort((left, right) =>
    left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const accepted: T[] = [];
  for (const item of sorted) {
    if (accepted.some((other) => item.start >= other.start && item.end <= other.end)) continue;
    accepted.push(item);
  }
  return accepted;
}

/** Where a heading's text came from. Absent from the output when it was ordinary text. */
export type HeadingTextSource = 'image_alt' | 'aria_label' | 'none';

/**
 * R1-C — the text a heading element actually carries.
 *
 * ─── WHAT WAS WRONG ────────────────────────────────────────────────────────────
 * `extractTagContents` pushed a heading only `if (text)`. An `<h1>` whose entire
 * content is a logo image therefore produced NO heading entry at all, and every
 * reader downstream reported the page as having no H1. A page with a perfectly
 * serviceable `<h1><img alt="Acme Analytics"></h1>` was told it had no headline.
 *
 * ─── THE FIX, AND ITS LIMIT ────────────────────────────────────────────────────
 * The element's existence is recorded whether or not it strips to text, and the
 * accessible name is recovered from `img alt` / `aria-label` when there is one.
 * When there is neither, the heading is STILL recorded — with `textSource: 'none'`
 * — so a reader can distinguish "there is no H1 element" from "there is an H1
 * element that communicates nothing". Those are different findings about the site.
 *
 * What this CANNOT do is see an H1 written by JavaScript: this is a static parse.
 * That limit belongs in the evidence of whoever reads this, and it must never be
 * asserted as "the page has no H1".
 */
function headingTextFrom(inner: string): { text: string; source: HeadingTextSource | null } {
  const direct = stripTags(inner);
  if (direct) return { text: direct, source: null };
  const alt = /<img\b[^>]*\balt=["']([^"']+)["']/i.exec(inner)?.[1];
  if (alt && alt.trim()) return { text: decodeHtmlEntities(alt.trim()), source: 'image_alt' };
  const aria = /\baria-label=["']([^"']+)["']/i.exec(inner)?.[1];
  if (aria && aria.trim()) return { text: decodeHtmlEntities(aria.trim()), source: 'aria_label' };
  return { text: '', source: 'none' };
}

/** R1-C — the accessible label of an interactive control, by the same rules as a heading. */
function controlLabel(occurrence: TagOccurrence): string {
  const inner = stripTags(occurrence.inner);
  if (inner) return inner;
  const aria = /\baria-label=["']([^"']+)["']/i.exec(occurrence.open)?.[1];
  if (aria && aria.trim()) return decodeHtmlEntities(aria.trim());
  const value = /\bvalue=["']([^"']+)["']/i.exec(occurrence.open)?.[1];
  if (value && value.trim()) return decodeHtmlEntities(value.trim());
  const alt = /<img\b[^>]*\balt=["']([^"']+)["']/i.exec(occurrence.inner)?.[1];
  return alt && alt.trim() ? decodeHtmlEntities(alt.trim()) : '';
}

/**
 * R1-C — submit / button `<input>` controls, which are void elements and so have no
 * occurrence pair for `extractTagOccurrences` to find. `type="image"` is included
 * because it is a submit control; its label lives in `alt`.
 */
function extractSubmitInputs(html: string): Array<{ start: number; end: number; label: string }> {
  const regex = /<input\b[^>]*>/gi;
  const controls: Array<{ start: number; end: number; label: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) != null) {
    const tag = match[0];
    const type = /\btype=["']?([a-z]+)["']?/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (type !== 'submit' && type !== 'button' && type !== 'image') continue;
    const label = /\bvalue=["']([^"']+)["']/i.exec(tag)?.[1]
      ?? /\balt=["']([^"']+)["']/i.exec(tag)?.[1]
      ?? /\baria-label=["']([^"']+)["']/i.exec(tag)?.[1]
      ?? '';
    controls.push({
      start: match.index,
      end: match.index + tag.length,
      label: decodeHtmlEntities(label.trim()),
    });
  }
  return controls;
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

type ExtractedLink = {
  url: string;
  anchorText: string;
  isInternal: boolean;
  /** R1-C — position in the cleaned markup, so a CTA inside a paragraph is not counted twice. */
  start: number;
  end: number;
};

function extractLinks(html: string, baseUrl: string, host: string): ExtractedLink[] {
  const regex = /<a\s+([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  const links: ExtractedLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(html)) != null) {
    const href = /href=["']([^"']+)["']/i.exec(match[1])?.[1];
    const url = resolveLink(baseUrl, href);
    if (!url) continue;
    const anchorText = stripTags(match[2]);
    const isInternal = normalizeHost(url) === host;
    links.push({ url, anchorText, isInternal, start: match.index, end: match.index + match[0].length });
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
  //
  // Phase 1A FIX: this returned 'legal', which is NOT in the `canonical_pages_page_type_valid`
  // CHECK constraint (home|landing|blog|product|pricing|feature|docs|contact|other). Every site
  // with a /privacy or /terms page therefore threw on insert and ABORTED the whole crawl part-way
  // through. It was invisible because nothing on the report path ever ran a crawl; enabling the
  // report-triggered crawl exposed it immediately (omnivyra.com aborted after 11 pages).
  //
  // Returning the constraint-legal 'other' costs nothing: legal-transparency detection in
  // `publicDomainAuditService.structure.legal_pages` matches on `"${page_type} ${url}"`, so the
  // URL alone ("/privacy", "/terms") still classifies the page correctly. No consumer reads
  // `page_type === 'legal'` — production has zero such rows because none could ever be written.
  //
  // The semantically better fix is to add 'legal' to the CHECK constraint via a migration; that is
  // deliberately deferred (Phase 1A adds no migrations).
  if (/(?:^|\/)(?:privacy|terms|terms-of-service|tos|cookie|cookies|imprint|impressum|legal|legal-notice|disclosure|disclaimer)(?:[-/]|$)/.test(pathname)) return 'other';
  if (pathname.split('/').filter(Boolean).length <= 1) return 'landing';
  return 'other';
}

/** A JSON-LD `@type` that denotes an organisation. Sub-types of Organization are accepted. */
function isOrganizationType(type: unknown): boolean {
  const one = (t: unknown) => typeof t === 'string'
    && /^(?:https?:\/\/schema\.org\/)?(?:Organization|Corporation|LocalBusiness|OnlineBusiness|NGO|GovernmentOrganization|EducationalOrganization)$/i.test(t.trim());
  return Array.isArray(type) ? type.some(one) : one(type);
}

/**
 * PO-3 — the site's DECLARED organisation identity, from parsed JSON-LD only.
 *
 * Walks each block's nodes (including `@graph`) and reads `legalName` / `address.addressCountry`
 * ONLY from a node that is itself an Organization. A block that fails to parse contributes
 * nothing. Exported for the identity tests, which pin the scoping rule directly rather than
 * inferring it from crawl output.
 */
export function extractOrganizationIdentity(
  jsonLdBlocks: readonly string[],
): { legal_name: string | null; address_country: string | null } {
  let legalName: string | null = null;
  let addressCountry: string | null = null;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) visit(n); return; }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) for (const n of obj['@graph'] as unknown[]) visit(n);
    if (!isOrganizationType(obj['@type'])) return;
    // FIRST declaration wins. A later Organization node is typically a partner, parent or
    // publisher — overwriting with it would silently swap the subject's identity.
    if (legalName === null) legalName = str(obj.legalName);
    if (addressCountry === null) {
      const addr = obj.address;
      if (addr && typeof addr === 'object' && !Array.isArray(addr)) {
        addressCountry = str((addr as Record<string, unknown>).addressCountry);
      } else {
        addressCountry = str(addr) ? null : null;
      }
    }
  };

  for (const block of jsonLdBlocks) {
    let parsed: unknown;
    try { parsed = JSON.parse(String(block).trim()); } catch { continue; }
    visit(parsed);
  }
  return { legal_name: legalName, address_country: addressCountry };
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
  const ldBlocks: string[] = [];
  while ((ld = ldRegex.exec(rawHtml)) != null) {
    jsonldCount += 1;
    ldBlocks.push(ld[1]);
    for (const t of ld[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) if (!jsonldTypes.includes(t[1])) jsonldTypes.push(t[1]);
  }
  const ldDatePublished = /"datePublished"\s*:\s*"([^"]+)"/i.exec(rawHtml)?.[1] ?? null;
  // DG-010 — the declared last-update date, from the page's own JSON-LD.
  const ldDateModified = /"dateModified"\s*:\s*"([^"]+)"/i.exec(rawHtml)?.[1] ?? null;
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
    // R1-C — observable conversion controls, so a CTA absence can be reported as a
    // wording finding or a structural one rather than as one undifferentiated zero.
    button_count: count(/<button(?=[\s/>])/gi),
    submit_control_count: extractSubmitInputs(rawHtml).length,
    published_time: metaTags['article:published_time'] ?? ldDatePublished ?? /<time[^>]+datetime=["']([^"']+)["']/i.exec(rawHtml)?.[1] ?? null,
    // DG-010 — declared update date. There is deliberately NO `<time datetime>` fallback here: that
    // element carries the PUBLICATION date on virtually every template, so reusing it would silently
    // copy `published_time` into a field that claims to mean something else.
    modified_time: metaTags['article:modified_time'] ?? ldDateModified ?? null,
    author: metaTags['author'] ?? ldAuthor ?? null,
    same_as: [...new Set(sameAs)].slice(0, 25),
    declared_credentials: [...new Set(declaredCredentials)].slice(0, 25),
    // PO-3 — Organization-scoped identity. Parsed, never regexed; see the field docs.
    ...extractOrganizationIdentity(ldBlocks),
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

/**
 * R1-C — parse ONE fetched page.
 *
 * `url` is the page's IDENTITY (the row key in `canonical_pages`, the URL we asked
 * for). `baseUrl` is the document's actual base — the URL the response came from
 * after any redirect. They are separate parameters on purpose: resolving the page's
 * links against the PRE-redirect URL is how a site that redirects `example.com` to
 * `www.example.com` ended up with every one of its own links classified external
 * (`normalizeHost` does not fold `www.`), so `internal_link_count` was 0, the crawl
 * frontier was empty after one page, and the home page was then reported to the
 * customer as a dead end with no onward path. None of that was a fact about the site.
 */
function parsePage(
  html: string,
  url: string,
  depth: number,
  headers: Record<string, string> | null = null,
  baseUrl: string = url,
): CrawlPageResult {
  const cleaned = cleanHtml(html);
  const metaTags = extractMetaTags(cleaned);
  // BETA-ROADMAP-EXEC-002: recover the additional static signals from the RAW html + response headers.
  const signals = extractPageSignals(html, metaTags, headers);
  const title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)?.[1] ?? '');

  // ── Structure: every heading ELEMENT that exists, text or no text ───────────
  const headingOccurrences = [1, 2, 3].flatMap((level) =>
    extractTagOccurrences(cleaned, `h${level}`).map((occurrence) => {
      const { text, source } = headingTextFrom(occurrence.inner);
      return { ...occurrence, level: level as 1 | 2 | 3, text, textSource: source };
    }));
  const headings: CrawlPageResult['headings'] = headingOccurrences.map((heading) => ({
    level: heading.level,
    text: heading.text,
    ...(heading.textSource ? { textSource: heading.textSource } : {}),
  }));

  const host = normalizeHost(baseUrl);
  const links = extractLinks(cleaned, baseUrl, host);

  // ── Conversion pathways, from the markup that was actually served ───────────
  //
  // Previously an `<a>` and nothing else, so a `<button>` and a form's submit
  // control — the two commonest conversion controls on a modern page — were
  // invisible and CTA coverage was reported as lower than the page's own HTML
  // shows. The phrase list is UNCHANGED (what counts as CTA wording is a product
  // decision, not an engineering one); it is simply applied to every control the
  // static parse can see. JavaScript-attached handlers remain unobservable, which
  // is why the control counts below are recorded alongside.
  const buttonOccurrences = extractTagOccurrences(cleaned, 'button');
  const submitInputs = extractSubmitInputs(cleaned);
  const ctaCandidates: Array<{ text: string; href: string | null; source: 'anchor' | 'button' | 'form_submit'; start: number; end: number }> = [
    ...links.map((link) => ({ text: link.anchorText, href: link.url as string | null, source: 'anchor' as const, start: link.start, end: link.end })),
    ...buttonOccurrences.map((occurrence) => ({ text: controlLabel(occurrence), href: null, source: 'button' as const, start: occurrence.start, end: occurrence.end })),
    ...submitInputs.map((control) => ({ text: control.label, href: null, source: 'form_submit' as const, start: control.start, end: control.end })),
  ].filter((candidate) => candidate.text && CTA_PATTERNS.test(candidate.text));

  const seenCta = new Set<string>();
  const ctaMatches = ctaCandidates.filter((candidate) => {
    const key = `${candidate.source}|${candidate.text.toLowerCase()}|${candidate.href ?? ''}`;
    if (seenCta.has(key)) return false;
    seenCta.add(key);
    return true;
  });
  const ctas = ctaMatches.map((candidate) => ({ text: candidate.text, href: candidate.href, source: candidate.source }));

  // ── Copy blocks: each element counted ONCE ──────────────────────────────────
  const textBlocks = selectNonNested([
    ...headingOccurrences.map((occurrence) => ({
      start: occurrence.start, end: occurrence.end, kind: 'heading' as const,
      text: occurrence.text, level: occurrence.level,
    })),
    ...extractTagOccurrences(cleaned, 'p').map((occurrence) => ({
      start: occurrence.start, end: occurrence.end, kind: 'paragraph' as const,
      text: stripTags(occurrence.inner), level: undefined as 1 | 2 | 3 | undefined,
    })),
    ...extractTagOccurrences(cleaned, 'li').map((occurrence) => ({
      start: occurrence.start, end: occurrence.end, kind: 'list' as const,
      text: stripTags(occurrence.inner), level: undefined as 1 | 2 | 3 | undefined,
    })),
  ]).filter((block) => block.text.length > 0);

  const contentBlocks: CrawlPageResult['contentBlocks'] = [];
  for (const kind of ['heading', 'paragraph', 'list'] as const) {
    for (const block of textBlocks.filter((candidate) => candidate.kind === kind)) {
      contentBlocks.push({
        blockType: kind,
        ...(kind === 'heading' ? { headingLevel: block.level } : {}),
        text: block.text,
      });
    }
  }
  // A CTA sitting INSIDE a paragraph or list item already has its words in that
  // block. Emitting it again as its own block counted the same words twice — the
  // `ctas` column above is what records the CTA itself, so detection is unaffected.
  for (const cta of ctaMatches) {
    const alreadyCounted = textBlocks.some((block) => cta.start >= block.start && cta.end <= block.end);
    if (alreadyCounted) continue;
    contentBlocks.push({
      blockType: 'cta',
      text: cta.text,
      metadata: { href: cta.href, source: cta.source },
    });
  }

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

/**
 * D2 — the observed result of one page fetch.
 *
 * `html` is present only when the page answered with a readable 2xx/3xx body;
 * every other outcome carries the observation instead. The old contract THREW
 * on 4xx/5xx, which is why the status never reached the database: the crawl
 * loop's catch could only record that "something failed".
 */
type FetchHtmlResult =
  | {
      readonly ok: true;
      readonly html: string;
      readonly status: number;
      readonly headers: Record<string, string>;
      readonly reachability: ReachabilityObservation;
      /**
       * R1-C — the URL the response actually came from.
       *
       * `safeFetch` follows redirects itself (re-validating every hop), so the status
       * we see is the FINAL one and the intermediate 3xx codes never reach this
       * function. What IS observable is the endpoint: when `finalUrl` differs from the
       * requested URL, a redirect was traversed. That is recorded, and — more
       * importantly — it is the correct base for resolving the document's own links.
       */
      readonly finalUrl: string;
    }
  | { readonly ok: false; readonly reachability: ReachabilityObservation };

async function fetchHtml(url: string, timeoutMs: number): Promise<FetchHtmlResult> {
  // HARDEN-005: crawl target is user-controlled — SSRF-safe fetch (validated
  // host, DNS-pinned, each redirect hop re-validated up to the cap, 10MB cap).
  const { safeFetch, readCapped } = await import('../../lib/security/safeFetch');
  let response: Awaited<ReturnType<typeof safeFetch>>;
  try {
    response = await safeFetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'OmnivyraBot/1.0 (+https://omnivyra.com)',
        Accept: 'text/html,application/xhtml+xml',
      },
    }, { timeoutMs, maxRedirects: 5, maxBytes: 10 * 1024 * 1024 });
  } catch (error) {
    // No HTTP response existed. DNS failure, connection refusal, an SSRF
    // refusal or a timeout — distinguished here, because "we never got an
    // answer" is a different finding from "the page answered 404".
    return { ok: false, reachability: classifyFetchError(error) };
  }

  const reachability = observationFromStatus(response.status);

  // D2 — the page ANSWERED with an error. Previously this threw, and the status
  // was replaced downstream by the 0 sentinel, so `broken_links` could never
  // see it. The body is not read (an error page's HTML is not site content),
  // but the observation is preserved and is what the check now counts.
  if (isHttpErrorOutcome(reachability.outcome)) {
    return { ok: false, reachability };
  }

  // Retain the HTTP response headers so security / compression / caching
  // metadata can be recovered without any extra request.
  const headers: Record<string, string> = {};
  response.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  const html = (await readCapped(response)).toString('utf8');
  // R1-C — `response.url` is the URL of the hop that actually answered. Guarded
  // rather than assumed: a non-undici response shape (every unit-test double) has
  // no `url`, and defaulting to the requested URL is the pre-R1-C behaviour.
  const responseUrl = (response as { url?: unknown }).url;
  const finalUrl = typeof responseUrl === 'string' && responseUrl ? responseUrl : url;
  return { ok: true, html, status: response.status, headers, reachability, finalUrl };
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
          // D2 — the observed reachability of THIS page. Written for successful
          // fetches too, so every crawled row carries the same evidence shape.
          ...(page.reachability ? { reachability: page.reachability } : {}),
          // R1-C — the redirect this fetch traversed, when there was one. Additive key
          // on the existing JSONB column; absent means no redirect was observed, which
          // is NOT the same as "no redirect exists" for the hops safeFetch collapses.
          ...(page.redirect ? { redirect: page.redirect } : {}),
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

  // CKRE-001 §1 — crawl-started boundary event (fire-and-forget).
  void resolveCrawlCorrelationId(null, input.companyId).then((correlationId) =>
    emitCrawlEvent({
      event: 'CrawlStarted', outcome: 'allowed', correlationId,
      companyId: input.companyId, workflow: 'website_intelligence', target: rootUrl,
    }),
  );

  const maxPages = Math.max(1, Math.min(input.maxPages ?? 250, 1000));
  const timeoutMs = Math.max(2000, input.timeoutMs ?? 10000);
  /**
   * R1-C — the host the crawl treats as "this site".
   *
   * MUTABLE on purpose. It starts as the configured root's host and is re-pointed
   * once, if the ROOT page's response came from somewhere else. `normalizeHost` does
   * not fold `www.`, so for the very common `example.com → www.example.com` redirect
   * the old fixed value classified every one of the site's own absolute links as
   * external: `internal_link_count` was 0, the crawl frontier was empty after one
   * page, and the report then told the customer their home page was a dead end with
   * no onward path. The redirect is recorded as evidence either way.
   */
  let rootHost = normalizeHost(rootUrl);
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

    let fetched: FetchHtmlResult;
    try {
      fetched = await fetchHtml(current.url, timeoutMs);
    } catch (error) {
      // Defensive only: fetchHtml classifies its own failures. Anything reaching
      // here is a bug in this function, not a network condition — record it as a
      // transport failure rather than losing the page entirely.
      fetched = { ok: false, reachability: classifyFetchError(error) };
    }

    if (!fetched.ok) {
      const { reachability } = fetched;
      await ownedDbTable('canonical_pages')
        .upsert(
          {
            company_id: input.companyId,
            domain_id: domain.id,
            url: current.url,
            page_type: inferPageType(current.url),
            // D2 — the REAL status when the page answered (404, 500, …). The 0
            // sentinel is used only when no HTTP response existed at all. It
            // used to be written for both, which is what made "0 pages returned
            // 4xx/5xx" true on every site regardless of the site.
            http_status: reachability.status ?? NO_HTTP_RESPONSE_STATUS,
            crawl_depth: current.depth,
            last_crawled_at: new Date().toISOString(),
            crawl_metadata: {
              // Retained for backward compatibility — existing readers of this
              // free-text field keep working unchanged.
              fetch_error: reachability.reason ?? 'Fetch failed.',
              // D2 — the structured observation. Existing JSONB column, so no
              // migration; this is what lets a reader tell a 404 from a DNS
              // failure, which the free text above never reliably could.
              reachability,
            },
          },
          { onConflict: 'company_id,url' }
        );
      continue;
    }

    // R1-C — the document's own base is the URL the response came from, so the page's
    // links resolve and are classified internal/external against the right host.
    let documentBase = current.url;
    try { documentBase = normalizeUrl(fetched.finalUrl); } catch { documentBase = current.url; }
    const redirected = documentBase !== current.url;
    // The ROOT page's redirect re-points the whole crawl: a site reached at
    // `example.com` but served from `www.example.com` is one site, not two.
    if (current.depth === 0 && redirected) rootHost = normalizeHost(documentBase);
    // The redirect destination has now been read, so queueing it again would store the
    // same document twice under two URLs and count it twice in every denominator.
    if (redirected) visited.add(documentBase);

    const parsed = parsePage(fetched.html, current.url, current.depth, fetched.headers, documentBase);
    parsed.httpStatus = fetched.status;
    parsed.reachability = fetched.reachability;
    if (redirected) parsed.redirect = { requestedUrl: current.url, finalUrl: documentBase };
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

  // CKRE-001 §1 — crawl-completed boundary event (fire-and-forget).
  void resolveCrawlCorrelationId(null, input.companyId).then((correlationId) =>
    emitCrawlEvent({
      event: 'CrawlCompleted', outcome: 'allowed', correlationId,
      companyId: input.companyId, workflow: 'website_intelligence', target: rootUrl,
      metadata: { pagesProcessed, pagesInserted },
    }),
  );

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
