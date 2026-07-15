import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import Script from 'next/script';
import { CompanyProvider } from '../components/CompanyContext';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import dynamic from 'next/dynamic';
import { TourProvider } from '../components/tour/TourContext';
import { AuthErrorBanner } from '../components/auth/AuthErrorBanner';

// PERF: the route shells are conditionally RENDERED but were statically IMPORTED, so
// every page shipped all of them in the shared bundle (~1MB raw JS parsed per load).
// next/dynamic splits them into on-demand chunks: marketing visitors don't parse the
// app chrome (header/footer/command palette/retention), app users don't parse the
// landing navbar, and production never fetches the dev panel. SSR stays ON for the
// layouts so prerendered HTML is unchanged (no flash) — only the JS loads on demand.
const LandingNavbar = dynamic(() => import('../components/landing/LandingNavbar'));
const AppLayout = dynamic(() => import('../components/layout/AppLayout'));
const AuthDevPanel = dynamic(
  () => import('../components/auth/AuthDevPanel').then((m) => m.AuthDevPanel),
  { ssr: false }, // dev-only diagnostics — chunk is never requested in production
);
import PageLoader from '../components/PageLoader';
// W5-4 (audit B-38): fonts move from a render-blocking Google Fonts CSS
// @import (globals.css) to next/font — build-time self-hosted, subsetted,
// preloaded, display:swap. SAME families and weights as the removed @import;
// consumers reference the CSS variables exposed below (landing/about inline
// styles migrated in this wave). Kills the fonts.googleapis.com round-trip
// on first paint of every page.
import { Inter, Poppins } from 'next/font/google';
import { initClientPerf, markRouteChange } from '../lib/observability/clientPerf';

const interFont = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-inter',
});
const poppinsFont = Poppins({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  display: 'swap',
  variable: '--font-poppins',
});
import {
  WEBSITE_GA_MEASUREMENT_ID,
  flushQueuedWebsiteEvents,
  isWebsiteAnalyticsEnabled,
  hasWebsiteAnalyticsConsent,
  trackWebsiteEvent,
  trackWebsitePageView,
} from '../lib/websiteAnalytics';

// NOTE: clearSupabaseSession() was removed here.  It wiped sb-* localStorage
// keys (including PKCE code-verifiers) on every page load, which broke magic-
// link / password-reset flows and prevented sessions from persisting across
// refreshes.  The Firebase→Supabase migration it was originally added for is
// long complete.

// Public lead-capture entry points (Phase 8) — registered as public so they render
// the marketing navbar and bypass the auth gate.
const LEAD_CAPTURE_PUBLIC_ROUTES = ['/request-demo', '/contact-sales', '/book-consultation', '/talk-to-expert', '/thank-you'];

const LANDING_PUBLIC_ROUTES = ['/', '/landing', '/pricing', '/about', '/blog', '/solutions', '/features', '/privacy', '/terms', '/data-deletion', '/marketing-performance-analytics', '/funnel-and-conversion-analysis', '/audit/website-growth-check', '/audit/lead-generation-check', '/audit/campaign-conversion-check', '/free-audit/start', '/free-audit/report', ...LEAD_CAPTURE_PUBLIC_ROUTES];

const WebsiteAnalytics: React.FC = () => {
  const router = useRouter();
  const analyticsEnabled = isWebsiteAnalyticsEnabled();

  useEffect(() => {
    if (!analyticsEnabled || !router.isReady) return;
    trackWebsitePageView(router.asPath, document.title);

    const handleRouteChange = (url: string) => {
      window.setTimeout(() => trackWebsitePageView(url, document.title), 150);
    };

    router.events.on('routeChangeComplete', handleRouteChange);
    return () => {
      router.events.off('routeChangeComplete', handleRouteChange);
    };
  }, [analyticsEnabled, router.asPath, router.events, router.isReady]);

  useEffect(() => {
    if (!analyticsEnabled) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-ga-primary-cta]')
        : null;
      if (!target) return;
      trackWebsiteEvent('cta_click', {
        cta_label: target.dataset.gaLabel || target.textContent?.trim().slice(0, 80) || 'primary_cta',
        cta_location: target.dataset.gaLocation || window.location.pathname,
      });
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [analyticsEnabled]);

  if (!analyticsEnabled || !hasWebsiteAnalyticsConsent()) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${WEBSITE_GA_MEASUREMENT_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive" onReady={flushQueuedWebsiteEvents}>
        {`
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', '${WEBSITE_GA_MEASUREMENT_ID}', {
    send_page_view: false
  });
  window.__omnivyraGaReady = true;
        `}
      </Script>
    </>
  );
};

