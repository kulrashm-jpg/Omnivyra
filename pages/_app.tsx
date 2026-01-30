import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { CompanyProvider } from '../components/CompanyContext';

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <CompanyProvider>
      <Component {...pageProps} />
    </CompanyProvider>
  );
}

export default MyApp;
