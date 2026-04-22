export const WEBSITE_GA_MEASUREMENT_ID = 'G-LZVBC8FEHP';
export const WEBSITE_GA_HOSTNAME = 'www.omnivyra.com';

const WEBSITE_ROUTE_EXACT_MATCHES = new Set([
  '/',
  '/pricing',
  '/about',
  '/blog',
  '/solutions',
  '/features',
  '/privacy',
  '/terms',
  '/data-deletion',
  '/get-free-credits',
  '/create-account',
  '/free-audit/start',
  '/free-audit/report',
  '/audit/website-growth-check',
  '/audit/lead-generation-check',
  '/audit/campaign-conversion-check',
]);

const WEBSITE_ROUTE_PREFIXES = ['/blog/'];

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function normalizeAnalyticsPath(path: string): string {
  if (!path) return '/';
  const [withoutHash] = path.split('#');
  const [withoutQuery] = withoutHash.split('?');
  return withoutQuery || '/';
}

export function isWebsiteAnalyticsRoute(path: string): boolean {
  const normalized = normalizeAnalyticsPath(path);
  return (
    WEBSITE_ROUTE_EXACT_MATCHES.has(normalized) ||
    WEBSITE_ROUTE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function isWebsiteAnalyticsHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === WEBSITE_GA_HOSTNAME;
}

export function canTrackWebsiteAnalytics(path: string): boolean {
  return isWebsiteAnalyticsHost() && isWebsiteAnalyticsRoute(path);
}

export function trackWebsitePageView(url: string): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const pagePath = url || window.location.pathname;

  window.gtag('config', WEBSITE_GA_MEASUREMENT_ID, {
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
  });
}

export function trackWebsiteEvent(
  name: 'lead_created' | 'signup_completed' | 'cta_click',
  params: Record<string, string | number | boolean | null | undefined> = {},
): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  if (!canTrackWebsiteAnalytics(window.location.pathname)) return;

  const cleanedParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  );

  window.gtag('event', name, cleanedParams);
}
