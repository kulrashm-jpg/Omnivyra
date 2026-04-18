import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import { readCampaignSourcePayload } from '../../lib/content/launchCampaignFromContent';

interface CampaignCard {
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

const CAMPAIGN_CARDS: CampaignCard[] = [
  {
    id: 'bolt-text',
    icon: 'T',
    category: 'Text-led',
    effortBand: 'Fast Launch',
    outcome: 'AI-run text campaigns for faster publishing and promotion',
    title: 'BOLT (Text)',
    description: 'Launch AI-driven campaigns using posts, articles, newsletters, and other text-first formats without creator production.',
    bullets: [
      'Built for text-first campaign execution',
      'Moves quickly from strategy to publishing',
      'Works well for consistent B2B distribution',
    ],
    cta: 'Launch BOLT (Text)',
    route: '/command-center/bolt-text-strategy',
    accentFrom: 'from-amber-50',
    accentTo: 'to-yellow-50',
    borderColor: 'border-amber-200',
    ctaColor: 'bg-amber-500 hover:bg-amber-600',
  },
  {
    id: 'bolt-creator',
    icon: 'C',
    category: 'Creator-led',
    effortBand: 'Produced Assets',
    outcome: 'Campaigns built for creator media and production workflows',
    title: 'BOLT (Creator)',
    description: 'Use AI for planning while your team or creators produce videos, reels, carousels, images, and other media assets.',
    bullets: [
      'Best for creator and media-led campaigns',
      'Includes briefs for production alignment',
      'Supports richer format and channel variety',
    ],
    cta: 'Launch BOLT (Creator)',
    route: '/command-center/bolt-creator-strategy',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-500 hover:bg-blue-600',
  },
  {
    id: 'intelligent-mix',
    icon: 'M',
    category: 'Mixed Mode',
    effortBand: 'AI Guided',
    outcome: 'A guided mix of text and creator formats in one campaign',
    title: 'Intelligent Mix',
    description: 'Let AI recommend the right mix of text and creator formats based on goals, audience context, and campaign direction.',
    bullets: [
      'Balances text and creator formats together',
      'Helps choose the right campaign mix faster',
      'Useful when format decisions are still open',
    ],
    cta: 'Start Intelligent Mix',
    route: '/command-center/intelligent-mix-strategy',
    accentFrom: 'from-teal-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-teal-200',
    ctaColor: 'bg-teal-600 hover:bg-teal-700',
  },
  {
    id: 'strategic-campaign',
    icon: 'S',
    category: 'Planner',
    effortBand: 'Full Control',
    outcome: 'Full campaign planning with strategic control and structure',
    title: 'Strategy Mix',
    description: 'Build a more deliberate campaign with control over goals, formats, cadence, channels, and execution planning.',
    bullets: [
      'Best for full campaign planning and control',
      'Supports more deliberate channel orchestration',
      'Useful for structured strategic campaigns',
    ],
    cta: 'Open Strategy Mix',
    route: '/campaign-planner?mode=direct',
    accentFrom: 'from-green-50',
    accentTo: 'to-emerald-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
];

export default function CampaignsSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();
  const sourceContentToken = typeof router.query.sourceContentToken === 'string' ? router.query.sourceContentToken : null;
  const sourcePayload = React.useMemo(() => readCampaignSourcePayload(sourceContentToken), [sourceContentToken]);

  const handleCardClick = React.useCallback((route: string) => {
    if (route.startsWith('/campaign-planner')) {
      void router.push({
        pathname: '/campaign-planner',
        query: sourceContentToken ? { sourceContentToken } : undefined,
      });
      return;
    }

    void router.push({
      pathname: route,
      query: sourceContentToken ? { sourceContentToken } : undefined,
    });
  }, [router, sourceContentToken]);

  React.useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-violet-600" />
      </div>
    );
  }

  if (!user?.userId) return null;

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
                Campaign System
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Launch campaigns across every style
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                Choose the campaign path that fits the execution model you need. Each route is structured to feel
                consistent, controlled, and aligned to serious B2B campaign planning.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Campaign Modes</p>
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
              <p className="mt-1 text-sm text-gray-700">Teams choosing between text-only, creator-led, mixed, or full-planning campaign execution.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
              <p className="mt-1 text-sm text-gray-700">Each path helps teams choose the right execution model before planning begins.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
              <p className="mt-1 text-sm text-gray-700">Professional campaign workflows built for structured planning, delivery, and brand consistency.</p>
            </div>
          </div>
        </div>

        {sourcePayload ? (
          <div className="mb-6 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">Campaign Source</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{sourcePayload.title}</p>
            <p className="mt-1 text-sm text-gray-600">
              We&apos;ll carry this {sourcePayload.contentType} into the campaign mode you choose so the core idea stays prefilled.
            </p>
          </div>
        ) : null}

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Campaign Type</p>
            <p className="mt-1 text-sm text-gray-600">Every card below leads into a more deliberate campaign planning path with stronger information hierarchy.</p>
          </div>
          <p className="hidden text-sm text-gray-500 md:block">4 campaign paths</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {CAMPAIGN_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => handleCardClick(card.route)}
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
                {card.bullets.map((bullet, index) => (
                  <li key={index} className="flex items-start gap-2 text-gray-700">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-gray-900/70" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={(event) => {
                  event.stopPropagation();
                  handleCardClick(card.route);
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
