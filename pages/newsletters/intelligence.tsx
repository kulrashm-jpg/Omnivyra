'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowRight, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import AIBlogCardModal from '../../components/blog/AIBlogCardModal';
import { getNewsletterEngineConfig } from '../../lib/newsletter/newsletterContentEngine';

type ExistingNewsletter = {
  id: string;
  title: string;
  slug: string | null;
};

type RecommendationCard = {
  topic: string;
  reason: string;
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  priority: 'high' | 'medium' | 'low';
};

const PRIORITY_STYLES = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
} as const;

function buildDefaultRecommendations(format: string | null | undefined): RecommendationCard[] {
  switch (format) {
    case 'insight-letter':
      return [
        { topic: 'The hidden assumption shaping your market', reason: 'A strong insight letter starts with a deep reframing, not a recap. This topic lets you challenge default thinking and build a memorable point of view.', intent: 'authority', priority: 'high' },
        { topic: 'Why the obvious strategy is quietly breaking down', reason: 'This is ideal for a contrarian hook followed by deeper analysis and implication.', intent: 'authority', priority: 'high' },
        { topic: 'The mental model serious operators should borrow from another industry', reason: 'Cross-domain analogies are a great fit for newsletter readers who want original thinking, not summaries.', intent: 'awareness', priority: 'medium' },
      ];
    case 'weekly-brief':
      return [
        { topic: 'This week’s most important AI workflow signals', reason: 'A weekly brief should surface the few meaningful signals that deserve attention and explain why they matter now.', intent: 'retention', priority: 'high' },
        { topic: 'The 3 market updates your team should actually care about this week', reason: 'This fits the top-signals + pattern structure without turning the newsletter into a noisy link dump.', intent: 'retention', priority: 'high' },
        { topic: 'What happened this week in your category — and what it adds up to', reason: 'This gives you room to connect updates into a stronger pattern that helps subscribers feel smarter fast.', intent: 'awareness', priority: 'medium' },
      ];
    case 'strategic-letter':
      return [
        { topic: 'The market shift changing how category leaders position themselves', reason: 'A strategic letter works best when it identifies a non-obvious shift and translates it into positioning choices.', intent: 'authority', priority: 'high' },
        { topic: 'Why the next competitive edge will come from workflow ownership', reason: 'This topic naturally supports leverage, analysis, and strategic moves instead of generic advice.', intent: 'conversion', priority: 'high' },
        { topic: 'What smart teams are seeing before the market fully reprices the opportunity', reason: 'Great for a strategy memo style newsletter with a thesis and decisive recommendations.', intent: 'authority', priority: 'medium' },
      ];
    case 'action-letter':
      return [
        { topic: 'A step-by-step way to fix a common execution bottleneck', reason: 'Action letters are strongest when they solve a real operator problem with a practical framework the reader can use immediately.', intent: 'conversion', priority: 'high' },
        { topic: 'How to implement a repeatable workflow your team keeps postponing', reason: 'This gives you a concrete problem, a target outcome, clear steps, and mistakes to avoid.', intent: 'conversion', priority: 'high' },
        { topic: 'The operating checklist readers can apply this week', reason: 'This is a strong fit for practical subscribers who want execution clarity, not abstract philosophy.', intent: 'retention', priority: 'medium' },
      ];
    default:
      return [
        { topic: 'A newsletter idea worth building a point of view around', reason: 'Start with a topic that rewards structure, interpretation, and clear reader value.', intent: 'authority', priority: 'high' },
      ];
  }
}

