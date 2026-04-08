'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, Zap, Compass, Radar, Crown } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { Loader2 } from 'lucide-react';

const WORD_TIERS = [
  {
    words: '800',
    label: '800+ words',
    title: 'Quick Insight Blog',
    description: 'Fast, sharp, idea-driven content that gets to the point quickly while still delivering a clear takeaway.',
    bestFor: 'Fast, sharp, idea-driven',
    accent: 'from-amber-400 via-orange-400 to-rose-400',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    iconBgClass: 'bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700',
    surfaceClass: 'from-amber-50/90 via-white to-orange-50/60',
    borderClass: 'border-amber-200/70 hover:border-amber-300',
    glowClass: 'group-hover:shadow-amber-200/60',
    icon: Zap,
    pace: 'Fast turn',
    depth: 'Lean depth',
  },
  {
    words: '1200',
    label: '1,200+ words',
    title: 'Standard Authority Blog',
    description: 'Balanced depth and SEO value for strong ranking potential, reader trust, and a complete but efficient structure.',
    bestFor: 'Balanced depth + SEO',
    accent: 'from-sky-400 via-cyan-400 to-blue-500',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    iconBgClass: 'bg-gradient-to-br from-sky-100 to-cyan-100 text-sky-700',
    surfaceClass: 'from-sky-50/90 via-white to-cyan-50/60',
    borderClass: 'border-sky-200/70 hover:border-sky-300',
    glowClass: 'group-hover:shadow-sky-200/60',
    icon: Compass,
    pace: 'Balanced build',
    depth: 'SEO depth',
  },
  {
    words: '1600',
    label: '1,600+ words',
    title: 'Deep Dive Blog',
    description: 'Stronger authority with enough room to explain mechanisms, examples, and the why behind the advice.',
    bestFor: 'Strong authority + mechanism',
    accent: 'from-violet-400 via-fuchsia-400 to-purple-500',
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-200',
    iconBgClass: 'bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-700',
    surfaceClass: 'from-violet-50/90 via-white to-fuchsia-50/60',
    borderClass: 'border-violet-200/70 hover:border-violet-300',
    glowClass: 'group-hover:shadow-violet-200/60',
    icon: Radar,
    pace: 'Focused depth',
    depth: 'Mechanism-first',
  },
  {
    words: '2000',
    label: '2,000+ words',
    title: 'Pillar / Cornerstone Blog',
    description: 'Comprehensive long-form content built for category ownership, broad relevance, and long-term authority.',
    bestFor: 'Category ownership',
    accent: 'from-emerald-400 via-teal-400 to-cyan-500',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    iconBgClass: 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700',
    surfaceClass: 'from-emerald-50/90 via-white to-teal-50/60',
    borderClass: 'border-emerald-200/70 hover:border-emerald-300',
    glowClass: 'group-hover:shadow-emerald-200/60',
    icon: Crown,
    pace: 'Authority play',
    depth: 'Cornerstone level',
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
        <p className="text-gray-500 text-sm">Sign in to continue.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Create Blog | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 p-6">
        <div className="mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs text-gray-500 mb-1">Choose your blog size</p>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span>✍️</span> Create a Blog Post
              </h1>
            </div>
            <Link href="/command-center/content" className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          {/* Word count tier cards */}
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
            {WORD_TIERS.map((tier) => {
              const Icon = tier.icon;
              return (
                <button
                  key={tier.words}
                  onClick={() => router.push(`/blogs/intelligence?words=${tier.words}`)}
                  className={`group relative overflow-hidden text-left rounded-2xl border bg-gradient-to-br ${tier.surfaceClass} ${tier.borderClass} p-0 shadow-sm ${tier.glowClass} hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200`}
                >
                  <div className={`h-1.5 w-full bg-gradient-to-r ${tier.accent}`} />

                  <div className="p-6">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${tier.iconBgClass} shadow-sm`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tier.badgeClass}`}>
                        {tier.label}
                      </span>
                    </div>

                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-gray-900 group-hover:text-gray-700">
                        {tier.title}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-gray-600">
                        {tier.description}
                      </p>
                    </div>

                    <div className="mb-5 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Pace</p>
                        <p className="mt-1 text-xs font-medium text-gray-700">{tier.pace}</p>
                      </div>
                      <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Depth</p>
                        <p className="mt-1 text-xs font-medium text-gray-700">{tier.depth}</p>
                      </div>
                    </div>

                    <div className="mb-5 rounded-xl border border-dashed border-gray-200/80 bg-white/70 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Best For</p>
                      <p className="mt-1 text-sm text-gray-700">{tier.bestFor}</p>
                    </div>

                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 transition-all group-hover:gap-2.5">
                      Start with this format <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
