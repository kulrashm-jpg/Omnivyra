'use client';

import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

const SAMPLE_SCORES = [
  { label: 'Website Intelligence', value: 67 },
  { label: 'Conversion Readiness', value: 62 },
  { label: 'SEO Visibility', value: 58 },
  { label: 'Trust Signals', value: 71 },
  { label: 'User Experience', value: 64 },
];

export default function FreeAuditReport() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const q = router.query.url;
    if (typeof q === 'string') setUrl(q);
  }, [router.query.url]);

  return (
    <>
      <Head>
        <title>Your Website Audit Report | Omnivyra</title>
        <meta name="description" content="Your free website intelligence audit results from Omnivyra." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_20px_rgba(11,94,215,0.08)] sm:p-10">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Report Ready
              </div>
              <h1 className="mt-6 text-2xl font-bold text-gray-900 sm:text-3xl">
                Your Website Audit Report
              </h1>
              {mounted && url && (
                <p className="mt-2 text-gray-600 break-all">{url}</p>
              )}
            </div>

            <div className="mt-10 rounded-xl border border-gray-100 bg-gray-50/50 p-6">
              <div className="mb-4 flex items-baseline justify-between">
                <span className="text-sm font-medium uppercase tracking-wider text-gray-500">
                  Sample Intelligence Score
                </span>
                <span className="text-2xl font-bold text-[#0B5ED7]">67</span>
              </div>
              <div className="space-y-3">
                {SAMPLE_SCORES.map((item) => (
                  <div key={item.label} className="flex justify-between border-b border-gray-100 pb-2 last:border-0">
                    <span className="text-gray-600">{item.label}</span>
                    <span className="font-semibold text-gray-900">{item.value}/100</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800">
              <p className="font-medium">Preview mode</p>
              <p className="mt-1 text-amber-700">
                This is a sample report. Connect to the full audit engine to generate real results tailored to your website.
              </p>
            </div>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/free-audit/start"
                className="landing-btn-primary rounded-xl py-3.5 px-6 text-center font-semibold"
              >
                Run Another Audit
              </Link>
              <Link
                href="/"
                className="rounded-xl border border-gray-200 py-3.5 px-6 text-center font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to Omnivyra
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
