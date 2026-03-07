'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import FreeAuditInput from '../../components/FreeAuditInput';

const REPORT_CARDS = [
  { title: 'Website Health', desc: 'Overall site structure and performance signals' },
  { title: 'Conversion Friction', desc: 'Points where visitors drop off or hesitate' },
  { title: 'Messaging Clarity', desc: 'How well your value proposition resonates' },
  { title: 'Trust Signals', desc: 'Social proof, credentials, and credibility' },
  { title: 'Traffic Leakage', desc: 'Where visitors exit without converting' },
];

const SCORE_ITEMS = [
  { label: 'SEO Visibility', value: '58' },
  { label: 'Conversion Readiness', value: '67' },
  { label: 'Content Alignment', value: '52' },
  { label: 'Trust Signals', value: '71' },
  { label: 'User Experience', value: '62' },
];

export default function WebsiteGrowthCheck() {
  return (
    <>
      <Head>
        <title>Website Growth Check | Free AI Audit | Omnivyra</title>
        <meta name="description" content="Run a 60-second AI website growth audit to discover hidden issues affecting your traffic, leads, and conversions." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        {/* Hero */}
        <section className="hero-section-bg px-4 pt-12 pb-20 sm:px-6 sm:pt-16 sm:pb-24">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Is Your Website Silently Losing Customers?
            </h1>
            <p className="mt-6 text-lg text-white/90 sm:text-xl">
              Run a 60-second AI website growth audit to discover hidden issues affecting your traffic, leads, and conversions.
            </p>
            <div className="mx-auto mt-10 max-w-xl">
              <FreeAuditInput
                inputLabel="Website URL"
                placeholder="https://yourwebsite.com"
                buttonText="Check My Website"
              />
            </div>
          </div>
        </section>

        {/* The Problem */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              The Problem
            </h2>
            <p className="mt-6 text-center text-gray-600 leading-relaxed">
              Many founders invest in websites but cannot tell <strong className="text-gray-800">why visitors leave</strong>, 
              why leads are inconsistent, or why marketing results fluctuate. Without clarity, you keep guessing—and spending—without fixing what matters.
            </p>
          </div>
        </section>

        {/* What the Free Audit Reveals */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              What the Free Audit Reveals
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {REPORT_CARDS.map((card) => (
                <div
                  key={card.title}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
                >
                  <h3 className="font-semibold text-gray-900">{card.title}</h3>
                  <p className="mt-2 text-sm text-gray-600">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Example Report */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              Example Report
            </h2>
            <div className="mt-10 rounded-xl border border-gray-200 bg-white p-8 shadow-[0_4px_20px_rgba(11,94,215,0.08)]">
              <div className="mb-6 flex items-baseline gap-2">
                <span className="text-sm font-medium uppercase tracking-wider text-gray-500">
                  Website Intelligence Score
                </span>
                <span className="text-3xl font-bold text-[#0B5ED7]">62</span>
                <span className="text-lg text-gray-400">/100</span>
              </div>
              <div className="space-y-3">
                {SCORE_ITEMS.map((item) => (
                  <div key={item.label} className="flex justify-between border-b border-gray-100 pb-2">
                    <span className="text-gray-600">{item.label}</span>
                    <span className="font-medium text-gray-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Trust + CTA */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              Run Your Free Website Audit
            </h2>
            <p className="mt-4 text-gray-600">
              Get your instant score and actionable recommendations.
            </p>
            <div className="mt-8">
              <FreeAuditInput
                placeholder="https://yourwebsite.com"
                buttonText="Run Your Free Website Audit"
              />
            </div>
            <p className="mt-6 text-sm text-gray-500">
              No credit card • Takes under 60 seconds • Instant results
            </p>
          </div>
        </section>

        <footer className="border-t border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          <Link href="/" className="text-[#0B5ED7] hover:underline">Back to Omnivyra</Link>
        </footer>
      </div>
    </>
  );
}
