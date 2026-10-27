/**
 * Static public marketing pages listed in /sitemap.xml (pages/sitemap.xml.ts). Also the allowlist for
 * IndexNow notifications (backend/services/indexNow): a path not listed here is never announced.
 */
export const SITEMAP_PATHS: readonly string[] = [
  '',
  '/landing',
  '/about',
  '/pricing',
  '/marketing-performance-analytics',
  '/funnel-and-conversion-analysis',
];
