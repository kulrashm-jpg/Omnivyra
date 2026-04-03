import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCompanyContext } from '@/components/CompanyContext';

interface ReportHubCard {
  id: string;
  icon: string;
  title: string;
  subtitle: string;
  hook: string;
  priceLabel: string;
  priceTone: 'free' | 'mid' | 'high';
  accent: string;
  borderClass: string;
  route: string;
  cta: string;
  points: Array<{ icon: string; title: string; desc: string }>;
  hidden?: boolean;
}

const REPORT_CARDS: ReportHubCard[] = [
  {
    id: 'snapshot',
    icon: '📊',
    title: 'Digital Authority Snapshot',
    subtitle: 'Free starter report',
    hook: "See exactly what's holding your growth back",
    priceLabel: 'FREE',
    priceTone: 'free',
    accent: 'Recommended',
    borderClass: 'border-green-500 ring-2 ring-green-300 bg-gradient-to-br from-green-50 to-white',
    route: '/reports/digital-authority-snapshot',
    cta: 'Generate Free Report',
    points: [
      { icon: '🎯', title: 'Your visibility vs competitors', desc: 'Know exactly where you rank and why' },
      { icon: '📈', title: 'Your content and authority gaps', desc: "See what's missing from your strategy" },
      { icon: '⚡', title: 'Your biggest quick wins', desc: '5–10 changes that make real impact' },
    ],
  },
  {
    id: 'performance',
    icon: '📱',
    title: 'Performance Intelligence Report',
    subtitle: 'Deep dive into user behavior',
    hook: "Understand what's actually working — and what's not",
    priceLabel: '40–80 Credits',
    priceTone: 'mid',
    accent: 'After Snapshot',
    borderClass: 'border-gray-300 bg-white',
    route: '/reports/performance-intelligence',
    cta: 'Explore Performance Intelligence',
    points: [
      { icon: '👥', title: 'Traffic quality and user behavior', desc: 'Who visits, how they engage, where they leave' },
      { icon: '🔻', title: 'Conversion drop-offs', desc: 'Identify friction points in your funnel' },
      { icon: '📊', title: 'Channel effectiveness', desc: 'Which channels drive real value' },
    ],
  },
  {
    id: 'market',
    icon: '🚀',
    title: 'Market & Growth Intelligence Report',
    subtitle: 'Enterprise-scale competitive analysis',
    hook: 'Know where to invest, what to fix, how to outgrow competitors',
    priceLabel: '80–150 Credits',
    priceTone: 'high',
    accent: 'Strategic Planning',
    borderClass: 'border-gray-300 bg-white',
    route: '/reports/market-growth-intelligence',
    cta: 'Explore Market Intelligence',
    points: [
      { icon: '🏆', title: 'Competitive positioning', desc: 'Your exact position in the market vs all rivals' },
      { icon: '💰', title: 'Budget and campaign direction', desc: 'Where to allocate resources for max ROI' },
      { icon: '📍', title: 'Growth opportunities across channels', desc: 'Untapped markets and expansion paths' },
    ],
  },
  {
    id: 'hidden-future-report',
    icon: '🧪',
    title: 'Predictive Intelligence Lab',
    subtitle: 'Coming soon',
    hook: 'Advanced predictive forecasting',
    priceLabel: 'Hidden',
    priceTone: 'mid',
    accent: 'Internal',
    borderClass: 'border-gray-300 bg-white',
    route: '/reports',
    cta: 'Coming Soon',
    points: [],
    hidden: true,
  },
];

function getPricePillClass(tone: ReportHubCard['priceTone']): string {
  if (tone === 'free') return 'bg-green-500 text-white';
  if (tone === 'mid') return 'bg-purple-500 text-white';
  return 'bg-red-500 text-white';
}

