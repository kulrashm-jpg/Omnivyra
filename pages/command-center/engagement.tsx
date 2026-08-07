import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import CreatorConversionSummary from '@/components/engagement/CreatorConversionSummary';
import PageLoader from '../../components/PageLoader';

interface EngagementCard {
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

const ENGAGEMENT_CARDS: EngagementCard[] = [
  {
    id: 'engagement-center',
    icon: 'E',
    category: 'Inbox',
    effortBand: 'Live Response',
    outcome: 'One place to monitor conversations and respond faster',
    title: 'Engagement Center',
    description: 'Monitor conversations, reply to comments, and coordinate community response from a single live workspace.',
    bullets: [
      'Built for real-time conversation handling',
      'Keeps response work in one shared place',
      'Helps teams act faster on engagement',
    ],
    cta: 'Open Engagement Center',
    route: '/engagement',
    accentFrom: 'from-orange-50',
    accentTo: 'to-amber-50',
    borderColor: 'border-orange-200',
    ctaColor: 'bg-orange-500 hover:bg-orange-600',
  },
  {
    id: 'market-pulse',
    icon: 'M',
    category: 'Signals',
    effortBand: 'Real-Time',
    outcome: 'A live view of market signals, trends, and shifts',
    title: 'Market Pulse',
    description: 'Track competitor activity, trend movement, and emerging market signals that shape content and campaign timing.',
    bullets: [
      'Best for trend and market awareness',
      'Surfaces movement that needs attention',
      'Supports faster strategic response',
    ],
    cta: 'Open Market Pulse',
    route: '/dashboard/intelligence?intelTab=market-pulse',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: 'active-leads',
    icon: 'L',
    category: 'Leads',
    effortBand: 'Lead Ops',
    outcome: 'A clearer workspace for active leads and follow-up',
    title: 'Active Leads',
    description: 'Review higher-intent leads generated from content and campaigns, then move them into more structured follow-up.',
    bullets: [
      'Best for lead review and prioritization',
      'Connects content activity to lead handling',
      'Supports structured follow-up planning',
    ],
    cta: 'Open Active Leads',
    route: '/command-center/active-leads',
    accentFrom: 'from-purple-50',
    accentTo: 'to-violet-50',
    borderColor: 'border-purple-200',
    ctaColor: 'bg-purple-600 hover:bg-purple-700',
  },
  // BETA-008 (RULE 8): the "Intelligence" hub card (→ /intelligence) was removed for Beta —
  // that page is an admin-gated shell. Market Pulse + Active Leads cover the real surfaces.
];

export default function EngagementSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !isLoading && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, isLoading, user?.userId, router]);

  if (!authChecked || isLoading) {
    return <PageLoader message="Loading your workspace…" />;
  }

  if (!user?.userId) return <PageLoader message="Redirecting…" statuses={[]} />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 px-3 py-8 sm:px-4 lg:px-6">
      <div className="mx-auto max-w-[1500px]">
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
                Engagement System
              </p>
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                Manage engagement and intelligence
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                Choose the workspace that fits the activity you need. Each path is designed to feel consistent,
                executive-ready, and strong enough for ongoing engagement, monitoring, and intelligence review.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Workspaces</p>
                <p className="mt-1 text-base font-semibold text-gray-900">3</p>
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
              <p className="mt-1 text-sm text-gray-700">Teams handling live engagement, monitoring signals, active leads, and broader intelligence review.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
              <p className="mt-1 text-sm text-gray-700">Each path helps teams enter the right engagement or intelligence workflow with less ambiguity.</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
              <p className="mt-1 text-sm text-gray-700">Professional workspaces built for faster response, better visibility, and more structured marketing decisions.</p>
            </div>
          </div>
        </div>

        {/* Discovery hook — surfaces creator-driven conversion outcomes at the
            engagement hub and links into the full card. Reuses the existing
            /api/engagement/creator-conversion endpoint; self-fetches company. */}
        <div className="mb-8">
          <CreatorConversionSummary className="max-w-md" />
        </div>

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select An Engagement Type</p>
            <p className="mt-1 text-sm text-gray-600">Every card below leads into a more deliberate engagement or intelligence path with stronger information hierarchy.</p>
          </div>
          <p className="hidden text-sm text-gray-500 md:block">3 engagement paths</p>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {ENGAGEMENT_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => router.push(card.route)}
              className={`group flex min-h-[500px] cursor-pointer flex-col rounded-[24px] border bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.10)] xl:p-6`}
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

              <div className="flex flex-col">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">{card.title}</h2>
                <p className="mt-3 min-h-[84px] text-sm leading-relaxed text-gray-600">{card.description}</p>
              </div>

              <div className="mt-5 flex min-h-[74px] flex-col rounded-2xl border border-white/80 bg-white/75 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Primary Outcome</p>
                <p className="mt-1 text-sm font-medium leading-5 text-gray-800">{card.outcome}</p>
              </div>

              <ul className="mt-5 flex min-h-[102px] flex-col justify-start space-y-2 text-sm">
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
                  router.push(card.route);
                }}
                className={`mt-auto w-full rounded-xl px-3 py-3 text-sm font-semibold text-white shadow-sm transition-colors ${card.ctaColor}`}
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
