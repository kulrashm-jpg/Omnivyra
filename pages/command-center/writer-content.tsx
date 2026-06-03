/**
 * Command Center -> Writer Content
 *
 * Preserves the existing nine-card writer content entry flow.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import PageLoader from '../../components/PageLoader';

interface ContentCard {
  id: string;
  icon: string;
  category: string;
  effortBand: string;
  outcome: string;
  title: string;
  description: string;
  bullets: string[];
  cta: string;
  route: string;
  accentFrom: string;
  accentTo: string;
  borderColor: string;
  ctaColor: string;
}

const CONTENT_CARDS: ContentCard[] = [
  {
    id: 'post',
    icon: 'P',
    category: 'Short-form',
    effortBand: '1-5 Credits',
    outcome: 'Platform-ready social copy for executive-grade publishing',
    title: 'Post',
    description: 'Create polished short-form content for brand, demand, and thought-leadership moments across professional channels.',
    bullets: [
      'Platform-native formatting and tone control',
      'Built for modern B2B brand presence',
      'Clean handoff into publishing workflows',
    ],
    cta: 'Create Post',
    route: '/posts/create',
    accentFrom: 'from-green-50',
    accentTo: 'to-teal-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
  {
    id: 'blog',
    icon: 'B',
    category: 'Long-form',
    effortBand: '5-15 Credits',
    outcome: 'Search-focused content that builds authority and supports pipeline growth',
    title: 'Blog',
    description: 'Build strategic blog content that strengthens discoverability, authority, and buyer education without losing editorial quality.',
    bullets: [
      'Structured for search, clarity, and trust',
      'Editorial flow with stronger topic discipline',
      'Designed for teams that care about output quality',
    ],
    cta: 'Create Blog',
    route: '/blogs/create',
    accentFrom: 'from-purple-50',
    accentTo: 'to-indigo-50',
    borderColor: 'border-purple-200',
    ctaColor: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: 'story',
    icon: 'S',
    category: 'Narrative',
    effortBand: '3-8 Credits',
    outcome: 'Brand-led story assets with stronger narrative precision',
    title: 'Story',
    description: 'Shape narrative-driven content that brings brand personality, customer truth, and strategic relevance together.',
    bullets: [
      'Narrative structures matched to channel context',
      'Stronger audience resonance and recall',
      'Useful across social, email, and brand campaigns',
    ],
    cta: 'Create Story',
    route: '/stories/create',
    accentFrom: 'from-pink-50',
    accentTo: 'to-rose-50',
    borderColor: 'border-pink-200',
    ctaColor: 'bg-pink-600 hover:bg-pink-700',
  },
  {
    id: 'article',
    icon: 'A',
    category: 'Editorial',
    effortBand: '5-15 Credits',
    outcome: 'High-trust articles with sharper market framing and clarity',
    title: 'Article',
    description: 'Develop more journalistic, perspective-led content with deeper analysis, stronger framing, and executive readability.',
    bullets: [
      'Balanced, research-led content development',
      'Useful for executive and category narratives',
      'Built for credibility, not generic thought leadership',
    ],
    cta: 'Create Article',
    route: '/articles/create',
    accentFrom: 'from-orange-50',
    accentTo: 'to-amber-50',
    borderColor: 'border-orange-200',
    ctaColor: 'bg-orange-600 hover:bg-orange-700',
  },
  {
    id: 'whitepaper',
    icon: 'W',
    category: 'Authority Asset',
    effortBand: '20-40 Credits',
    outcome: 'Long-form assets built for enterprise trust and buyer confidence',
    title: 'Whitepaper',
    description: 'Produce premium authority assets that support enterprise trust, category education, and serious buyer conversations.',
    bullets: [
      'Deeper strategic structure and argumentation',
      'Designed for high-consideration buying journeys',
      'Supports lead generation and sales enablement',
    ],
    cta: 'Create Whitepaper',
    route: '/whitepapers/create',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: 'case-study',
    icon: 'C',
    category: 'Proof',
    effortBand: '10-25 Credits',
    outcome: 'Proof-led customer stories your sales team can reuse',
    title: 'Case Study',
    description: 'Turn customer wins into disciplined proof assets that showcase challenge, intervention, outcomes, and learning.',
    bullets: [
      'Structured for persuasion and credibility',
      'Built around measurable business outcomes',
      'Works across website, sales, and campaign use cases',
    ],
    cta: 'Create Case Study',
    route: '/case-studies/create',
    accentFrom: 'from-teal-50',
    accentTo: 'to-emerald-50',
    borderColor: 'border-teal-200',
    ctaColor: 'bg-teal-600 hover:bg-teal-700',
  },
  {
    id: 'thread',
    icon: 'T',
    category: 'Sequence',
    effortBand: '2-5 Credits',
    outcome: 'Connected thread sequences built for stronger retention',
    title: 'Thread',
    description: 'Create multi-part thread content that moves from hook to payoff with clearer pacing and stronger retention.',
    bullets: [
      'Built for narrative momentum and clarity',
      'Strong fit for thought leadership sequences',
      'Ready for LinkedIn or X thread publishing',
    ],
    cta: 'Create Thread',
    route: '/threads/create',
    accentFrom: 'from-emerald-50',
    accentTo: 'to-green-50',
    borderColor: 'border-emerald-200',
    ctaColor: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    id: 'guide',
    icon: 'G',
    category: 'Pillar Content',
    effortBand: '15-30 Credits',
    outcome: 'Evergreen guides that build authority over time',
    title: 'Guide',
    description: 'Build durable pillar content that teaches clearly, ranks well, and gives buyers a stronger reason to trust your brand.',
    bullets: [
      'Comprehensive educational structure',
      'Useful for SEO, enablement, and owned media',
      'Designed to become a reusable category resource',
    ],
    cta: 'Create Guide',
    route: '/guides/create',
    accentFrom: 'from-violet-50',
    accentTo: 'to-purple-50',
    borderColor: 'border-violet-200',
    ctaColor: 'bg-violet-600 hover:bg-violet-700',
  },
  {
    id: 'newsletter',
    icon: 'N',
    category: 'Audience Nurture',
    effortBand: '3-10 Credits',
    outcome: 'Newsletters with a stronger point of view and clearer value',
    title: 'Newsletter',
    description: 'Develop newsletter content with a clearer editorial stance, sharper structure, and stronger executive usefulness.',
    bullets: [
      'Tailored to insight, brief, strategy, or action modes',
      'Built for modern B2B readership expectations',
      'Designed to support retention and brand authority',
    ],
    cta: 'Create Newsletter',
    route: '/newsletters/create',
    accentFrom: 'from-amber-50',
    accentTo: 'to-yellow-50',
    borderColor: 'border-amber-200',
    ctaColor: 'bg-amber-600 hover:bg-amber-700',
  },
];

export default function WriterContentPage() {
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
          onClick={() => router.push('/command-center/content')}
          className="mb-8 flex items-center gap-2 text-sm text-gray-500 transition-colors hover:text-gray-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Content
        </button>

        <div className="mb-8 rounded-[28px] border border-white/80 bg-white/92 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm md:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_240px] lg:items-end">
            <div className="max-w-3xl">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
                Writer Content
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Create premium text-first content across every writer workflow
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                Choose the writing format that fits the outcome you need. Every path below keeps the current
                writer workflow intact while separating it cleanly from creator-dependent production.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Formats</p>
                <p className="mt-1 text-base font-semibold text-gray-900">9</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Workflow</p>
                <p className="mt-1 text-base font-semibold text-gray-900">Existing</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Best For</p>
              <p className="mt-1 text-sm text-gray-700">Blogs, articles, newsletters, posts, and structured authority content.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Uses</p>
              <p className="mt-1 text-sm text-gray-700">Direct publishing, writer review, campaign launch, and long-form editorial reuse.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Relationship To Creator</p>
              <p className="mt-1 text-sm text-gray-700">Writer outputs can later pull in creator assets as supporting visuals or campaign material.</p>
            </div>
          </div>
        </div>

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Writer Format</p>
            <p className="mt-1 text-sm text-gray-600">Every card below leads into the existing writer content workflow.</p>
          </div>
          <p className="hidden text-sm text-gray-500 md:block">9 writer paths</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CONTENT_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => router.push(card.route)}
              className={`group flex min-h-[500px] cursor-pointer flex-col rounded-[24px] border bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)]`}
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-lg font-semibold text-gray-900 shadow-sm">
                  {card.icon}
                </div>
                <div className="text-right">
                  <span className="inline-flex rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm">
                    {card.category}
                  </span>
                  <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-400">{card.effortBand}</p>
                </div>
              </div>

              <div className="flex h-[126px] flex-col">
                <h2 className="h-[32px] text-xl font-semibold tracking-tight text-gray-900">{card.title}</h2>
                <p className="mt-3 h-[84px] text-sm leading-relaxed text-gray-600">{card.description}</p>
              </div>

              <div className="mt-5 flex h-[74px] flex-col rounded-2xl border border-white/80 bg-white/75 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Primary Outcome</p>
                <p className="mt-1 text-sm font-medium leading-5 text-gray-800">{card.outcome}</p>
              </div>

              <ul className="mt-5 flex h-[102px] flex-col justify-start space-y-2 text-sm">
                {card.bullets.map((b, index) => (
                  <li key={index} className="flex items-start gap-2 text-gray-700">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-900/70" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(card.route);
                }}
                className={`mt-6 w-full rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-colors ${card.ctaColor}`}
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
