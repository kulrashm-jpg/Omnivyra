/**
 * Command Center -> Content
 *
 * Entry gateway separating writer-driven and creator-dependent content.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import PageLoader from '../../components/PageLoader';

type EntryCard = {
  id: 'writer' | 'creator';
  eyebrow: string;
  title: string;
  description: string;
  outcome: string;
  bullets: string[];
  /** Canonical supported formats for this lane — the count badge is derived from
   *  this list (formats.length) so the number can never drift from the content. */
  formats: string[];
  route: string;
  cta: string;
  accent: string;
};

const ENTRY_CARDS: EntryCard[] = [
  {
    id: 'writer',
    eyebrow: 'Text-First',
    title: 'Writer Content',
    description: 'Enter the long-form content workflow for Blogs, Articles, Guides, Newsletters, and Whitepapers.',
    outcome: 'The long-form writing workflow, kept intact behind a cleaner entry point',
    bullets: [
      'AI-assisted long-form writing',
      'Rich structured editor',
      'Research, SEO and publishing workflow',
      'Can later be repurposed into creator assets and campaigns',
    ],
    formats: ['Blog', 'Article', 'Guide', 'Newsletter', 'Whitepaper'],
    route: '/command-center/writer-content',
    cta: 'Open Writer Content',
    accent: 'from-blue-50 via-white to-indigo-50 border-blue-200',
  },
  {
    id: 'creator',
    eyebrow: 'Asset-First',
    title: 'Creator Content',
    description: 'Open the creator workflow for Images, Carousels, and Infographics.',
    outcome: 'The creator workflow for AI-developed visual assets',
    bullets: [
      'AI-assisted visual content creation',
      'Multi-platform creative assets',
      'Campaign-ready visual packaging',
      'Reusable assets for publishing and marketing',
    ],
    formats: ['Image', 'Carousel', 'Infographic'],
    route: '/command-center/creator-content',
    cta: 'Open Creator Content',
    accent: 'from-rose-50 via-white to-amber-50 border-rose-200',
  },
];

export default function ContentGatewayPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return <PageLoader message="Loading your workspace…" />;
  }

  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-6xl">
        <button
          onClick={() => router.push('/command-center')}
          className="mb-8 flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Command Center
        </button>

        <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
            <div className="max-w-3xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Content System
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Choose the content lane you want to build in
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                Content now opens through two production lanes. Writer Content keeps the full text-first system intact.
                Creator Content gives creator-dependent assets their own workflow, structure, and AI-assisted generation path.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Lanes</p>
                <p className="mt-1 text-base font-semibold text-gray-900">2</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Purpose</p>
                <p className="mt-1 text-base font-semibold text-gray-900">Clearer</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Writer Content</p>
              <p className="mt-1 text-sm text-gray-700">Text-first formats with established generation, editing, and campaign launch workflows.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Creator Content</p>
              <p className="mt-1 text-sm text-gray-700">Creator-dependent assets with AI-generated structure, packaging, and reusable campaign outputs.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Shared Value</p>
              <p className="mt-1 text-sm text-gray-700">Both lanes can flow into campaigns, direct publishing, and future text-plus-asset reuse.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {ENTRY_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => router.push(card.route)}
              className={`group cursor-pointer rounded-[28px] border bg-gradient-to-br ${card.accent} p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)] md:p-8`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{card.eyebrow}</p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight text-gray-900">{card.title}</h2>
                </div>
                <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-gray-700 shadow-sm">
                  {card.formats.length} formats
                </span>
              </div>

              <p className="mt-4 text-sm leading-relaxed text-gray-600 md:text-base">{card.description}</p>

              <div className="mt-5 rounded-2xl border border-white/80 bg-white/75 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">What This Unlocks</p>
                <p className="mt-1 text-sm font-medium text-gray-800">{card.outcome}</p>
              </div>

              <ul className="mt-5 space-y-2 text-sm text-gray-700">
                {card.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-900/70" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(card.route);
                }}
                className="mt-6 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                {card.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
