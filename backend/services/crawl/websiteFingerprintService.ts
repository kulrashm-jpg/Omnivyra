/**
 * websiteFingerprintService.ts — deterministic website fingerprints (CKRE-001 §3/§4).
 *
 * PURE. No network, no AI, no semantic analysis. Given HTML + response headers
 * + the already-extracted DiscoveredWebsiteMetadata (ONBOARD-001), it produces
 * a hierarchical fingerprint bundle used by the deterministic change detector.
 *
 * Reuses ONBOARD-001's extractWebsiteMetadata output for Level 2 rather than
 * re-parsing — no duplicate extraction. Fingerprints are hashes of normalized
 * values; identical inputs always yield identical hashes (determinism).
 *
 * Hierarchy (audit-specified):
 *   Level 0 — HTTP metadata: etag, last-modified, content-length
 *   Level 1 — structural: html, navigation, favicon, logo, openGraph,
 *             sitemap, robots
 *   Level 2 — business: company name, products, services, primary CTA,
 *             contact, social links, brand colours, structured data
 *
 * Every bundle carries { algorithm, source, version, computedAt } (§4); every
 * level entry is a hash (or null when the signal is absent).
 */

import { createHash } from 'crypto';
import type { DiscoveredWebsiteMetadata } from '../companyProfile/websiteMetadataExtractor';

export const WEBSITE_FINGERPRINT_VERSION = 'ckre-fp-v1';
export const WEBSITE_FINGERPRINT_ALGORITHM = 'sha256';
export const WEBSITE_FINGERPRINT_SOURCE = 'website_crawl';

function sha(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
const norm = (v: string | null | undefined): string => String(v ?? '').replace(/\s+/g, ' ').trim();
function hashOf(v: string | null | undefined): string | null {
  const s = norm(v);
  return s ? sha(s) : null;
}
function hashList(items: Array<string | null | undefined>): string | null {
  const cleaned = Array.from(new Set(items.map((i) => norm(i)).filter(Boolean))).sort();
  return cleaned.length ? sha(cleaned.join('\n')) : null;
}

export interface Level0Fingerprint {
  etag: string | null;
  lastModified: string | null;
  contentLength: string | null;
}
export interface Level1Fingerprint {
  htmlHash: string | null;
  navHash: string | null;
  faviconHash: string | null;
  logoHash: string | null;
  ogHash: string | null;
  sitemapHash: string | null;
  robotsHash: string | null;
}
export interface Level2Fingerprint {
  companyName: string | null;
  products: string | null;
  services: string | null;
  primaryCta: string | null;
  contact: string | null;
  socialLinks: string | null;
  brandColors: string | null;
  structuredData: string | null;
}

export interface WebsiteFingerprint {
  version: string;
  algorithm: string;
  source: string;
  computedAt: string;
  url: string;
  level0: Level0Fingerprint;
  level1: Level1Fingerprint;
  level2: Level2Fingerprint;
}

export interface FingerprintInput {
  url: string;
  html: string;
  headers?: { etag?: string | null; lastModified?: string | null; contentLength?: string | null };
  metadata?: DiscoveredWebsiteMetadata | null;
  /** Flattened social links (values across platforms). */
  socialLinks?: string[];
  /** Optional — supplied only by crawlers that fetch them (crawlerService). */
  sitemapXml?: string | null;
  robotsTxt?: string | null;
}

// ── Level 1 helpers (pure HTML derivations, no extraction dependency) ─────────

/** Structural HTML: strip <script>/<style> + collapse whitespace so dynamic
 *  tokens (nonces, cache-busters) don't cause false-positive changes. */
function structuralHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Navigation fingerprint: sorted unique href targets (the site's link graph shape). */
function navSignature(html: string): string[] {
  const hrefs: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].trim();
    if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

/** Structured-data fingerprint: the set of JSON-LD @type values on the page. */
function structuredDataTypes(html: string): string[] {
  const types: string[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const typeRe = /"@type"\s*:\s*"([^"]+)"/g;
    let t: RegExpExecArray | null;
    while ((t = typeRe.exec(m[1]))) types.push(t[1]);
  }
  return types;
}

