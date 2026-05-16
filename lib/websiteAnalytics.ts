export const WEBSITE_GA_HOSTNAME = 'www.omnivyra.com';
export const WEBSITE_GA_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || '';

const ENABLE_PREVIEW_ANALYTICS =
  process.env.NEXT_PUBLIC_ENABLE_GA_PREVIEW === 'true' ||
  process.env.NEXT_PUBLIC_ANALYTICS_PREVIEW_ENABLED === 'true';

const MAX_QUEUED_EVENTS = 20;

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
  '/marketing-performance-analytics',
  '/funnel-and-conversion-analysis',
  '/reports/performance-intelligence',
  '/integrations',
  '/super-admin',
]);

const WEBSITE_ROUTE_PREFIXES = ['/blog/', '/reports/', '/super-admin/'];

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag?: (...args: unknown[]) => void;
    __omnivyraGaReady?: boolean;
    __omnivyraGaQueue?: Array<{
      name: WebsiteEventName;
      params: Record<string, string | number | boolean>;
    }>;
    __omnivyraLastPageView?: string;
  }
}

export type WebsiteEventName =
  | 'lead_created'
  | 'signup_completed'
  | 'cta_click'
  | 'report_generation_started'
  | 'analytics_connection_started'
  | 'analytics_refresh_started';

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
  if (typeof window === 'undefined') return false;
  if (process.env.NODE_ENV !== 'production' && ENABLE_PREVIEW_ANALYTICS) return true;
  return window.location.hostname === WEBSITE_GA_HOSTNAME;
}

export function canTrackWebsiteAnalytics(path: string): boolean {
  return isWebsiteAnalyticsEnabled() && isWebsiteAnalyticsHost() && isWebsiteAnalyticsRoute(path);
}

export function isWebsiteAnalyticsEnabled(): boolean {
  if (!WEBSITE_GA_MEASUREMENT_ID || !/^G-[A-Z0-9]+$/i.test(WEBSITE_GA_MEASUREMENT_ID)) return false;
  return process.env.NODE_ENV === 'production' || ENABLE_PREVIEW_ANALYTICS;
}

export function hasWebsiteAnalyticsConsent(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const consent = window.localStorage?.getItem('omnivyra_analytics_consent');
    return consent !== 'denied';
  } catch {
    return true;
  }
}

function debugAnalyticsWarning(message: string, details?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  console.warn('[websiteAnalytics]', message, details ?? {});
}

function cleanParams(params: Record<string, string | number | boolean | null | undefined>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null),
  ) as Record<string, string | number | boolean>;
}

export function flushQueuedWebsiteEvents(): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const queued = window.__omnivyraGaQueue ?? [];
  window.__omnivyraGaQueue = [];
  queued.forEach((event) => {
    try {
      window.gtag?.('event', event.name, event.params);
    } catch (error) {
      debugAnalyticsWarning('Queued GA event dispatch failed', {
        event: event.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export function trackWebsitePageView(path: string, title?: string): void {
  try {
    if (typeof window === 'undefined') return;
    if (!canTrackWebsiteAnalytics(path) || !hasWebsiteAnalyticsConsent()) return;
    if (typeof window.gtag !== 'function') {
      debugAnalyticsWarning('GA page view skipped because gtag is unavailable', { path });
      return;
    }

    const normalized = normalizeAnalyticsPath(path);
    const pageLocation = `${window.location.origin}${path}`;
    const dedupeKey = `${WEBSITE_GA_MEASUREMENT_ID}|${pageLocation}`;
    if (window.__omnivyraLastPageView === dedupeKey) return;
    window.__omnivyraLastPageView = dedupeKey;

    window.gtag('config', WEBSITE_GA_MEASUREMENT_ID, {
      page_path: normalized,
      page_title: title || document.title,
      page_location: pageLocation,
    });
  } catch (error) {
    debugAnalyticsWarning('GA page view dispatch failed', {
      path,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function trackWebsiteEvent(
  name: WebsiteEventName,
  params: Record<string, string | number | boolean | null | undefined> = {},
): void {
  try {
    if (typeof window === 'undefined') return;
    if (!canTrackWebsiteAnalytics(window.location.pathname) || !hasWebsiteAnalyticsConsent()) return;

    const cleanedParams = cleanParams(params);
    if (typeof window.gtag !== 'function' || !window.__omnivyraGaReady) {
      window.__omnivyraGaQueue = window.__omnivyraGaQueue ?? [];
      if (window.__omnivyraGaQueue.length < MAX_QUEUED_EVENTS) {
        window.__omnivyraGaQueue.push({ name, params: cleanedParams });
      } else {
        debugAnalyticsWarning('GA event queue full; dropping event', { event: name });
      }
      return;
    }

    window.gtag('event', name, cleanedParams);
  } catch (error) {
    debugAnalyticsWarning('GA event dispatch failed', {
      event: name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
