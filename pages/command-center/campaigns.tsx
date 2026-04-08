/**
 * Command Center → Launch Campaigns
 *
 * 4 campaign modes in a 2×2 grid:
 *   BOLT (Text)    |  BOLT (Creator)
 *   Intelligent Mix |  Strategic Campaign
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';
import { readCampaignSourcePayload } from '../../lib/content/launchCampaignFromContent';

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

const CAMPAIGN_CARDS: CampaignCard[] = [
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
    id: 'intelligent-mix',
    icon: '🤖',
    badge: 'AI Chat',
    badgeColor: 'bg-teal-100 text-teal-800',
    title: 'Intelligent Mix',
    subtitle: 'AI-guided mixed campaign',
    description: 'Conversational AI advisor that recommends the right blend of text and creator content based on your goals, audience, and performance data.',
    bullets: [
      'Text + creator formats in one campaign',
      'AI chat drives strategy and format mix',
      'Adapts to audience insights and trends',
    ],
    cta: 'Start AI Conversation',
    route: '/command-center/intelligent-mix-strategy',
    accentFrom: 'from-teal-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-teal-300',
    ctaColor: 'bg-teal-600 hover:bg-teal-700',
  },
  {
    id: 'strategic-campaign',
    icon: '🎯',
    badge: 'Full Control',
    badgeColor: 'bg-green-100 text-green-800',
    title: 'Strategic Campaign',
    subtitle: 'Full planning mode',
    description: 'Build comprehensive multi-channel campaigns with complete control over strategy, formats, and execution.',
    bullets: [
      'Full campaign planning and briefing',
      'Multi-channel calendar and scheduling',
      'OKR and goal tracking built-in',
    ],
    cta: 'Plan Campaign',
    route: '/campaign-planner?mode=direct',
    accentFrom: 'from-green-50',
    accentTo: 'to-emerald-50',
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
  const sourceContentToken = typeof router.query.sourceContentToken === 'string' ? router.query.sourceContentToken : null;
  const sourcePayload = React.useMemo(
    () => readCampaignSourcePayload(sourceContentToken),
    [sourceContentToken],
  );

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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600" />
      </div>
    );
  }
  if (!user?.userId) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 py-8 px-3 sm:px-4 lg:px-6">
      <div className="max-w-4xl mx-auto">

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
          <p className="text-gray-500 max-w-lg mx-auto">
            Choose how you want to run your campaign. Each mode is optimised for a different execution style.
          </p>
        </div>

        {sourcePayload && (
          <div className="mb-8 rounded-2xl border border-indigo-200 bg-indigo-50 px-5 py-4 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-700">Campaign Source</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{sourcePayload.title}</p>
            <p className="mt-1 text-sm text-gray-600">
              We’ll carry this {sourcePayload.contentType} into the campaign mode you choose so the core idea stays prefilled.
            </p>
          </div>
        )}

        {/* 2×2 grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {CAMPAIGN_CARDS.map((card) => (
            <Card key={card.id} card={card} onClick={() => handleCardClick(card.route)} />
          ))}
        </div>

      </div>
    </div>
  );
}