/** Primary CTA: first CTA-like anchor/button text. Deterministic regex, best-effort. */
function primaryCtaText(html: string): string | null {
  const re = /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi;
  const ctaWords = /\b(get started|sign up|start free|book a demo|request a demo|contact us|buy now|subscribe|try (?:it )?free|get a quote|learn more|schedule)\b/i;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && ctaWords.test(text)) return text;
  }
  return null;
}

/** Contact signal: presence of mailto:/tel: or a /contact link. */
function contactSignature(html: string): string | null {
  const mail = html.match(/mailto:[^"'\s>]+/i)?.[0] ?? null;
  const tel = html.match(/tel:[^"'\s>]+/i)?.[0] ?? null;
  const contactLink = /href\s*=\s*["'][^"']*\/contact[^"']*["']/i.test(html) ? 'has_contact_page' : null;
  const parts = [mail, tel, contactLink].filter(Boolean);
  return parts.length ? parts.join('|') : null;
}

/**
 * Compute the full fingerprint bundle. Pure except for the `computedAt`
 * timestamp (metadata only — never part of any hash), which may be injected
 * for deterministic tests.
 */
export function computeWebsiteFingerprint(input: FingerprintInput, computedAt: string = new Date().toISOString()): WebsiteFingerprint {
  const html = input.html ?? '';
  const meta = input.metadata ?? null;

  const level0: Level0Fingerprint = {
    etag: norm(input.headers?.etag) || null,
    lastModified: norm(input.headers?.lastModified) || null,
    contentLength: norm(input.headers?.contentLength) || null,
  };

  const level1: Level1Fingerprint = {
    htmlHash: html ? sha(structuralHtml(html)) : null,
    navHash: hashList(navSignature(html)),
    faviconHash: hashOf(meta?.faviconUrl),
    logoHash: hashOf(meta?.logoUrl),
    ogHash: meta && meta.openGraph && Object.keys(meta.openGraph).length
      ? hashList(Object.entries(meta.openGraph).map(([k, v]) => `${k}=${v}`))
      : null,
    sitemapHash: input.sitemapXml ? sha(structuralHtml(input.sitemapXml)) : null,
    robotsHash: input.robotsTxt ? hashOf(input.robotsTxt) : null,
  };

  const sdTypes = structuredDataTypes(html);
  const level2: Level2Fingerprint = {
    companyName: hashOf(meta?.siteName || meta?.title),
    // products/services are derived only from structured data (deterministic);
    // null when the page carries no such markup.
    products: sdTypes.some((t) => /product|offer/i.test(t)) ? hashList(sdTypes.filter((t) => /product|offer/i.test(t))) : null,
    services: sdTypes.some((t) => /service/i.test(t)) ? hashList(sdTypes.filter((t) => /service/i.test(t))) : null,
    primaryCta: hashOf(primaryCtaText(html)),
    contact: hashOf(contactSignature(html)),
    socialLinks: hashList(input.socialLinks ?? []),
    brandColors: hashOf(meta?.brandColor),
    structuredData: hashList(sdTypes),
  };

  return {
    version: WEBSITE_FINGERPRINT_VERSION,
    algorithm: WEBSITE_FINGERPRINT_ALGORITHM,
    source: WEBSITE_FINGERPRINT_SOURCE,
    computedAt,
    url: input.url,
    level0,
    level1,
    level2,
  };
}

/** True when the bundle carries at least one usable signal (worth persisting). */
export function hasFingerprintSignal(fp: WebsiteFingerprint): boolean {
  return Boolean(
    fp.level1.htmlHash ||
    Object.values(fp.level2).some(Boolean) ||
    fp.level0.etag || fp.level0.lastModified,
  );
}
