import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { CompanyProvider } from '../components/CompanyContext';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';
import LandingNavbar from '../components/landing/LandingNavbar';
import { TourProvider } from '../components/tour/TourContext';
import { clearSupabaseSession } from '../utils/clearSupabaseSession';

// One-time: remove any stale Supabase auth keys left in localStorage/cookies.
// Runs only in browser, only once per page load.
if (typeof window !== 'undefined') {
  clearSupabaseSession();
}

const LANDING_PUBLIC_ROUTES = ['/', '/pricing', '/about', '/blog', '/solutions', '/features', '/privacy', '/terms', '/data-deletion', '/audit/website-growth-check', '/audit/lead-generation-check', '/audit/campaign-conversion-check', '/free-audit/start', '/free-audit/report'];

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { isAuthenticated, authChecked } = useCompanyContext();

  const publicRoutes = ['/login', '/signup', '/super-admin/login', '/', '/pricing', '/about', '/blog', '/solutions', '/features', '/privacy', '/terms', '/data-deletion', '/get-free-credits', '/create-account', '/onboarding/phone', '/onboarding/verify-phone', '/onboarding/company', '/onboarding/profile', '/auth/callback', '/auth/verify'];
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

  // Protected routes: hold the render until the backend probe has resolved.
  // This prevents a flash of protected content before we know the user's auth state,
  // and prevents a premature redirect to /login before we know the user is NOT authenticated.
  if (!isPublic && !authChecked) {
    return null;
  }

  // After auth settles: redirect unauthenticated users away from protected routes.
  if (!isPublic && !isAuthenticated) {
    if (typeof window !== 'undefined') {
      router.replace('/login');
    }
    return null;
  }

  return (
    <>
      {showLandingNavbar && <LandingNavbar />}
      {children}
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
        <AuthGate>
          <Component {...pageProps} />
        </AuthGate>
      </TourProvider>
    </CompanyProvider>
  );
}

export default MyApp;
