'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, Compass, Crown, Loader2, Radar, Zap } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';

const WORD_TIERS = [
  {
    words: '800',
    label: '800+ words',
    title: 'Executive Insight',
    description: 'A concise point of view designed for sharp commentary, campaign support, and fast-turn market response.',
    bestFor: 'Commentary, launches, quick trend reactions',
    pace: 'Fast-turn',
    depth: 'Lean narrative',
    strategicFit: 'Keeps your brand present with a clear perspective when timing matters more than exhaustive depth.',
    accent: 'from-amber-500 via-orange-500 to-rose-500',
    panelClass: 'from-amber-50 via-white to-orange-50',
    borderClass: 'border-amber-200/70 hover:border-amber-300',
    badgeClass: 'bg-amber-100 text-amber-800',
    iconClass: 'bg-amber-100 text-amber-700',
    icon: Zap,
  },
  {
    words: '1200',
    label: '1,200+ words',
    title: 'Authority Blog',
    description: 'Balanced depth for educational SEO, stronger trust, and a polished reading experience suitable for steady publishing.',
    bestFor: 'Search growth, evergreen education, category trust',
    pace: 'Balanced',
    depth: 'Core authority',
    strategicFit: 'A reliable operating format for B2B marketing teams that need quality, consistency, and discoverability.',
    accent: 'from-sky-500 via-cyan-500 to-blue-600',
    panelClass: 'from-sky-50 via-white to-cyan-50',
    borderClass: 'border-sky-200/70 hover:border-sky-300',
    badgeClass: 'bg-sky-100 text-sky-800',
    iconClass: 'bg-sky-100 text-sky-700',
    icon: Compass,
  },
  {
    words: '1600',
    label: '1,600+ words',
    title: 'Deep-Dive Analysis',
    description: 'A richer editorial build for nuanced arguments, stronger supporting detail, and a more defensible market position.',
    bestFor: 'Thought leadership, problem breakdowns, framework-led content',
    pace: 'Focused',
    depth: 'Strategic depth',
    strategicFit: 'Ideal when your audience expects more than surface-level advice and your brand needs to teach with authority.',
    accent: 'from-violet-500 via-fuchsia-500 to-purple-600',
    panelClass: 'from-violet-50 via-white to-fuchsia-50',
    borderClass: 'border-violet-200/70 hover:border-violet-300',
    badgeClass: 'bg-violet-100 text-violet-800',
    iconClass: 'bg-violet-100 text-violet-700',
    icon: Radar,
  },
  {
    words: '2000',
    label: '2,000+ words',
    title: 'Cornerstone Asset',
    description: 'A premium long-form format built for category ownership, comprehensive search coverage, and executive-grade substance.',
    bestFor: 'Pillar pages, flagship resources, category-defining narratives',
    pace: 'Deliberate',
    depth: 'Cornerstone level',
    strategicFit: 'Best when the goal is durable authority and a content asset that can anchor campaigns, sales enablement, and SEO.',
    accent: 'from-emerald-500 via-teal-500 to-cyan-600',
    panelClass: 'from-emerald-50 via-white to-teal-50',
    borderClass: 'border-emerald-200/70 hover:border-emerald-300',
    badgeClass: 'bg-emerald-100 text-emerald-800',
    iconClass: 'bg-emerald-100 text-emerald-700',
    icon: Crown,
  },
];

export default function BlogCreatePage() {
  const router = useRouter();
  const { user, isLoading } = useCompanyContext();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Sign in to continue.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Create Blog | OmniVyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
        <div className="mx-auto max-w-6xl">
          <Link href="/command-center/content" className="mb-8 inline-flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Back to Content
          </Link>

          <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
              <div className="max-w-3xl">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Blog System</p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">Choose the depth of your blog asset</h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Set the editorial ambition before generation begins. Each path keeps the content journey structured,
                  executive-ready, and tuned for stronger authority, clarity, and commercial relevance.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Depth Paths</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">4</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">UX Goal</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">Consistent</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">Teams choosing the right editorial depth before they invest time in research, structure, and final generation.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">Each option clarifies how much authority, analysis, and search strength the final asset should carry.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">Premium blog creation paths that feel aligned with the rest of the content system, not like a separate tool.</p>
              </div>
            </div>
          </div>

          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Blog Depth</p>
              <p className="mt-1 text-sm text-gray-600">Choose the level of narrative depth and editorial weight that best fits the outcome you want.</p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/blogs/manage" className="hidden text-sm font-medium text-gray-600 transition-colors hover:text-gray-900 md:block">
                Manage blogs
              </Link>
              <p className="hidden text-sm text-gray-500 md:block">4 blog paths</p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {WORD_TIERS.map((tier) => {
              const Icon = tier.icon;

              return (
                <button
                  key={tier.words}
                  onClick={() => router.push(`/blogs/intelligence?words=${tier.words}`)}
                  className={`group relative overflow-hidden rounded-[28px] border bg-gradient-to-br ${tier.panelClass} ${tier.borderClass} p-6 text-left shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)]`}
                >
                  <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${tier.accent}`} />

                  <div className="mb-5 flex items-start justify-between gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tier.iconClass} shadow-sm`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tier.badgeClass}`}>
                      {tier.label}
                    </span>
                  </div>

                  <div className="mb-5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Recommended Asset</p>
                    <h3 className="mt-2 text-xl font-semibold text-slate-950">{tier.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{tier.description}</p>
                  </div>

                  <div className="mb-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pace</p>
                      <p className="mt-1 text-sm font-medium text-slate-800">{tier.pace}</p>
                    </div>
                    <div className="rounded-2xl border border-white/80 bg-white/80 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Depth</p>
                      <p className="mt-1 text-sm font-medium text-slate-800">{tier.depth}</p>
                    </div>
                  </div>

                  <div className="mb-5 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Best For</p>
                    <p className="mt-2 text-sm text-slate-700">{tier.bestFor}</p>
                  </div>

                  <div className="mb-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Strategic Fit</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{tier.strategicFit}</p>
                  </div>

                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 transition-all group-hover:gap-2.5">
                    Continue with this direction <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
