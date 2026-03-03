import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { CompanyProvider } from '../components/CompanyContext';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../components/CompanyContext';

const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useCompanyContext();

  const publicRoutes = ['/login', '/signup', '/super-admin/login', '/'];
  const isSuperAdminRoute = router.pathname.startsWith('/super-admin');
  const isPlatformExternalApis =
    router.pathname === '/external-apis' && router.asPath.includes('mode=platform');
  // Content Architect uses cookie auth; allow these so they are not redirected to Supabase login
  const isCompanyProfile = router.pathname === '/company-profile';
  const isContentArchitectHub = router.pathname === '/content-architect';
  const isRecommendationsPage = router.pathname === '/recommendations';
  const isCampaignOrPlanRoute =
    router.pathname.startsWith('/campaigns') || router.pathname.startsWith('/campaign-daily-plan');
  const isPublic =
    publicRoutes.includes(router.pathname) ||
    isSuperAdminRoute ||
    isPlatformExternalApis ||
    isCompanyProfile ||
    isContentArchitectHub ||
    isRecommendationsPage ||
    isCampaignOrPlanRoute;

  if (!isPublic && !isAuthenticated && !isLoading) {
    if (typeof window !== 'undefined') {
      router.replace('/login');
    }
    return null;
  }

  return <>{children}</>;
};

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <CompanyProvider>
      <Head>
        <link rel="icon" href="/favicon.jpg" />
      </Head>
      <AuthGate>
        <Component {...pageProps} />
      </AuthGate>
    </CompanyProvider>
  );
}

export default MyApp;