export default function NewsletterIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId, user, isLoading: authLoading } = useCompanyContext();
  const format = typeof router.query.format === 'string' ? router.query.format : 'insight-letter';
  const typeConfig = getNewsletterEngineConfig(format);

  const [loading, setLoading] = useState(true);
  const [existingNewsletters, setExistingNewsletters] = useState<ExistingNewsletter[]>([]);
  const [companyName, setCompanyName] = useState('Your Company');
  const [companyContext, setCompanyContext] = useState('');
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const [customCards, setCustomCards] = useState<RecommendationCard[]>([]);

  useEffect(() => {
    if (!selectedCompanyId) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=newsletter`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch(`/api/company-profile?company_id=${selectedCompanyId}`, { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([newslettersData, profileData]) => {
      if (Array.isArray(newslettersData?.blogs)) {
        setExistingNewsletters(newslettersData.blogs);
      }
      if (profileData?.profile?.name) setCompanyName(profileData.profile.name);
      if (profileData?.profile) {
        const parts = [
          profileData.profile.industry,
          profileData.profile.target_audience,
          profileData.profile.brand_voice,
        ].filter(Boolean);
        setCompanyContext(parts.join(' | '));
      }
    }).finally(() => setLoading(false));
  }, [selectedCompanyId]);

  const cards = useMemo(() => {
    const defaults = buildDefaultRecommendations(format);
    return [...customCards, ...defaults];
  }, [customCards, format]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!user?.userId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">Sign in to continue.</p>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Newsletter Intelligence | Omnivyra</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="mb-1 text-xs text-gray-500">Step 1 of 3 — Recommended newsletter cards</p>
              <h1 className="text-2xl font-bold text-gray-900">Newsletter Intelligence</h1>
              {typeConfig && (
                <p className="mt-1 text-sm text-gray-600">
                  {typeConfig.title} · {typeConfig.shortLabel} · {typeConfig.thinkingMode}
                </p>
              )}
            </div>
            <Link href="/newsletters/create" className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          <div className="mb-6 rounded-2xl border border-amber-100 bg-white/90 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-gray-900">Start from a newsletter-worthy idea, not just a topic.</p>
                <p className="mt-1 text-sm text-gray-600">
                  We’re recommending newsletter cards aligned to this format’s thinking model so the content feels purposeful before it’s written.
                </p>
                {existingNewsletters.length > 0 && (
                  <p className="mt-2 text-xs text-gray-500">
                    Existing newsletters: {existingNewsletters.slice(0, 3).map((item) => item.title).join(' · ')}
                    {existingNewsletters.length > 3 ? ' · ...' : ''}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsAIModalOpen(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100"
              >
                <Sparkles className="h-4 w-4" /> AI Chat
              </button>
            </div>
          </div>

          <section>
            <div className="mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600" />
              <h2 className="text-base font-bold text-gray-900">Recommended Cards</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((card, index) => (
                <div key={`${card.topic}-${index}`} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${PRIORITY_STYLES[card.priority]}`}>
                      {card.priority} priority
                    </span>
                    <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{card.intent}</span>
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">{card.topic}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">{card.reason}</p>
                  <div className="mt-4 border-t border-gray-100 pt-3">
                    <button
                      type="button"
                      onClick={() => router.push({
                        pathname: '/newsletters/template',
                        query: {
                          format,
                          topic: card.topic,
                        },
                      })}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:underline"
                    >
                      Write this <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {selectedCompanyId && (
        <AIBlogCardModal
          isOpen={isAIModalOpen}
          onClose={() => setIsAIModalOpen(false)}
          companyId={selectedCompanyId}
          companyName={companyName}
          companyContext={companyContext}
          existingTopics={existingNewsletters.map((item) => item.title)}
          contentLabel="newsletter"
          contentType="newsletter"
          contentModeLabel={typeConfig ? `${typeConfig.title} · ${typeConfig.shortLabel}` : undefined}
          onCardCreated={(card) => {
            setCustomCards((prev) => [
              {
                topic: card.topic,
                reason: card.reason || 'Custom newsletter card generated with AI chat.',
                intent: card.intent,
                priority: card.priority || 'medium',
              },
              ...prev,
            ]);
          }}
        />
      )}
    </>
  );
}
