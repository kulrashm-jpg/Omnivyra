import React, { useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function CommunityAiHomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    void router.replace('/engagement');
  }, [router]);

  return (
    <>
      <Head>
        <title>Redirecting to Engagement Center</title>
      </Head>
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-gray-50 px-6">
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-5 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-gray-900">Engagement Center</h1>
          <p className="mt-2 text-sm text-gray-600">
            Community AI has been consolidated into the Engagement Center.
          </p>
        </div>
      </div>
    </>
  );
}
