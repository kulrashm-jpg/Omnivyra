/**
 * Command Center → Create Content Sub-page
 *
 * Shown when user clicks the "Create Content" card on the Command Center.
 * Presents 4 content format cards: Blog, Story, Whitepaper, Post.
 */

import React from 'react';
import { useRouter } from 'next/router';
import { useCompanyContext } from '../../components/CompanyContext';

interface ContentCard {
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

const CONTENT_CARDS: ContentCard[] = [
  {
    id: 'blog',
    icon: '✍️',
    badge: '5–15 Credits',
    badgeColor: 'bg-purple-100 text-purple-800',
    title: 'Blog',
    description: 'Write long-form SEO-optimized articles that rank, educate, and convert your target audience.',
    bullets: [
      'AI-assisted topic research and outlines',
      'SEO scoring and keyword suggestions',
      'Publish directly to your company blog',
    ],
    cta: 'Create Blog',
    route: '/blogs',
    accentFrom: 'from-purple-50',
    accentTo: 'to-indigo-50',
    borderColor: 'border-purple-200',
    ctaColor: 'bg-purple-600 hover:bg-purple-700',
  },
  {
    id: 'story',
    icon: '📖',
    badge: '3–8 Credits',
    badgeColor: 'bg-pink-100 text-pink-800',
    title: 'Story',
    description: 'Craft compelling stories that connect with your audience across social media and email.',
    bullets: [
      'Brand-voice aligned story formats',
      'Optimized for social engagement',
      'Multi-platform story adaptation',
    ],
    cta: 'Create Story',
    route: '/content-studio/story',
    accentFrom: 'from-pink-50',
    accentTo: 'to-rose-50',
    borderColor: 'border-pink-200',
    ctaColor: 'bg-pink-600 hover:bg-pink-700',
  },
  {
    id: 'whitepaper',
    icon: '📄',
    badge: '20–40 Credits',
    badgeColor: 'bg-blue-100 text-blue-800',
    title: 'Whitepaper',
    description: 'Develop authoritative whitepapers to showcase expertise, generate leads, and build credibility.',
    bullets: [
      'In-depth research and data synthesis',
      'Professional formatting and layout',
      'Gated download lead generation ready',
    ],
    cta: 'Create Whitepaper',
    route: '/content-studio/whitepaper',
    accentFrom: 'from-blue-50',
    accentTo: 'to-cyan-50',
    borderColor: 'border-blue-200',
    ctaColor: 'bg-blue-600 hover:bg-blue-700',
  },
  {
    id: 'post',
    icon: '📱',
    badge: '1–5 Credits',
    badgeColor: 'bg-green-100 text-green-800',
    title: 'Post',
    description: 'Compose high-impact social media posts for LinkedIn, Instagram, Twitter, and more — instantly.',
    bullets: [
      'Platform-specific tone and formatting',
      'Hashtag and engagement optimization',
      'Schedule and publish in one click',
    ],
    cta: 'Create Post',
    route: '/content-studio/post',
    accentFrom: 'from-green-50',
    accentTo: 'to-teal-50',
    borderColor: 'border-green-200',
    ctaColor: 'bg-green-600 hover:bg-green-700',
  },
];

export default function CreateContentSubPage() {
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
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600" />
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
          <div className="text-5xl mb-3">✍️</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Content</h1>
          <p className="text-gray-500 max-w-xl mx-auto">
            Turn insights into impact. Choose a content format and start creating content your audience is
            searching for.
          </p>
        </div>

        {/* Cards — 2×2 responsive grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {CONTENT_CARDS.map((card) => (
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
                    <span className="text-purple-500 font-bold mt-0.5">•</span>
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
