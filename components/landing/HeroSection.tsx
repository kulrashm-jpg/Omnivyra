'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

type HeroSectionProps = {
  onCheckReadiness?: () => void;
};

const cardShadow = '0 1px 0 0 rgba(255,255,255,0.6) inset, 0 10px 40px rgba(0,0,0,0.12), 0 4px 16px rgba(11,94,215,0.15)';

export default function HeroSection({ onCheckReadiness }: HeroSectionProps) {
  const [bannerImageError, setBannerImageError] = useState(false);

  return (
    <section className="landing-gradient-bg flex max-h-[calc(100vh-4rem)] min-h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Top banner: full width, headline left, cards right */}
      <div className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col items-center gap-8 px-6 py-8 sm:py-10 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:py-12">
        <div className="w-full min-w-0 flex-1 text-center lg:max-w-3xl lg:text-left">
          <h1 className="text-4xl font-bold leading-tight text-white drop-shadow-md lg:text-5xl">
            Power Your Campaign Intelligence Before You Spend a Single Rupee.
          </h1>
          <p className="mt-5 text-lg text-white/95">
            AI evaluates campaign readiness, conversion structure, positioning gaps, and execution risk — instantly.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
            <button
              type="button"
              onClick={onCheckReadiness}
              className="rounded-omnivyra landing-btn-primary px-6 py-3.5 text-base font-semibold"
            >
              Check Readiness
            </button>
            <Link
              href="/pricing"
              className="rounded-omnivyra landing-btn-secondary px-6 py-3.5 text-base font-semibold"
            >
              View Pricing
            </Link>
          </div>
        </div>

        <div className="relative flex h-[200px] w-full min-w-0 flex-shrink-0 flex-col justify-between sm:h-[220px] lg:max-w-md">
          <div className="absolute -inset-3 rounded-2xl bg-white/25 blur-xl" aria-hidden="true" />
          <div
            className="relative flex h-[96px] w-[88%] min-w-[200px] flex-col justify-between self-start rounded-2xl border border-white/40 bg-white p-4 shadow-[var(--omnivyra-shadow)] backdrop-blur sm:h-[100px] sm:w-56 sm:p-4"
            style={{ boxShadow: cardShadow }}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Readiness snapshot
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-[#0B5ED7]">67</span>
              <span className="text-lg text-gray-400">/100</span>
            </div>
            <div className="flex justify-between border-t border-gray-100 pt-1.5 text-sm">
              <span className="text-gray-600">Strategic Gaps</span>
              <span className="font-semibold text-gray-900">3</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Conversion Friction</span>
              <span className="font-semibold text-amber-600">Moderate</span>
            </div>
          </div>
          <div
            className="relative flex h-[96px] w-[88%] min-w-[200px] flex-col justify-between self-end rounded-2xl border border-white/40 bg-white p-4 shadow-[var(--omnivyra-shadow)] backdrop-blur sm:h-[100px] sm:w-56 sm:p-4"
            style={{ boxShadow: cardShadow }}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Execution outlook
            </div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Risk level</span>
                <span className="font-semibold text-emerald-600">Low</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Time to launch</span>
                <span className="font-semibold text-gray-900">~2 weeks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Recommended fixes</span>
                <span className="font-semibold text-[#0B5ED7]">3</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom banner: image left (full, not truncated), message right */}
      <div className="mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col items-center justify-center gap-8 border-t border-white/25 px-6 py-6 sm:flex-row sm:gap-12 sm:py-8 lg:gap-16">
        <div className="relative flex min-h-[140px] w-full min-w-0 flex-shrink-0 items-center justify-center sm:h-44 sm:max-w-sm sm:flex-1">
          {/* Image: object-contain so full picture shows; container has room and doesn't clip */}
          <div className="relative h-full w-full max-h-[180px] min-h-[140px] sm:max-h-[176px] sm:min-h-[176px]">
            {!bannerImageError ? (
              <Image
                src="/images/landing-banner-left.jpg"
                alt="Campaign clarity: know your gaps before you spend"
                fill
                className="object-contain object-center"
                sizes="(max-width: 640px) 100vw, 28rem"
                priority
                onError={() => setBannerImageError(true)}
              />
            ) : null}
            {/* Fallback: full circle visible, no clipping */}
            <div
              className={`absolute inset-0 flex items-center justify-center ${bannerImageError ? '' : 'hidden'}`}
              aria-hidden="true"
            >
              <div className="flex h-28 w-28 flex-shrink-0 items-center justify-center rounded-full border-2 border-white/40 bg-gradient-to-br from-[#0B5ED7] via-[#1565c4] to-[#1EA7FF] shadow-[0_8px_32px_rgba(0,0,0,0.25),inset_0_1px_0_0_rgba(255,255,255,0.25)] sm:h-32 sm:w-32">
                <svg className="h-14 w-14 text-white drop-shadow-md sm:h-16 sm:w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <div className="w-full min-w-0 flex-1 text-center sm:text-right lg:max-w-2xl">
          <h2 className="text-2xl font-bold leading-tight text-white drop-shadow-md lg:text-3xl">
            Know your gaps. Fix them before you spend.
          </h2>
          <p className="mt-4 text-base text-white/95">
            Get a clear roadmap to launch — readiness score, friction points, and recommended fixes in minutes. No guesswork, no wasted budget.
          </p>
          <button
            type="button"
            onClick={onCheckReadiness}
            className="mt-5 rounded-omnivyra landing-btn-secondary px-5 py-3 text-base font-semibold"
          >
            Get your free score
          </button>
        </div>
      </div>
    </section>
  );
}
