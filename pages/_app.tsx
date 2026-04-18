import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { CompanyProvider } from '../components/CompanyContext';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useCompanyContext } from '../components/CompanyContext';
import LandingNavbar from '../components/landing/LandingNavbar';
import { TourProvider } from '../components/tour/TourContext';
import AppLayout from '../components/layout/AppLayout';

// NOTE: clearSupabaseSession() was removed here.  It wiped sb-* localStorage
// keys (including PKCE code-verifiers) on every page load, which broke magic-
// link / password-reset flows and prevented sessions from persisting across
// refreshes.  The Firebase→Supabase migration it was originally added for is
// long complete.

const LANDING_PUBLIC_ROUTES = ['/', '/pricing', '/about', '/blog', '/solutions', '/features', '/privacy', '/terms', '/data-deletion', '/audit/website-growth-check', '/audit/lead-generation-check', '/audit/campaign-conversion-check', '/free-audit/start', '/free-audit/report'];

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

  const publicRoutes = ['/login', '/signup', '/super-admin/login', '/', '/pricing', '/about', '/blog', '/solutions', '/features', '/privacy', '/terms', '/data-deletion', '/get-free-credits', '/create-account', '/auth/callback', '/auth/verify', '/auth/set-password', '/auth/accept-invite'];
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
    if (!isPublic && authChecked && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isPublic, authChecked, isAuthenticated, router]);

  // Protected routes: hold the render until the backend probe has resolved.
  // This prevents a flash of protected content before we know the user's auth state,
  // and prevents a premature redirect to /login before we know the user is NOT authenticated.
  if (!isPublic && !authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // While authChecked but unauthenticated, render nothing (useEffect above handles redirect).
  if (!isPublic && !isAuthenticated) {
    return null;
  }

  // Onboarding pages that should NOT get the app header (they have their own layout)
  const isOnboardingRoute = router.pathname.startsWith('/onboarding');
  const isLoginRoute = router.pathname === '/login' || router.pathname === '/signup' || router.pathname === '/create-account';
  const isCaptureRoute = router.pathname.startsWith('/capture');

  // Authenticated routes get AppLayout (header + footer)
  const showAppLayout = isAuthenticated && !isPublic && !isOnboardingRoute && !isLoginRoute && !isCaptureRoute;

  return (
    <>
      {showLandingNavbar && <LandingNavbar />}
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
        <Head>
          <link rel="icon" href="/favicon.jpg" />
        </Head>
        <RouteProgressBar />
        <AuthGate>
          <Component {...pageProps} />
        </AuthGate>
      </TourProvider>
    </CompanyProvider>
  );
}

export default MyApp;
