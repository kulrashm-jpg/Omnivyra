import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

type CreatorTypeId =
  | 'carousel'
  | 'image'
  | 'banner'
  | 'infographic'
  | 'pdf'
  | 'slider';

type CreatorCard = {
  id: CreatorTypeId;
  title: string;
  category: string;
  outcome: string;
  description: string;
  bullets: string[];
  cta: string;
  accentFrom: string;
  accentTo: string;
  borderColor: string;
  ctaColor: string;
};

const CREATOR_CARDS: CreatorCard[] = [
  {
    id: 'image',
    title: 'Image',
    category: 'Static Visual',
    outcome: 'Single-image creative built around one clear message or hook',
    description: 'Create a focused visual asset with AI-guided message framing, visual hook, and platform-ready packaging.',
    bullets: [
      'Useful for social, blog support, and campaigns',
      'Strong fit for simple visual communication',
      'Quickest creator-content workflow',
    ],
    cta: 'Create Image',
    accentFrom: 'from-emerald-50',
    accentTo: 'to-teal-50',
    borderColor: 'border-emerald-200',
    ctaColor: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    id: 'carousel',
    title: 'Carousel',
    category: 'Multi-Slide',
    outcome: 'Slide-based content designed for education, authority, and campaign reuse',
    description: 'Develop a structured multi-slide asset with AI support for message sequencing, visual direction, and platform packaging.',
    bullets: [
      'Best for educational and authority-led content',
      'Can later be used in campaign workflows',
      'Supports direct social publishing handoff',
    ],
    cta: 'Create Carousel',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: 'banner',
    title: 'Banner',
    category: 'Promotional',
    outcome: 'Banner-style asset with promotional clarity and clean visual hierarchy',
    description: 'Build banner-led creative for announcements, promotions, and campaign placements using AI-defined copy and visual direction.',
    bullets: [
      'Good for website, campaign, and social use',
      'Single-message high-clarity format',
      'AI can define the brief and packaging',
    ],
    cta: 'Create Banner',
    accentFrom: 'from-orange-50',
    accentTo: 'to-amber-50',
    borderColor: 'border-orange-200',
    ctaColor: 'bg-orange-600 hover:bg-orange-700',
  },
  {
    id: 'infographic',
    title: 'Infographic',
    category: 'Visual Explain',
    outcome: 'Information-dense visual asset structured for clarity and retention',
    description: 'Develop infographic-style creative that turns ideas, data, or process explanations into a clear visual communication asset.',
    bullets: [
      'Best for explainers, frameworks, and stats',
      'Can support long-form content later',
      'Good bridge between writer and creator content',
    ],
    cta: 'Create Infographic',
    accentFrom: 'from-violet-50',
    accentTo: 'to-purple-50',
    borderColor: 'border-violet-200',
    ctaColor: 'bg-violet-600 hover:bg-violet-700',
  },
  {
    id: 'pdf',
    title: 'PDF',
    category: 'Document Asset',
    outcome: 'Document-style content package for distribution, downloads, or campaign use',
    description: 'Create a PDF-oriented asset workflow where AI defines structure, sections, key messaging, and creative packaging.',
    bullets: [
      'Useful for gated content and document-style sharing',
      'Can connect strongly to authority campaigns',
      'Document-first creator path',
    ],
    cta: 'Create PDF',
    accentFrom: 'from-rose-50',
    accentTo: 'to-pink-50',
    borderColor: 'border-rose-200',
    ctaColor: 'bg-rose-600 hover:bg-rose-700',
  },
  {
    id: 'slider',
    title: 'Slider',
    category: 'Presentation Flow',
    outcome: 'Slide-based asset designed for structured presentation and campaign reuse',
    description: 'Develop a slider-style creative flow where AI helps define sequence, hierarchy, and message progression.',
    bullets: [
      'Strong fit for presentation-like communication',
      'Useful for internal and external reuse',
      'Built as a structured multi-block asset',
    ],
    cta: 'Create Slider',
    accentFrom: 'from-sky-50',
    accentTo: 'to-indigo-50',
    borderColor: 'border-sky-200',
    ctaColor: 'bg-sky-600 hover:bg-sky-700',
  },
];

export default function CreatorContentPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-slate-700" />
      </div>
    );
  }

  if (!user?.userId) return null;

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
                Creator Content
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Select the creator content type you want to develop
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                This is the creator lane for AI-supported, creator-dependent assets. Choose the asset family you want
                to build, then move into a guided workflow that collects only the information needed for that format.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Types</p>
                <p className="mt-1 text-base font-semibold text-gray-900">{CREATOR_CARDS.length}</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Workflow</p>
                <p className="mt-1 text-base font-semibold text-gray-900">Structured</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">What Happens Here</p>
              <p className="mt-1 text-sm text-gray-700">First choose the creator content type. The detailed workflow starts only after a card is selected.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">How It Works</p>
              <p className="mt-1 text-sm text-gray-700">Each type has its own question flow so the AI can build a custom output that matches that asset category.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">After Generation</p>
              <p className="mt-1 text-sm text-gray-700">The output can later be used in campaign flow, direct posting, or attached to long-form content as a block or asset.</p>
            </div>
          </div>
        </div>

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Creator Content Type</p>
            <p className="mt-1 text-sm text-gray-600">Each card below opens a dedicated workflow for that creator content type.</p>
          </div>
          <p className="hidden text-sm text-gray-500 md:block">{CREATOR_CARDS.length} creator paths</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {CREATOR_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => router.push(`/command-center/creator-content/${card.id}`)}
              className={`group flex min-h-[500px] cursor-pointer flex-col rounded-[24px] border bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} p-6 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)]`}
            >
              <div className="mb-5 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/80 bg-white/85 text-sm font-semibold text-gray-900 shadow-sm">
                  {card.title.charAt(0)}
                </div>
                <div className="text-right">
                  <span className="inline-flex rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-gray-700 shadow-sm">
                    {card.category}
                  </span>
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
                {card.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2 text-gray-700">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-900/70" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  router.push(`/command-center/creator-content/${card.id}`);
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
