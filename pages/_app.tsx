import '../styles/globals.css';
import type { AppProps } from 'next/app';
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
  const isPublic =
    publicRoutes.includes(router.pathname) ||
    isSuperAdminRoute ||
    isPlatformExternalApis;

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
      <AuthGate>
        <Component {...pageProps} />
      </AuthGate>
    </CompanyProvider>
  );
}

export default MyApp;
