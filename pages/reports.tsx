import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';

interface ReportHubCard {
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
  hidden?: boolean;
}

const REPORT_CARDS: ReportHubCard[] = [
  {
    id: 'snapshot',
    icon: 'S',
    category: 'Starter',
    effortBand: 'Free',
    outcome: 'A baseline report that shows gaps, priorities, and quick wins',
    title: 'Digital Authority Snapshot',
    description: 'Start with a focused baseline on visibility, authority, and the fastest improvements your team should prioritize first.',
    bullets: [
      'Best for a first baseline and quick diagnosis',
      'Highlights visibility, authority, and content gaps',
      'Useful for planning the next set of actions',
    ],
    cta: 'Generate Report',
    route: '/reports/digital-authority-snapshot',
    accentFrom: 'from-green-50',
    accentTo: 'to-emerald-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
  {
    id: 'performance',
    icon: 'P',
    category: 'Behavior',
    effortBand: '40-80 Credits',
    outcome: 'A deeper view of performance, behavior, and conversion friction',
    title: 'Performance Intelligence',
    description: 'Go deeper into how visitors behave, where friction shows up, and which channels are actually contributing value.',
    bullets: [
      'Best for performance and behavior analysis',
      'Helps surface funnel and engagement friction',
      'Useful for sharper optimization decisions',
    ],
    cta: 'Open Performance Report',
    route: '/reports/performance-intelligence',
    accentFrom: 'from-purple-50',
    accentTo: 'to-indigo-50',
    borderColor: 'border-purple-200',
    ctaColor: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: 'market',
    icon: 'M',
    category: 'Strategic',
    effortBand: '80-150 Credits',
    outcome: 'A strategic report for positioning, growth direction, and investment',
    title: 'Market & Growth Intelligence',
    description: 'Use a more strategic report to understand positioning, market direction, competitive pressure, and growth priorities.',
    bullets: [
      'Best for strategic market-level planning',
      'Highlights positioning and growth opportunities',
      'Useful for bigger allocation decisions',
    ],
    cta: 'Open Market Report',
    route: '/reports/market-growth-intelligence',
    accentFrom: 'from-red-50',
    accentTo: 'to-orange-50',
    borderColor: 'border-red-200',
    ctaColor: 'bg-red-600 hover:bg-red-700',
  },
  {
    id: 'hidden-future-report',
    icon: 'H',
    category: 'Hidden',
    effortBand: 'Hidden',
    outcome: 'Internal only',
    title: 'Predictive Intelligence Lab',
    description: 'Internal placeholder.',
    bullets: [],
    cta: 'Hidden',
    route: '/reports',
    accentFrom: 'from-gray-50',
    accentTo: 'to-white',
    borderColor: 'border-gray-200',
    ctaColor: 'bg-gray-600 hover:bg-gray-700',
    hidden: true,
  },
];

const SNAPSHOT_DETAILS = [
  {
    title: 'Content Blind Spots',
    desc: 'Topics your audience searches for but your site currently does not cover well.',
  },
  {
    title: 'Competitive Visibility Gap',
    desc: 'Where competitors outrank you and what themes they dominate today.',
  },
  {
    title: 'Keyword Opportunity Clusters',
    desc: 'Groups of realistic opportunities you can target in the next 60-90 days.',
  },
  {
    title: 'Authority Signal Weaknesses',
    desc: 'Areas where trust, topical depth, or consistency can be improved quickly.',
  },
  {
    title: 'Quick Wins Roadmap',
    desc: 'Top changes to prioritize first for maximum impact with minimal effort.',
  },
  {
    title: 'Executive Summary',
    desc: 'A concise summary your team can use immediately for planning and alignment.',
  },
];

const SAMPLE_INSIGHTS = [
  { value: '-60%', tone: 'text-red-600', desc: 'Critical topic coverage gap compared to top competitors.' },
  { value: '2.5x', tone: 'text-orange-600', desc: 'Competitor visibility advantage in your highest-intent segments.' },
  { value: '+340', tone: 'text-green-600', desc: 'Estimated ranking opportunities available with focused execution.' },
];

export default function ReportsHubPage() {
  const router = useRouter();
  const { selectedCompanyName } = useCompanyContext();
  const visibleCards = REPORT_CARDS.filter((card) => !card.hidden);

  return (
    <>
      <Head>
        <title>Reports Hub | OmniVyra</title>
        <meta
          name="description"
          content="Choose your report type: Digital Authority Snapshot, Performance Intelligence, or Market & Growth Intelligence."
        />
      </Head>

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
                  Report System
                </p>
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                  Choose the report depth you need
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 md:text-base">
                  Start with a focused baseline or move into deeper intelligence. Each path is designed to feel
                  consistent, executive-ready, and useful for teams making real planning decisions.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 lg:w-[240px]">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Report Types</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{visibleCards.length}</p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-3.5 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Workspace</p>
                  <p className="mt-1 text-base font-semibold text-gray-900">{selectedCompanyName || 'OmniVyra'}</p>
                </div>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Designed For</p>
                <p className="mt-1 text-sm text-gray-700">Teams moving from first baseline diagnostics into performance and strategic intelligence.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Decision Quality</p>
                <p className="mt-1 text-sm text-gray-700">Each path helps teams choose the right depth of insight before committing time or credits.</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Output Standard</p>
                <p className="mt-1 text-sm text-gray-700">Professional reports built for clearer analysis, stronger planning, and executive-level review.</p>
              </div>
            </div>
          </div>

          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Select A Report Type</p>
              <p className="mt-1 text-sm text-gray-600">Every card below leads into a more deliberate reporting path with stronger information hierarchy.</p>
            </div>
            <p className="hidden text-sm text-gray-500 md:block">{visibleCards.length} report paths</p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {visibleCards.map((card) => (
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
                  <h2 className="h-[56px] text-xl font-semibold tracking-tight text-gray-900">{card.title}</h2>
                  <p className="mt-3 h-[56px] text-sm leading-relaxed text-gray-600">{card.description}</p>
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
                    router.push(card.route);
                  }}
                  className={`mt-6 w-full rounded-xl py-3 text-sm font-semibold text-white shadow-sm transition-colors ${card.ctaColor}`}
                >
                  {card.cta}
                </button>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-[28px] border border-green-200 bg-gradient-to-br from-green-50 to-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.05)] md:p-8">
            <div className="mb-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-green-700">Free Report Breakdown</p>
              <h2 className="mt-1 text-2xl font-semibold text-gray-900">What the Digital Authority Snapshot Covers</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                The free report is a real baseline, not just a teaser. It gives a clear view of your content performance,
                authority gaps, and the fastest wins your team can act on first.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {SNAPSHOT_DETAILS.map((item) => (
                <div key={item.title} className="rounded-2xl border border-green-200 bg-white px-4 py-4">
                  <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-green-300 bg-white px-4 py-4">
              <p className="text-sm text-gray-700">
                <span className="font-semibold text-green-700">Free report policy:</span> Your first Digital Authority Snapshot does not require payment.
                Premium reports use credits after submission and confirmation.
              </p>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            {SAMPLE_INSIGHTS.map((item) => (
              <div key={item.value} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Sample Insight</p>
                <p className={`mt-2 text-2xl font-semibold ${item.tone}`}>{item.value}</p>
                <p className="mt-1 text-sm text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
