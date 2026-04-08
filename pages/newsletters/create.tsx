'use client';

import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, Brain, Newspaper, LineChart, Wrench, Layers3 } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import { Loader2 } from 'lucide-react';
import { NEWSLETTER_ENGINE_CONFIGS } from '../../lib/newsletter/newsletterContentEngine';

const CARD_COPY = {
  'insight-letter': {
    shortLabel: '1-2 deep ideas',
    outcome: 'Original thinking, mental models, and one memorable closing line.',
    primaryStat: '1-2 core ideas',
    secondaryStat: 'Deep thinking',
    cta: 'Build Insight Letter',
  },
  'weekly-brief': {
    shortLabel: 'Curated + commentary',
    outcome: 'Signals, interpretation, and pattern recognition without raw dumping.',
    primaryStat: '3-5 signals',
    secondaryStat: 'Curated analysis',
    cta: 'Build Weekly Brief',
  },
  'strategic-letter': {
    shortLabel: 'Market + positioning',
    outcome: 'A strategy-memo style read focused on shifts, leverage, and positioning.',
    primaryStat: 'Market thesis',
    secondaryStat: 'Positioning-led',
    cta: 'Build Strategic Letter',
  },
  'action-letter': {
    shortLabel: 'Steps / frameworks',
    outcome: 'Operator-style teaching with clear steps, mistakes, and immediate action.',
    primaryStat: 'Step-by-step',
    secondaryStat: 'Execution-led',
    cta: 'Build Action Letter',
  },
} as const;

const CARD_VISUALS = {
  'insight-letter': {
    icon: Brain,
    accent: 'from-indigo-400 via-violet-400 to-fuchsia-500',
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-200',
    iconBgClass: 'bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-700',
    surfaceClass: 'from-violet-50/90 via-white to-fuchsia-50/60',
    borderClass: 'border-violet-200/70 hover:border-violet-300',
    glowClass: 'group-hover:shadow-violet-200/60',
    tone: 'Insight mode',
  },
  'weekly-brief': {
    icon: Newspaper,
    accent: 'from-amber-400 via-orange-400 to-rose-400',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    iconBgClass: 'bg-gradient-to-br from-amber-100 to-orange-100 text-amber-700',
    surfaceClass: 'from-amber-50/90 via-white to-orange-50/60',
    borderClass: 'border-amber-200/70 hover:border-amber-300',
    glowClass: 'group-hover:shadow-amber-200/60',
    tone: 'Brief mode',
  },
  'strategic-letter': {
    icon: LineChart,
    accent: 'from-sky-400 via-cyan-400 to-blue-500',
    badgeClass: 'bg-sky-100 text-sky-800 border-sky-200',
    iconBgClass: 'bg-gradient-to-br from-sky-100 to-cyan-100 text-sky-700',
    surfaceClass: 'from-sky-50/90 via-white to-cyan-50/60',
    borderClass: 'border-sky-200/70 hover:border-sky-300',
    glowClass: 'group-hover:shadow-sky-200/60',
    tone: 'Strategy mode',
  },
  'action-letter': {
    icon: Wrench,
    accent: 'from-emerald-400 via-teal-400 to-cyan-500',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    iconBgClass: 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-700',
    surfaceClass: 'from-emerald-50/90 via-white to-teal-50/60',
    borderClass: 'border-emerald-200/70 hover:border-emerald-300',
    glowClass: 'group-hover:shadow-emerald-200/60',
    tone: 'Action mode',
  },
} as const;

export default function NewsletterCreatePage() {
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
        <title>Create Newsletter | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-gray-500">Choose your newsletter thinking system</p>
              <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
                <span>📧</span> Create a Newsletter
              </h1>
            </div>
            <Link href="/command-center/content" className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          <div className="mb-6 rounded-2xl border border-amber-100 bg-white/80 px-5 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Layers3 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Newsletter content should think differently before it writes.</p>
                <p className="mt-1 text-sm text-gray-600">
                  Pick the kind of newsletter you want to send first. We’ll tailor the templates, depth, and generation system around that choice.
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
            {NEWSLETTER_ENGINE_CONFIGS.map((config) => {
              const visual = CARD_VISUALS[config.value];
              const copy = CARD_COPY[config.value];
              const Icon = visual.icon;
              return (
                <button
                  key={config.value}
                  onClick={() => router.push(`/newsletters/intelligence?format=${config.value}`)}
                  className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br ${visual.surfaceClass} ${visual.borderClass} p-0 text-left shadow-sm ${visual.glowClass} transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl`}
                >
                  <div className={`h-1.5 w-full bg-gradient-to-r ${visual.accent}`} />

                  <div className="p-6">
                    <div className="mb-5 flex items-start justify-between gap-3">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${visual.iconBgClass} shadow-sm`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${visual.badgeClass}`}>
                        {visual.tone}
                      </span>
                    </div>

                    <div className="mb-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Newsletter Type
                      </p>
                      <h3 className="mt-1 text-lg font-semibold text-gray-900">{config.title}</h3>
                      <p className="mt-1 text-sm font-medium text-gray-700">{copy.shortLabel}</p>
                      <p className="mt-2 text-sm leading-relaxed text-gray-600">{copy.outcome}</p>
                    </div>

                    <div className="mb-5 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Core Shape</p>
                        <p className="mt-1 text-xs font-medium text-gray-700">{copy.primaryStat}</p>
                      </div>
                      <div className="rounded-xl border border-white/70 bg-white/80 px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Style</p>
                        <p className="mt-1 text-xs font-medium text-gray-700">{copy.secondaryStat}</p>
                      </div>
                    </div>

                    <div className="mb-5 rounded-xl border border-dashed border-gray-200/80 bg-white/70 px-3 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Thinking Mode</p>
                      <p className="mt-1 text-sm text-gray-700">{config.thinkingMode}</p>
                      <p className="mt-2 text-xs leading-relaxed text-gray-500">
                        {config.structure.join(' • ')}
                      </p>
                    </div>

                    <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-900 transition-all group-hover:gap-2.5">
                      {copy.cta} <ArrowRight className="h-4 w-4" />
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
