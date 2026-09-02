'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import MarketingPageMeta from '../../components/seo/MarketingPageMeta';

/**
 * Free Audit confirmation.
 *
 * This page previously rendered a hardcoded `SAMPLE_SCORES` array — Website Intelligence 67,
 * Conversion Readiness 62, SEO Visibility 58, Trust Signals 71, User Experience 64 — under
 * the heading "Your Website Audit Report" with the submitted URL directly beneath it. It was
 * labelled "Preview mode", but the framing invited a prospect to read those numbers as an
 * assessment of the domain they had just entered. Nothing had been measured.
 *
 * That is the opposite of how the real Digital Snapshot behaves: it abstains when evidence is
 * missing, states what it could not measure, and refuses to publish a score it cannot support.
 * A prospect meeting invented numbers here and honest abstention inside the product would
 * rightly distrust both.
 *
 * The scores are removed rather than replaced. Running the real engine from this public,
 * unauthenticated page is not currently safe — Report 1 is strictly tenant-scoped, its
 * composition calls paid LLM providers, and the crawl trigger is authenticated and
 * role-gated. So this page now does the one honest thing available: confirm the request,
 * describe what the Digital Snapshot actually measures, and make no claim about this domain.
 *
 * No score, index or grade for the submitted domain may be rendered here until the page is
 * reading real evidence from the canonical Report 1 engine.
 */

/**
 * What the Digital Snapshot measures. These are DESCRIPTIONS of the real engine's
 * dimensions — not scores, and not values for the submitted domain. Each maps to an
 * implemented capability so the description cannot drift from the product.
 */
const WHAT_WE_MEASURE: Array<{ title: string; detail: string }> = [
  {
    title: 'Website & technical health',
    detail: 'Crawlability, indexability, canonical tags, structured data, metadata, internal linking and redirects — measured page by page, with anything a crawl cannot observe marked as such.',
  },
  {
    title: 'Content depth & coverage',
    detail: 'Whether your pages answer buyer questions with enough depth, where content is thin or duplicated, and which commercially important pages are missing.',
  },
  {
    title: 'Digital experience',
    detail: 'Information accessibility, value communication, conversion readiness and technical friction — assessed from what your site actually exposes.',
  },
  {
    title: 'AI & answer-engine visibility',
    detail: 'Whether AI assistants recognise and recommend you for your own category, and which competitors they name instead.',
  },
  {
    title: 'Competitive position',
    detail: 'Two separate views: who solves a similar problem, and who competes for the same customer. A company can be one without being the other.',
  },
  {
    title: 'Evidence coverage',
    detail: 'How much of the picture we could actually observe — stated openly, so you know how far to trust each finding.',
  },
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
      {/* noindex retained: this is a per-submission confirmation, not indexable content. */}
      <MarketingPageMeta
        title="Audit Request Received | Omnivyra"
        description="Your Omnivyra website audit request has been received."
        path="/free-audit/report"
        noindex
      />
      <div className="min-h-screen bg-[#F5F9FF]">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-[0_4px_20px_rgba(11,94,215,0.08)] sm:p-10">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Request received
              </div>
              <h1 className="mt-6 text-2xl font-bold text-gray-900 sm:text-3xl">
                We&rsquo;ve got your audit request
              </h1>
              {mounted && url && (
                <p className="mt-2 break-all text-gray-600">
                  <span className="text-gray-500">Requested for </span>
                  {url}
                </p>
              )}
              <p className="mx-auto mt-4 max-w-md text-gray-600">
                We&rsquo;ll be in touch with your Digital Snapshot. We haven&rsquo;t analysed
                this site yet, so there are no results to show you on this page.
              </p>
            </div>

            <div className="mt-10">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                What the Digital Snapshot measures
              </h2>
              <div className="mt-4 space-y-4">
                {WHAT_WE_MEASURE.map((item) => (
                  <div key={item.title} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                    <p className="font-semibold text-gray-900">{item.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-lg border border-[#0B5ED7]/20 bg-[#0B5ED7]/[0.04] p-4 text-sm text-gray-700">
              <p className="font-medium text-gray-900">How we report</p>
              <p className="mt-1 leading-relaxed">
                We only report what we can actually observe. Where the evidence isn&rsquo;t
                there, your report says so and explains what would be needed &mdash; rather
                than filling the gap with a number.
              </p>
            </div>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/free-audit/start"
                className="landing-btn-primary rounded-xl px-6 py-3.5 text-center font-semibold"
              >
                Submit another site
              </Link>
              <Link
                href="/"
                className="rounded-xl border border-gray-200 px-6 py-3.5 text-center font-medium text-gray-700 hover:bg-gray-50"
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
