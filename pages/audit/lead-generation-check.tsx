'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import FreeAuditInput from '../../components/FreeAuditInput';

const STRUGGLE_ITEMS = [
  { title: 'Poor visibility', desc: 'Your site is hard to find in search or ads' },
  { title: 'Weak messaging', desc: 'Visitors don\'t understand your value quickly' },
  { title: 'No conversion path', desc: 'Unclear next steps for visitors' },
  { title: 'Missing trust signals', desc: 'Lack of proof, testimonials, or credibility' },
];

const REPORT_ITEMS = [
  'Lead Generation Readiness',
  'SEO Visibility',
  'Customer Journey Friction',
  'Call-to-Action Effectiveness',
  'Trust & Credibility',
];

export default function LeadGenerationCheck() {
  return (
    <>
      <Head>
        <title>Lead Generation Check | Free Website Report | Omnivyra</title>
        <meta name="description" content="Discover hidden barriers preventing visitors from becoming customers with our free AI website audit." />
      </Head>
      <div className="min-h-screen bg-[#F5F9FF]">
        {/* Hero */}
        <section className="hero-section-bg px-4 pt-12 pb-20 sm:px-6 sm:pt-16 sm:pb-24">
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Find Out Why Your Website Isn&apos;t Generating Leads
            </h1>
            <p className="mt-6 text-lg text-white/90 sm:text-xl">
              Discover hidden barriers preventing visitors from becoming customers.
            </p>
            <div className="mx-auto mt-10 max-w-xl">
              <FreeAuditInput
                inputLabel="Website URL"
                placeholder="https://yourwebsite.com"
                buttonText="Get My Free Website Report"
              />
            </div>
          </div>
        </section>

        {/* Why Small Business Websites Struggle */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              Why Small Business Websites Struggle
            </h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {STRUGGLE_ITEMS.map((item) => (
                <div
                  key={item.title}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
                >
                  <h3 className="font-semibold text-gray-900">{item.title}</h3>
                  <p className="mt-2 text-sm text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* What Your Report Includes */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-center text-2xl font-semibold text-gray-900 sm:text-3xl">
              What Your Report Includes
            </h2>
            <ul className="mt-10 space-y-3">
              {REPORT_ITEMS.map((item) => (
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
                Lead Conversion Potential
              </div>
              <div className="mt-3 text-2xl font-bold text-[#0B5ED7]">Medium</div>
              <p className="mt-2 text-sm text-gray-600">
                Your report will include actionable insights to improve.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-2xl font-semibold text-gray-900 sm:text-3xl">
              Run Your Free Lead Generation Audit
            </h2>
            <p className="mt-4 text-gray-600">
              Get your report and start converting more visitors.
            </p>
            <div className="mt-8">
              <FreeAuditInput
                placeholder="https://yourwebsite.com"
                buttonText="Get My Free Website Report"
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
