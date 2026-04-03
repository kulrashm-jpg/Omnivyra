/**
 * Command Center → Engagement Center Sub-page
 *
 * Shown when user clicks the "Engagement Center" (4th) card on the Command Center.
 * Presents 4 cards: Engagement Center, Market Pulse, Active Leads, Intelligence.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

interface EngagementCard {
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
  ctaColor: string;
}

const ENGAGEMENT_CARDS: EngagementCard[] = [
  {
    id: 'engagement-center',
    icon: '💬',
    badge: 'Live',
    badgeColor: 'bg-green-100 text-green-800',
    title: 'Engagement Center',
    description: 'Monitor conversations, reply to comments, and connect with your community in real time.',
    bullets: [
      'Unified inbox across all platforms',
      'AI-suggested replies and responses',
      'Sentiment tracking and priority alerts',
    ],
    cta: 'Open Engagement Center',
    route: '/community-ai',
    accentFrom: 'from-orange-50',
    accentTo: 'to-amber-50',
    borderColor: 'border-orange-200',
    ctaColor: 'bg-orange-500 hover:bg-orange-600',
  },
  {
    id: 'market-pulse',
    icon: '📡',
    badge: 'Real-time',
    badgeColor: 'bg-blue-100 text-blue-800',
    title: 'Market Pulse',
    description: 'Track market trends, competitor activity, and industry signals as they happen.',
    bullets: [
      'Real-time competitor content tracking',
      'Emerging trend identification',
      'Actionable market opportunity alerts',
    ],
    cta: 'View Market Pulse',
    route: '/market-analysis',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: 'active-leads',
    icon: '🎯',
    badge: 'CRM',
    badgeColor: 'bg-purple-100 text-purple-800',
    title: 'Active Leads',
    description: 'Manage and nurture high-intent leads generated from your content and campaigns.',
    bullets: [
      'Content-driven lead capture and scoring',
      'Lead nurture sequences and follow-ups',
      'Integration-ready for your CRM',
    ],
    cta: 'View Active Leads',
    route: '/leads',
    accentFrom: 'from-purple-50',
    accentTo: 'to-violet-50',
    borderColor: 'border-purple-200',
    ctaColor: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: 'intelligence',
    icon: '🧠',
    badge: 'AI Insights',
    badgeColor: 'bg-indigo-100 text-indigo-800',
    title: 'Intelligence',
    description: 'Access deep AI-powered marketing intelligence, strategic insights, and growth recommendations.',
    bullets: [
      'Predictive content performance scoring',
      'Strategic gap analysis',
      'Weekly AI-generated intelligence briefs',
    ],
    cta: 'Open Intelligence',
    route: '/marketing-intelligence',
    accentFrom: 'from-indigo-50',
    accentTo: 'to-slate-50',
    borderColor: 'border-indigo-200',
    ctaColor: 'bg-indigo-600 hover:bg-indigo-700',
  },
];

export default function EngagementSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !user?.userId) {
      router.replace('/login');
    }
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500" />
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
          <div className="text-5xl mb-3">💬</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Engagement & Intelligence</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Monitor your community, track the market, manage leads, and access deep AI-powered intelligence
            to stay ahead of the competition.
          </p>
        </div>

        {/* Cards — 2×2 responsive grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {ENGAGEMENT_CARDS.map((card) => (
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
                    <span className="text-orange-500 font-bold mt-0.5">•</span>
                    {b}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={(e) => { e.stopPropagation(); router.push(card.route); }}
                className={`w-full py-2.5 ${card.ctaColor} text-white text-sm font-semibold rounded-lg transition-colors shadow-sm`}
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
