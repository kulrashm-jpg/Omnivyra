'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import FreeAuditInput from '../../components/FreeAuditInput';

const ANALYZE_ITEMS = [
  'Landing Page Messaging',
  'CTA Clarity',
  'Conversion Friction',
  'Engagement Signals',
  'Campaign Alignment',
];

export default function CampaignConversionCheck() {
  return (
    <>
      <Head>
        <title>Campaign Conversion Check | Free Audit | Omnivyra</title>
        <meta name="description" content="Analyze how well your landing pages convert campaign traffic with our AI-powered conversion audit." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        {/* Hero */}
        <section className="hero-section-bg px-4 pt-12 pb-20 sm:px-6 sm:pt-16 sm:pb-24">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Is Your Campaign Traffic Actually Converting?
            </h1>
            <p className="mt-6 text-lg text-white/90 sm:text-xl">
              Analyze how well your landing pages convert campaign traffic.
            </p>
            <div className="mx-auto mt-10 max-w-xl">
              <FreeAuditInput
                inputLabel="Landing page URL"
                placeholder="https://your-landing-page.com"
                buttonText="Run Conversion Audit"
              />
            </div>
          </div>
        </section>

        {/* Campaign Problem */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              Campaign Problem
            </h2>
            <p className="mt-6 text-center text-gray-600 leading-relaxed">
              Traffic leakage happens between campaigns and landing pages. Your ad copy promises one thing, 
              but the page delivers something else—or the path to conversion is unclear. You pay for clicks, 
              but visitors bounce before they convert.
            </p>
          </div>
        </section>

        {/* What We Analyze */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              What We Analyze
            </h2>
            <ul className="mt-10 space-y-3">
              {ANALYZE_ITEMS.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white py-4 px-5"
                >
                  <span className="h-2 w-2 rounded-full bg-[#0B5ED7]" />
                  <span className="font-medium text-gray-900">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Example Output */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              Example Output
            </h2>
            <div className="mt-10 rounded-xl border border-gray-200 bg-white p-8 shadow-[0_4px_20px_rgba(11,94,215,0.08)] text-center">
              <div className="text-sm font-medium uppercase tracking-wider text-gray-500">
                Campaign Readiness Score
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                <span className="text-3xl font-bold text-[#0B5ED7]">74</span>
                <span className="text-lg text-gray-400">/100</span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Your report will show alignment gaps and improvement opportunities.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              Run Your Free Conversion Audit
            </h2>
            <p className="mt-4 text-gray-600">
              See how your landing page performs against campaign intent.
            </p>
            <div className="mt-8">
              <FreeAuditInput
                inputLabel="Landing page URL"
                placeholder="https://your-landing-page.com"
                buttonText="Run Conversion Audit"
              />
            </div>
          </div>
        </section>

        <footer className="border-t border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          <Link href="/" className="text-[#0B5ED7] hover:underline">Back to Omnivyra</Link>
        </footer>
      </div>
    </>
  );
}
