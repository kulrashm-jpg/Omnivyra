'use client';

import React from 'react';
import Link from 'next/link';

type HeroSectionProps = {
  onCheckReadiness?: () => void;
};

const cardShadow = '0 1px 0 0 rgba(255,255,255,0.7) inset, 0 8px 32px rgba(0,0,0,0.08), 0 2px 12px rgba(11,94,215,0.12)';

export default function HeroSection({ onCheckReadiness }: HeroSectionProps) {
  return (
    <section className="flex max-h-[calc(100vh-4rem)] min-h-[calc(100vh-4rem)] flex-col overflow-hidden">
      {/* Top banner: blue gradient, headline left, white cards right (reverted) */}
      <div className="hero-section-bg mx-auto flex w-full max-w-7xl min-h-0 flex-1 flex-col items-center gap-10 px-6 py-10 sm:py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-20 lg:px-8 lg:py-16">
        <div className="w-full min-w-0 flex-1 text-center lg:max-w-3xl lg:text-left">
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-tight text-white drop-shadow-sm lg:text-5xl xl:text-[2.75rem]">
            Power Your Campaigns Before You Spend
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/90 lg:mx-0">
            AI evaluates campaign readiness, conversion structure, positioning gaps, and execution risk — instantly.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <button
              type="button"
              onClick={onCheckReadiness}
              className="rounded-xl landing-btn-primary px-6 py-3.5 text-[15px] font-semibold transition-all duration-200"
            >
              Check Readiness
            </button>
            <Link
              href="/pricing"
              className="rounded-xl landing-btn-secondary px-6 py-3.5 text-[15px] font-semibold transition-all duration-200"
            >
              View Pricing
            </Link>
          </div>
        </div>

        <div className="relative flex h-[220px] w-full min-w-0 flex-shrink-0 flex-col justify-between sm:h-[240px] lg:max-w-[320px]">
          <div className="absolute -inset-2 rounded-xl bg-white/20 blur-2xl" aria-hidden="true" />
          <div
            className="relative flex min-h-[108px] w-[90%] min-w-[240px] flex-col justify-between self-start rounded-xl border border-white/30 bg-white/95 p-4 backdrop-blur-md sm:min-h-[112px] sm:w-60"
            style={{ boxShadow: cardShadow }}
          >
            <div className="text-[11px] font-medium uppercase tracking-widest text-gray-500">
              Readiness Snapshot
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-semibold tracking-tight text-[#0B5ED7]">67</span>
              <span className="text-base text-gray-400">/100</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-gray-100/80 pt-2 text-[13px]">
              <span className="text-gray-500">Strategic Gaps</span>
              <span className="font-semibold text-gray-800">3</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[13px]">
              <span className="text-gray-500">Conversion Friction</span>
              <span className="font-medium text-amber-600">Moderate</span>
            </div>
          </div>
          <div
            className="relative flex min-h-[108px] w-[90%] min-w-[240px] flex-col justify-between self-end rounded-xl border border-white/30 bg-white/95 p-4 backdrop-blur-md sm:min-h-[112px] sm:w-60"
            style={{ boxShadow: cardShadow }}
          >
            <div className="text-[11px] font-medium uppercase tracking-widest text-gray-500">
              Execution Outlook
            </div>
            <div className="space-y-1.5 text-[13px]">
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-gray-500">Risk level</span>
                <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Low</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-gray-500">Time to launch</span>
                <span className="font-medium text-gray-800">~2 weeks</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2">
                <span className="text-gray-500">Recommended fixes</span>
                <span className="font-semibold text-[#0B5ED7]">3</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom section: light background, centered rectangle with circle inside */}
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center bg-[#F5F9FF] px-4 py-8 font-sans antialiased sm:px-6 sm:py-10">
        <div className="flex w-full max-w-5xl flex-col items-center rounded-xl border border-[#0B5ED7]/40 bg-gradient-to-br from-[#0B5ED7] to-[#1565c4] p-4 shadow-[0_8px_24px_rgba(11,94,215,0.2)] sm:flex-row sm:items-center sm:gap-4 sm:py-6 sm:pl-4 sm:pr-6">
          {/* Circle inside rectangle: 16px from left, 16px gap from text */}
          <div className="relative flex h-32 w-32 flex-shrink-0 items-center justify-center sm:h-36 sm:w-36">
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white/40 sm:h-3.5 sm:w-3.5"
                style={{
                  transform: `translate(-50%, -50%) rotate(${i * 45}deg) translateY(-44px)`,
                }}
              />
            ))}
            <div className="relative flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-full border-2 border-white bg-gradient-to-br from-[#0B5ED7] to-[#1565c4] shadow-[0_4px_16px_rgba(0,0,0,0.15)] sm:h-24 sm:w-24">
              <svg className="h-10 w-10 text-white sm:h-12 sm:w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>

          {/* Text + button */}
          <div className="flex flex-1 flex-col items-center text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
            <div className="flex-1">
              <h2 className="text-xl font-semibold leading-snug tracking-tight text-white sm:text-2xl">
                Know your gaps. Fix them before you spend.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/90 sm:mx-0">
                Get a clear roadmap to launch — readiness score, friction points, and recommended fixes in minutes. No guesswork, no wasted budget.
              </p>
            </div>
            <button
              type="button"
              onClick={onCheckReadiness}
              className="mt-4 flex-shrink-0 rounded-xl border-2 border-white bg-white/10 px-6 py-3.5 text-[15px] font-semibold text-white backdrop-blur-sm transition-all duration-200 hover:bg-white/20 sm:mt-0"
            >
              Get your free score
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