export default function ReportsHubPage() {
  const router = useRouter();
  const { selectedCompanyName } = useCompanyContext();

  const visibleCards = REPORT_CARDS.filter((card) => !card.hidden);

  return (
    <>
      <Head>
        <title>Reports Hub | Omnivyra</title>
        <meta
          name="description"
          content="Choose your report type: free Digital Authority Snapshot, Performance Intelligence, or Market & Growth Intelligence."
        />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="border-b border-gray-200 bg-white sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
            <button
              onClick={() => router.push('/command-center')}
              className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors text-sm"
            >
              ← Back to Command Center
            </button>
            <span className="text-sm text-gray-500">{selectedCompanyName || 'Omnivyra'}</span>
          </div>
        </div>

        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-xs uppercase tracking-widest font-semibold text-gray-500 mb-3">
                Step 1 of your growth analysis
              </p>
              <h1 className="text-5xl font-bold text-gray-900 mb-4">Choose Your Level of Insight</h1>
              <p className="text-gray-600">
                Start with your free Digital Authority Snapshot — or go deeper with premium intelligence.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-7">
              {visibleCards.map((card) => (
                <div
                  key={card.id}
                  onClick={() => router.push(card.route)}
                  role="button"
                  aria-label={card.title}
                  className={`rounded-2xl border-2 p-8 transition-all transform hover:scale-[1.02] hover:shadow-2xl cursor-pointer ${card.borderClass}`}
                >
                  <div className="flex items-start justify-between mb-6">
                    <div className="text-5xl">{card.icon}</div>
                    <div className="flex flex-col items-end gap-2">
                      <span className={`inline-block font-bold px-4 py-2 rounded-full text-sm ${getPricePillClass(card.priceTone)}`}>
                        {card.priceLabel}
                      </span>
                      {card.accent && (
                        <span className="inline-block bg-green-100 text-green-800 font-semibold px-3 py-1 rounded-full text-xs">
                          ⭐ {card.accent}
                        </span>
                      )}
                    </div>
                  </div>

                  <h2 className="text-4xl font-bold text-gray-900 mb-1 leading-tight">{card.title}</h2>
                  <p className="text-sm text-gray-500 mb-5">{card.subtitle}</p>
                  <p className={`text-2xl font-semibold italic mb-6 ${card.id === 'market' ? 'text-red-600' : card.id === 'performance' ? 'text-purple-600' : 'text-green-700'}`}>
                    {card.hook}
                  </p>

                  <div className="space-y-4 mb-8">
                    {card.points.map((point) => (
                      <div key={point.title} className="flex items-start gap-3">
                        <span className="text-xl mt-1">{point.icon}</span>
                        <div>
                          <p className="font-semibold text-gray-900">{point.title}</p>
                          <p className="text-sm text-gray-600">{point.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(card.route);
                    }}
                    className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all transform hover:shadow-lg ${
                      card.id === 'market'
                        ? 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700'
                        : card.id === 'performance'
                          ? 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700'
                          : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700'
                    }`}
                  >
                    {card.cta}
                  </button>
                </div>
              ))}
            </div>

            {/* Free Snapshot Details (restored depth from earlier version) */}
            <div className="mt-14 rounded-2xl border-2 border-green-200 bg-gradient-to-br from-green-50 to-white p-8 md:p-10">
              <div className="text-center mb-8">
                <p className="text-xs uppercase tracking-wider font-semibold text-green-700 mb-2">
                  Free report breakdown
                </p>
                <h2 className="text-3xl font-bold text-gray-900 mb-3">What the Digital Authority Snapshot Covers</h2>
                <p className="text-gray-600 max-w-3xl mx-auto">
                  The free report is not a teaser. It gives a full baseline view of your content performance,
                  authority gaps, and the fastest wins you can apply.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {[
                  {
                    icon: '✓',
                    title: 'Content Blind Spots',
                    desc: 'Topics your audience searches for but your site currently does not cover well.',
                  },
                  {
                    icon: '✓',
                    title: 'Competitive Visibility Gap',
                    desc: 'Where competitors outrank you and what themes they dominate today.',
                  },
                  {
                    icon: '✓',
                    title: 'Keyword Opportunity Clusters',
                    desc: 'Groups of realistic opportunities you can target in the next 60–90 days.',
                  },
                  {
                    icon: '✓',
                    title: 'Authority Signal Weaknesses',
                    desc: 'Areas where trust, topical depth, or consistency can be improved quickly.',
                  },
                  {
                    icon: '✓',
                    title: 'Quick Wins Roadmap',
                    desc: 'Top changes to prioritize first for maximum impact with minimal effort.',
                  },
                  {
                    icon: '✓',
                    title: 'Executive Summary',
                    desc: 'A concise summary your team can use immediately for planning and alignment.',
                  },
                ].map((item) => (
                  <div key={item.title} className="bg-white border border-green-200 rounded-xl p-5">
                    <div className="flex items-start gap-3">
                      <div className="h-7 w-7 rounded-full bg-green-100 text-green-700 font-bold flex items-center justify-center flex-shrink-0">
                        {item.icon}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 mb-1">{item.title}</h3>
                        <p className="text-sm text-gray-600">{item.desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-8 bg-white border border-green-300 rounded-xl p-5">
                <p className="text-sm text-gray-700">
                  <span className="font-bold text-green-700">Free report policy:</span> No payment required for the first Digital Authority Snapshot.
                  Premium reports are paid and credit deduction happens only after form submission and confirmation.
                </p>
              </div>
            </div>

            {/* Sample insight previews */}
            <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <p className="text-xs uppercase text-gray-500 font-semibold mb-2">Sample Insight</p>
                <p className="text-2xl font-bold text-red-600 mb-1">-60%</p>
                <p className="text-sm text-gray-700">Critical topic coverage gap compared to top competitors.</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <p className="text-xs uppercase text-gray-500 font-semibold mb-2">Sample Insight</p>
                <p className="text-2xl font-bold text-orange-600 mb-1">2.5x</p>
                <p className="text-sm text-gray-700">Competitor visibility advantage in your highest-intent segments.</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-5">
                <p className="text-xs uppercase text-gray-500 font-semibold mb-2">Sample Insight</p>
                <p className="text-2xl font-bold text-green-600 mb-1">+340</p>
                <p className="text-sm text-gray-700">Estimated ranking opportunities available with focused execution.</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
