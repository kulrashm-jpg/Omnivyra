/**
 * Command Center → Connect Readiness Sub-page
 *
 * Shown when user clicks the "Content Readiness Score" card on the Command Center.
 * Presents 3 report cards to choose from.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

interface ReportCard {
  id: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
  title: string;
  description: string;
  bullets: string[];
  cta: string;
  route: string;
  accentFrom: string;
  accentTo: string;
  borderColor: string;
}

const REPORT_CARDS: ReportCard[] = [
  {
    id: 'content-readiness',
    icon: '📊',
    badge: 'FREE for first use',
    badgeColor: 'bg-green-100 text-green-800',
    title: 'Content Readiness Report',
    description: 'Is your content actually ready to rank and convert? Get a comprehensive analysis of your digital presence.',
    bullets: [
      'Reveals gaps in your content strategy',
      'Identifies high-value topics you\'re missing',
      'Quick wins you can implement today',
    ],
    cta: 'Generate Report',
    route: '/reports/content-readiness',
    accentFrom: 'from-blue-50',
    accentTo: 'to-purple-50',
    borderColor: 'border-blue-200',
  },
  {
    id: 'market-growth',
    icon: '📈',
    badge: 'Growth Insights',
    badgeColor: 'bg-emerald-100 text-emerald-800',
    title: 'Market Growth Intelligence',
    description: 'Understand market trends and growth opportunities specific to your sector and target audience.',
    bullets: [
      'Maps your market position vs. competitors',
      'Surfaces emerging demand signals early',
      'Pinpoints untapped growth pockets',
    ],
    cta: 'View Market Report',
    route: '/reports/market-growth-intelligence',
    accentFrom: 'from-emerald-50',
    accentTo: 'to-teal-50',
    borderColor: 'border-emerald-200',
  },
  {
    id: 'performance-intelligence',
    icon: '🎯',
    badge: 'Performance Metrics',
    badgeColor: 'bg-orange-100 text-orange-800',
    title: 'Performance Intelligence',
    description: 'Track how your content and campaigns are performing over time with in-depth analytics.',
    bullets: [
      'Tracks performance across all channels',
      'Highlights what\'s working and what isn\'t',
      'Actionable improvement recommendations',
    ],
    cta: 'View Performance Report',
    route: '/reports/performance-intelligence',
    accentFrom: 'from-orange-50',
    accentTo: 'to-amber-50',
    borderColor: 'border-orange-200',
  },
];

export default function ReadinessSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  // Auth guard
  React.useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user?.userId) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
      <div className="max-w-5xl mx-auto">

        {/* Back button */}
        <button
          onClick={() => router.push('/command-center')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-8 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Command Center
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">📊</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Connect Readiness</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Choose a report to analyze your content, market position, and performance. Each report gives you
            actionable insights to grow faster.
          </p>
        </div>

        {/* Cards — 3-column responsive grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {REPORT_CARDS.map((card) => (
            <div
              key={card.id}
              onClick={() => router.push(card.route)}
              className={`rounded-xl p-5 border-2 cursor-pointer hover:shadow-xl hover:scale-105 transition-all bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} flex flex-col`}
            >
              {/* Icon + badge */}
              <div className="flex items-start justify-between mb-4">
                <span className="text-4xl">{card.icon}</span>
                {card.badge && (
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${card.badgeColor}`}>
                    {card.badge}
                  </span>
                )}
              </div>

              {/* Title + description */}
              <h2 className="text-lg font-bold text-gray-900 mb-2">{card.title}</h2>
              <p className="text-sm text-gray-600 mb-4 flex-1">{card.description}</p>

              {/* Bullets */}
              <ul className="space-y-1.5 mb-5 text-sm">
                {card.bullets.map((b, i) => (
                  <li key={i} className="flex items-start gap-2 text-gray-700">
                    <span className="text-blue-500 font-bold mt-0.5">•</span>
                    {b}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={(e) => { e.stopPropagation(); router.push(card.route); }}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                {card.cta} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
