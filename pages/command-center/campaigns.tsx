/**
 * Command Center → Launch Campaigns
 *
 * Layout:
 *   Row 1 — BOLT trio (3 columns): Text | Creator | Combined
 *   Row 2 — Other modes (2 columns): Recommend Mix | Strategic Campaign
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

interface CampaignCard {
  id: string;
  icon: string;
  badge?: string;
  badgeColor?: string;
  title: string;
  subtitle: string;
  description: string;
  bullets: string[];
  cta: string;
  route: string;
  accentFrom: string;
  accentTo: string;
  borderColor: string;
  ctaColor: string;
}

const BOLT_CARDS: CampaignCard[] = [
  {
    id: 'bolt-text',
    icon: '✍️',
    badge: 'AI Automated',
    badgeColor: 'bg-amber-100 text-amber-800',
    title: 'BOLT (Text)',
    subtitle: 'Text-only campaign',
    description: 'Fully AI-driven campaign using text formats — posts, articles, newsletters, and more. No creator asset required.',
    bullets: [
      'Posts, articles, newsletters, white papers',
      'Auto-scheduled across text platforms',
      'End-to-end AI content generation',
    ],
    cta: 'Launch BOLT (Text)',
    route: '/command-center/bolt-text-strategy',
    accentFrom: 'from-amber-50',
    accentTo: 'to-yellow-50',
    borderColor: 'border-amber-300',
    ctaColor: 'bg-amber-500 hover:bg-amber-600',
  },
  {
    id: 'bolt-creator',
    icon: '🎬',
    badge: 'Creator Required',
    badgeColor: 'bg-blue-100 text-blue-800',
    title: 'BOLT (Creator)',
    subtitle: 'Creator-dependent campaign',
    description: 'AI plans the strategy, your creators produce the media. Videos, reels, carousels, and visual content.',
    bullets: [
      'Video, reel, carousel, image, podcast',
      'YouTube, TikTok, Instagram, LinkedIn',
      'Creator workflow with production brief',
    ],
    cta: 'Launch BOLT (Creator)',
    route: '/command-center/bolt-creator-strategy',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-300',
    ctaColor: 'bg-blue-500 hover:bg-blue-600',
  },
  {
    id: 'bolt-combined',
    icon: '🔀',
    badge: 'AI + Creator',
    badgeColor: 'bg-violet-100 text-violet-800',
    title: 'BOLT (Combined)',
    subtitle: 'Text + creator campaign',
    description: 'Run text-based AI content alongside creator-produced media in one coordinated campaign.',
    bullets: [
      'Mix text and creator formats freely',
      'All platforms — text and video-first',
      'Single AI strategy, dual execution',
    ],
    cta: 'Launch BOLT (Combined)',
    route: '/command-center/bolt-combined-strategy',
    accentFrom: 'from-violet-50',
    accentTo: 'to-purple-50',
    borderColor: 'border-violet-300',
    ctaColor: 'bg-violet-500 hover:bg-violet-600',
  },
];

const OTHER_CARDS: CampaignCard[] = [
  {
    id: 'recommend-mix',
    icon: '💡',
    badge: 'Data-Driven',
    badgeColor: 'bg-emerald-100 text-emerald-800',
    title: 'Recommend',
    subtitle: 'Mix Mode',
    description: 'AI-curated content mix based on your audience insights, performance data, and market trends.',
    bullets: [
      'Personalised content recommendations',
      'Optimal channel-format pairings',
      'Continuously adapts to performance',
    ],
    cta: 'View Recommendations',
    route: '/recommendations',
    accentFrom: 'from-emerald-50',
    accentTo: 'to-teal-50',
    borderColor: 'border-emerald-200',
    ctaColor: 'bg-emerald-600 hover:bg-emerald-700',
  },
  {
    id: 'strategic-campaign',
    icon: '🎯',
    badge: 'Full Control',
    badgeColor: 'bg-green-100 text-green-800',
    title: 'Strategic Campaign',
    subtitle: 'Full Planning',
    description: 'Build comprehensive multi-channel campaigns with complete control over strategy and execution.',
    bullets: [
      'Full campaign planning and briefing',
      'Multi-channel calendar and scheduling',
      'OKR and goal tracking built-in',
    ],
    cta: 'Plan Campaign',
    route: '/campaign-planner',
    accentFrom: 'from-green-50',
    accentTo: 'to-teal-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
];

function Card({ card, onClick }: { card: CampaignCard; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-xl p-5 border-2 cursor-pointer hover:shadow-xl hover:scale-105 transition-all bg-gradient-to-br ${card.accentFrom} via-white ${card.accentTo} ${card.borderColor} flex flex-col`}
    >
      <div className="flex items-start justify-between mb-4">
        <span className="text-4xl">{card.icon}</span>
        {card.badge && (
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${card.badgeColor}`}>{card.badge}</span>
        )}
      </div>
      <h2 className="text-lg font-bold text-gray-900 mb-0.5">{card.title}</h2>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{card.subtitle}</p>
      <p className="text-sm text-gray-600 mb-4 flex-1">{card.description}</p>
      <ul className="space-y-1.5 mb-5 text-sm">
        {card.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-gray-700">
            <span className="text-green-500 font-bold mt-0.5">•</span>{b}
          </li>
        ))}
      </ul>
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`w-full py-2.5 ${card.ctaColor} text-white text-sm font-semibold rounded-lg transition-colors shadow-sm`}
      >
        {card.cta} →
      </button>
    </div>
  );
}

export default function CampaignsSubPage() {
  const router = useRouter();
  const { user, authChecked, isLoading } = useCompanyContext();

  React.useEffect(() => {
    if (authChecked && !user?.userId) router.replace('/login');
  }, [authChecked, user?.userId, router]);

  if (!authChecked || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600" />
      </div>
    );
  }
  if (!user?.userId) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
      <div className="max-w-5xl mx-auto">

        {/* Back */}
        <button onClick={() => router.push('/command-center')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-800 mb-8 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Command Center
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🚀</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Launch Campaigns</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Choose your campaign execution mode. BOLT automates strategy and planning — pick the content mix that fits your team.
          </p>
        </div>

        {/* BOLT trio */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-base font-bold text-gray-800">⚡ BOLT Campaigns</span>
            <span className="text-xs text-gray-400">— AI-planned, strategy-first</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {BOLT_CARDS.map((card) => (
              <Card key={card.id} card={card} onClick={() => router.push(card.route)} />
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Other modes</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        {/* Other two */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {OTHER_CARDS.map((card) => (
            <Card key={card.id} card={card} onClick={() => router.push(card.route)} />
          ))}
        </div>

      </div>
    </div>
  );
}