// HARDEN-001A: client performance bridge. Initializes the (env-gated, fail-safe)
// browser perf collector once and reports route-transition durations into it.
// Renders nothing and never affects interaction.
const ClientPerfBridge: React.FC = () => {
  const router = useRouter();
  useEffect(() => { initClientPerf(); }, []);
  useEffect(() => {
    let startedAt = 0;
    const start = () => { startedAt = performance.now(); };
    const done = () => { if (startedAt) { markRouteChange(performance.now() - startedAt); startedAt = 0; } };
    router.events.on('routeChangeStart', start);
    router.events.on('routeChangeComplete', done);
    router.events.on('routeChangeError', done);
    return () => {
      router.events.off('routeChangeStart', start);
      router.events.off('routeChangeComplete', done);
      router.events.off('routeChangeError', done);
    };
  }, [router.events]);
  return null;
};

const RouteProgressBar: React.FC = () => {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimers = () => {
      if (progressTimer) clearInterval(progressTimer);
      if (hideTimer) clearTimeout(hideTimer);
      progressTimer = null;
      hideTimer = null;
    };

    const start = () => {
      clearTimers();
      setVisible(true);
      setProgress(16);

      progressTimer = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 88) return prev;
          const step = prev < 40 ? 10 : prev < 70 ? 6 : 3;
          return Math.min(88, prev + step);
        });
      }, 180);
    };

    const finish = () => {
      clearTimers();
      setProgress(100);
      hideTimer = setTimeout(() => {
        setVisible(false);
        setProgress(0);
      }, 220);
    };

    router.events.on('routeChangeStart', start);
    router.events.on('routeChangeComplete', finish);
    router.events.on('routeChangeError', finish);

    return () => {
      clearTimers();
      router.events.off('routeChangeStart', start);
      router.events.off('routeChangeComplete', finish);
      router.events.off('routeChangeError', finish);
    };
  }, [router.events]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed left-0 right-0 top-0 z-[100] transition-opacity duration-200 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="h-1 bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 shadow-[0_0_18px_rgba(14,165,233,0.35)] transition-[width] duration-200 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
};

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { isAuthenticated, authChecked } = useCompanyContext();
  const [mounted, setMounted] = useState(false);
  const [authWaitExpired, setAuthWaitExpired] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const publicRoutes = ['/login', '/super-admin/login', '/', '/landing', '/pricing', '/about', '/blog', '/solutions', '/features', '/privacy', '/terms', '/data-deletion', '/marketing-performance-analytics', '/funnel-and-conversion-analysis', '/get-free-credits', '/create-account', '/auth/callback', '/auth/verify', '/auth/set-password', '/auth/accept-invite', ...LEAD_CAPTURE_PUBLIC_ROUTES];
  const isBlogRoute = router.pathname === '/blog' || router.pathname.startsWith('/blog/');
  const isAdminBlogRoute = router.pathname === '/admin/blog' || router.pathname.startsWith('/admin/blog/');
  const isSuperAdminRoute = router.pathname.startsWith('/super-admin');
  const isPlatformExternalApis =
    router.pathname === '/external-apis' && router.asPath.includes('mode=platform');
  const isCompanyProfile = router.pathname === '/company-profile';
  const isContentArchitectHub = router.pathname === '/content-architect';
  const isRecommendationsPage = router.pathname === '/recommendations';
  const isCampaignOrPlanRoute =
    router.pathname.startsWith('/campaigns') || router.pathname.startsWith('/campaign-daily-plan');
  const isAuditRoute = router.pathname.startsWith('/audit') || router.pathname.startsWith('/free-audit');
  const isPublic =
    publicRoutes.includes(router.pathname) ||
    isBlogRoute ||
    isAuditRoute ||
    isAdminBlogRoute ||
    isSuperAdminRoute ||
    isPlatformExternalApis ||
    isCompanyProfile ||
    isContentArchitectHub ||
    isRecommendationsPage ||
    isCampaignOrPlanRoute;

  const showLandingNavbar = LANDING_PUBLIC_ROUTES.includes(router.pathname) || isBlogRoute || isAuditRoute;

  // After auth settles: redirect unauthenticated users away from protected routes.
  // Must be a useEffect — calling router.replace() synchronously during render causes
  // Next.js to attempt a hard navigation while a soft navigation is in flight, which
  // triggers "Invariant: attempted to hard navigate to the same URL".
  useEffect(() => {
    if (!mounted) return;
    if (!isPublic && (authChecked || authWaitExpired) && !isAuthenticated) {
      router.replace('/login');
    }
  }, [mounted, isPublic, authChecked, authWaitExpired, isAuthenticated, router]);

  useEffect(() => {
    if (isPublic || authChecked || isAuthenticated) {
      setAuthWaitExpired(false);
      return;
    }
    const timer = window.setTimeout(() => setAuthWaitExpired(true), 4000);
    return () => window.clearTimeout(timer);
  }, [isPublic, authChecked, isAuthenticated, router.pathname]);

  // Protected routes: hold the render until the backend probe has resolved.
  // This prevents a flash of protected content before we know the user's auth state,
  // and prevents a premature redirect to /login before we know the user is NOT authenticated.
  if (!isPublic && (!mounted || (!authChecked && !authWaitExpired))) {
    return <PageLoader message="Loading your workspace…" />;
  }

  // While authChecked but unauthenticated, render nothing (useEffect above handles redirect).
  if (!isPublic && (authChecked || authWaitExpired) && !isAuthenticated) {
    return null;
  }

  // Onboarding pages that should NOT get the app header (they have their own layout)
  const isOnboardingRoute = router.pathname.startsWith('/onboarding');
  const isLoginRoute = router.pathname === '/login' || router.pathname === '/create-account';
  const isCaptureRoute = router.pathname.startsWith('/capture');
  // The campaigns LIST page is auth-bypassed (via isCampaignOrPlanRoute) for
  // resilience, but it IS a workspace page and should still get the app header.
  // Keep its auth treatment unchanged; only opt it back into the layout.
  const isCampaignsListRoute = router.pathname === '/campaigns';
  // Same story for company-profile — auth-bypassed for resilience (isPublic), but it is an
  // in-app page that should carry the shared header. Opt it back into the layout while
  // leaving its auth treatment unchanged.
  const isWorkspaceHeaderRoute = isCampaignsListRoute || isCompanyProfile;
  // Authenticated routes get AppLayout (header + footer)
  const showAppLayout = isAuthenticated && !isOnboardingRoute && !isLoginRoute && !isCaptureRoute && (!isPublic || isWorkspaceHeaderRoute);

  // AuthErrorBanner renders any non-session-fatal auth error from
  // CompanyContext (USER_INVITED, USER_NOT_FOUND, SCHEMA_MISMATCH,
  // PROFILE_LOAD_FAILED). Only shown on protected routes to avoid
  // showing it on /login (where a fresh sign-in clears the state anyway).
  const showAuthErrorBanner = !isPublic;

  return (
    <>
      {showLandingNavbar && <LandingNavbar />}
      {showAuthErrorBanner && <AuthErrorBanner />}
      {showAppLayout ? (
        <AppLayout>{children}</AppLayout>
      ) : (
        children
      )}
    </>
  );
};

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <CompanyProvider>
      <TourProvider>
        {/* W5-4: expose the self-hosted families as CSS variables globally.
            styled-jsx global — no wrapper element, no cascade change. */}
        <style jsx global>{`
          :root {
            --font-inter: ${interFont.style.fontFamily};
            --font-poppins: ${poppinsFont.style.fontFamily};
          }
        `}</style>
        <Head>
          <link rel="icon" href="/favicon.jpg" />
          {isWebsiteAnalyticsEnabled() && (
            <meta name="google-analytics-measurement-id" content={WEBSITE_GA_MEASUREMENT_ID} />
          )}
        </Head>
        <WebsiteAnalytics />
        <ClientPerfBridge />
        <RouteProgressBar />
        <AuthGate>
          <Component {...pageProps} />
        </AuthGate>
        {/* Gated at the render site too, so production never even requests the chunk. */}
        {process.env.NODE_ENV === 'development' ? <AuthDevPanel /> : null}
      </TourProvider>
    </CompanyProvider>
  );
}

export default MyApp;
