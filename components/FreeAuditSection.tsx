'use client';

import React from 'react';
import Link from 'next/link';
import FreeAuditInput from './FreeAuditInput';

export default function FreeAuditSection() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20">
      <div className="rounded-2xl border border-gray-200/80 bg-white p-8 shadow-[0_4px_20px_rgba(11,94,215,0.08)] sm:p-10">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
          Discover What&apos;s Holding Your Website Back
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-center text-base text-gray-600 sm:text-lg">
          Run a free AI-powered website intelligence audit.
        </p>

        <div className="mx-auto mt-8 max-w-xl">
          <FreeAuditInput
            placeholder="https://yourwebsite.com"
            buttonText="Run Free Audit"
            variant="default"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="text-emerald-500">✔</span> Takes less than 60 seconds
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-emerald-500">✔</span> No credit card required
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-emerald-500">✔</span> Instant insights
          </span>
        </div>

        <p className="mt-6 text-center">
          <Link
            href="/audit/website-growth-check"
            className="text-[15px] font-medium text-[#0B5ED7] hover:underline"
          >
            See how it works
          </Link>
        </p>
      </div>
    </section>
  );
}
