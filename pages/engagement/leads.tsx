import { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const ACTIVE_LEADS_ROUTE = '/command-center/engagement';

export default function EngagementLeadsRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    void router.replace(ACTIVE_LEADS_ROUTE);
  }, [router]);

  return (
    <>
      <Head>
        <title>Redirecting to Active Leads | Omnivyra</title>
      </Head>
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center p-8 text-sm text-slate-500">
        Redirecting to Active Leads...
      </div>
    </>
  );
}
