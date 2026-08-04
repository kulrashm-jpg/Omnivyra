/**
 * Canonical absolute site origin — the single source for SEO metadata
 * (`<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`).
 *
 * WHY THIS EXISTS
 * ───────────────
 * The pattern this replaces was:
 *
 *   const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';
 *
 * which is wrong twice over:
 *
 *   1. **Broken canonical in prerendered HTML.** During SSR / static
 *      prerender `window` is undefined, so the emitted markup contained
 *      `<link rel="canonical" href="/blog">` — a relative, non-canonical URL.
 *      Crawlers read the prerendered HTML, so this is what they saw.
 *   2. **Hydration mismatch.** The server rendered one value ('') and the
 *      first client render produced another (the real origin), so React
 *      reconciled differing markup on every page load.
 *
 * `NEXT_PUBLIC_*` variables are inlined by webpack at build time, so this
 * constant is a literal in both the server and client bundles and therefore
 * resolves identically in both — deterministic by construction.
 *
 * The default mirrors `config/env.schema.ts` (`NEXT_PUBLIC_APP_URL`).
 *
 * Note: this is deliberately NOT derived from the request host. Canonical URLs
 * must point at the single canonical origin regardless of which host served
 * the response, otherwise preview/alias domains self-canonicalize and compete
 * with production in search results.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.omnivyra.com';

/** Absolute URL for a site-relative path. Accepts paths with or without a leading slash. */
export function absoluteUrl(path: string): string {
  if (!path) return SITE_URL;
  if (/^https?:\/\//i.test(path)) return path;
  return `${SITE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
