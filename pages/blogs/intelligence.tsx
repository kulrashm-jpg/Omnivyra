import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import {
  Loader2, Lightbulb, ArrowRight, Sparkles, Zap,
  BarChart2, AlertTriangle, TrendingUp,
} from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import AIBlogCardModal from '../../components/blog/AIBlogCardModal';
import {
  buildTopicClusters, detectContentGaps, generateRecommendations, PLATFORM_DEFAULT_PILLARS,
  type ContentGap, type Recommendation, type ExistingPostMeta,
} from '../../lib/blog/topicDetection';
import {
  computeAllMetrics,
  type PostPerformance,
} from '../../lib/blog/performanceEngine';
import {
  buildWritingStyleProfile,
  formatStyleInstructions,
  type WritingStyleProfile,
} from '../../lib/content/writingStyleEngine';
import type { CompanyProfile } from '../../backend/services/companyProfileService';

// ── Types (matching blogs.tsx) ───────────────────────────────────────────────

interface PostMeta extends ExistingPostMeta {
  views_count:      number;
  likes_count:      number;
  status:           string;
  has_summary:      boolean;
  internal_links:   number;
  references_count: number;
  published_at:     string | null;
}

interface SeriesRow {
  id:                string;
  title:             string;
  slug:              string;
  description:       string | null;
  blog_series_posts: { blog_id: string; position: number; title: string; slug: string; status: string }[];
}

interface BriefInsight {
  company_id: string;
  company_name: string;
  company_context: string;
  current_content: string;
  writing_style: string;
  writing_style_profile: WritingStyleProfile | null;
  related_titles: string[];
  intent: 'awareness' | 'authority' | 'conversion' | 'retention';
  tone: string;
}

type EnrichedGap = ContentGap & { brief: BriefInsight };

type CardSuggestions = {
  uniqueness_directive_options: string[];
  must_include_points_options: string[];
  campaign_objective_options: string[];
  trend_context_options: string[];
};

// ── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-600',
};

const WORD_TIER_LABELS: Record<string, string> = {
  '800':  '800+ words',
  '1200': '1,200+ words',
  '1600': '1,600+ words',
  '2000': '2,000+ words',
};

// Suggestion count scales with word tier
const SUGGESTION_COUNTS: Record<string, number> = {
  '800':  3,
  '1200': 5,
  '1600': 6,
  '2000': 8,
};

// ── Main Page ────────────────────────────────────────────────────────────────

export default function BlogIntelligencePage() {
  const router = useRouter();
  const { selectedCompanyId, user, isLoading: authLoading } = useCompanyContext();

  // Word count from query param
  const wordsParam = typeof router.query.words === 'string' && ['800', '1200', '1600', '2000'].includes(router.query.words)
    ? router.query.words
    : null;

  // Data
  const [posts, setPosts] = useState<PostMeta[]>([]);
  const [series, setSeries] = useState<SeriesRow[]>([]);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [companyContextNote, setCompanyContextNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // AI Blog Card Modal
  const [isAICardModalOpen, setIsAICardModalOpen] = useState(false);

  // Per-card AI suggestions (keyed by card index)
  const [cardSuggestions, setCardSuggestions] = useState<Record<number, CardSuggestions>>({});
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const suggestionCount = SUGGESTION_COUNTS[wordsParam || '1200'] || 3;

  // ── Fetch intelligence data ──────────────────────────────────────────────
  const fetchIntelligence = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    setError('');
    try {
      const qs = `company_id=${selectedCompanyId}`;
      const [intelligenceRes, profileRes] = await Promise.all([
        fetch(`/api/company/blog/intelligence?${qs}`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/company-profile?company_id=${selectedCompanyId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const blogsData = intelligenceRes.posts || [];
      const seriesData = intelligenceRes.series || [];

      setPosts(blogsData.map((b: any) => ({
        id: b.id,
        title: b.title,
        slug: b.slug || '',
        status: b.status,
        excerpt: b.excerpt || '',
        tags: b.tags || [],
        category: b.category || '',
        views_count: b.views_count || 0,
        likes_count: b.likes_count || 0,
        has_summary: b.has_summary || false,
        internal_links: b.internal_links || 0,
        references_count: b.references_count || 0,
        published_at: b.published_at,
      })));
      setSeries(seriesData);
      setCompanyProfile(profileRes?.profile || null);

      if (profileRes?.profile) {
        const { industry, target_audience, brand_voice } = profileRes.profile;
        const parts = [industry, target_audience, brand_voice].filter(Boolean);
        setCompanyContextNote(parts.join(' | ') || '');
      }
    } catch {
      setError('Failed to load intelligence data. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => { fetchIntelligence(); }, [fetchIntelligence]);

  // ── Computed Intelligence (same logic as blogs.tsx) ─────────────────────
  const { gaps, recommendations, allMetrics } = useMemo(() => {
    if (posts.length === 0) {
      const defaultGaps: ContentGap[] = [
        { topic: 'Getting Started Guide', slug: 'getting-started-guide', reason: `Help new visitors understand how to get started with your offerings. A foundational "101" guide builds authority and captures awareness-stage traffic.`, priority: 'high', relatedTo: [] },
        { topic: 'Common Pain Points & Solutions', slug: 'common-pain-points-solutions', reason: `Address the top problems your audience faces. This establishes expertise and captures intent-driven search traffic.`, priority: 'high', relatedTo: [] },
        { topic: 'Case Study or Success Stories', slug: 'case-study-success-stories', reason: `Demonstrate real-world results with an in-depth case study. Builds credibility and converts consideration-stage leads.`, priority: 'medium', relatedTo: [] },
        { topic: 'Industry Trends & Insights', slug: 'industry-trends-insights', reason: `Share timely trends, data, or insights relevant to your space. Positions you as a thought leader and captures trending search queries.`, priority: 'medium', relatedTo: [] },
        { topic: 'Expert Comparison or Alternatives', slug: 'expert-comparison-alternatives', reason: `Compare your approach or product to alternatives. Converts evaluation-stage prospects who are researching options.`, priority: 'medium', relatedTo: [] },
      ];

      const enrichedGaps: (ContentGap & { brief?: BriefInsight })[] = defaultGaps.map((gap) => ({
        ...gap,
        brief: {
          company_id: selectedCompanyId || 'default',
          company_name: companyProfile?.name || 'Your Company',
          company_context: `Start strong with foundational content that teaches your audience the basics and establishes your expertise in your market.`,
          current_content: 'No blog posts yet. Get started with these pillar topics.',
          writing_style: companyProfile?.brand_voice || 'Clear, professional, and helpful',
          writing_style_profile: { tone: 'Professional', voice: 'Authoritative but approachable', formality: 'Semi-formal', complexity: 'Accessible to general audience' } as unknown as WritingStyleProfile,
          related_titles: [],
          intent: gap.priority === 'high' ? 'authority' as const : 'awareness' as const,
          tone: 'Professional and helpful',
        },
      }));

      const defaultRecs: Recommendation[] = [
        { type: 'write', action: `Start with 1-2 foundational "pillar" posts`, reason: `These become the cornerstone of your content strategy. They're long-form (2000+ words), comprehensive guides that establish your authority.`, priority: 'high', targetSlug: null },
        { type: 'write', action: `Create 3-4 problem-solution posts that align with your audience's top questions`, reason: `These mid-form posts (1000-1500 words) capture specific search intent and build internal linking opportunities.`, priority: 'high', targetSlug: null },
        { type: 'optimize', action: `Plan your content calendar for the next 30 days`, reason: `Map out topics, formats, and publishing cadence. Consistency signals quality to both search engines and readers.`, priority: 'medium', targetSlug: null },
      ];

      return { gaps: enrichedGaps as ContentGap[], recommendations: defaultRecs, allMetrics: [] };
    }

    const seriesPostIdSet = new Set(series.flatMap((s) => (s.blog_series_posts ?? []).map((sp) => sp.blog_id)));
    const clusters = buildTopicClusters(posts as ExistingPostMeta[]);
    const gapResult = detectContentGaps(clusters, posts as ExistingPostMeta[], PLATFORM_DEFAULT_PILLARS);
    const recs = generateRecommendations(gapResult.gaps, clusters, posts as any[]);
    const allMetrics = computeAllMetrics(posts as PostPerformance[], seriesPostIdSet);

    // Enrich gaps with BriefInsight
    const topTags = posts.flatMap((p: any) => p.tags || []).reduce<Record<string, number>>((acc, tag) => {
      const key = String(tag || '').trim().toLowerCase();
      if (!key) return acc;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const frequentTags = Object.entries(topTags).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag]) => tag);

    let styleProfile: WritingStyleProfile | null = null;
    let writingStyleText: string;
    if (companyProfile) {
      styleProfile = buildWritingStyleProfile(companyProfile);
      writingStyleText = formatStyleInstructions(styleProfile);
      if (frequentTags.length > 0) writingStyleText += `\n  Maintain topical continuity with tags: ${frequentTags.join(', ')}`;
    } else {
      writingStyleText = [
        'Lead with a concrete business problem in opening paragraph.',
        'Use authoritative, evidence-led tone with actionable takeaways.',
        frequentTags.length > 0 ? `Maintain topical continuity with tags: ${frequentTags.join(', ')}.` : 'Maintain topical continuity with existing category language.',
        'Include internal linking opportunities and end with practical summary.',
      ].join(' ');
    }
    const toneText = styleProfile?.tone_summary || 'Confident, analytical, and practical';

    const enrichedGaps: EnrichedGap[] = gapResult.gaps.map((gap) => {
      const relatedTitles = posts
        .filter((p: any) => gap.relatedTo.some((r) => p.title.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(p.title.toLowerCase())))
        .slice(0, 3).map((p: any) => p.title);
      const bestPerformers = [...posts].filter((p: any) => p.status === 'published')
        .sort((a: any, b: any) => ((b as any).views_count || 0) - ((a as any).views_count || 0))
        .slice(0, 3).map((p: any) => p.title);
      const currentContent = relatedTitles.length > 0
        ? `Existing coverage: ${relatedTitles.join('; ')}. Expand beyond repeated angles.`
        : `No direct coverage yet. Reference adjacent winners: ${bestPerformers.join('; ') || 'none available'}.`;

      return {
        ...gap,
        brief: {
          company_id: selectedCompanyId || '',
          company_name: companyProfile?.name || 'Your Company',
          company_context: companyContextNote || 'Company context available from profile.',
          current_content: currentContent,
          writing_style: writingStyleText,
          writing_style_profile: styleProfile,
          related_titles: relatedTitles,
          intent: gap.priority === 'high' ? 'authority' as const : gap.priority === 'medium' ? 'conversion' as const : 'awareness' as const,
          tone: toneText,
        },
      };
    });

    return { gaps: enrichedGaps, recommendations: recs, allMetrics };
  }, [posts, series, selectedCompanyId, companyContextNote, companyProfile]);

  // ── Auto-fetch AI suggestions for each card ─────────────────────────────
  useEffect(() => {
    if (!selectedCompanyId || gaps.length === 0 || suggestionsLoading) return;
    // Only fetch once — skip if we already have suggestions for card 0
    if (cardSuggestions[0]) return;

    setSuggestionsLoading(true);
    const fetchAll = async () => {
      const results: Record<number, CardSuggestions> = {};
      // Fetch suggestions for each card sequentially to avoid overwhelming the API
      for (let i = 0; i < gaps.length; i++) {
        const gap = gaps[i];
        const brief = (gap as any).brief;
        try {
          const res = await fetch('/api/company/blog/brief-suggestions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              company_id: selectedCompanyId,
              topic: gap.topic,
              reason: gap.reason,
              brief: brief || {},
              currentValues: {},
              count: suggestionCount,
            }),
          });
          if (res.ok) {
            results[i] = await res.json();
          }
        } catch {
          // Silently skip failed cards
        }
      }
      setCardSuggestions(results);
      setSuggestionsLoading(false);
    };
    fetchAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaps, selectedCompanyId, suggestionCount]);

  // ── Handle AI card creation → navigate to template flow ─────────────────
  const handleAICardCreated = (card: any) => {
    setIsAICardModalOpen(false);
    void router.push({
      pathname: '/blogs/template',
      query: {
        ...(wordsParam ? { words: wordsParam } : {}),
        topic: encodeURIComponent(card.topic),
      },
    });
  };

  // ── Auth guard ──────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-purple-600" />
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
        <title>Blog Intelligence | Omnivyra</title>
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-indigo-50 p-6">
        <div className="mx-auto max-w-5xl">

          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-xs text-gray-500 mb-1">Blog Intelligence</p>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <span>✍️</span> Create a Blog Post
                {wordsParam && (
                  <span className="text-sm font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">
                    {WORD_TIER_LABELS[wordsParam] || `${wordsParam}+ words`}
                  </span>
                )}
              </h1>
            </div>
            <Link href="/blogs/create" className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-8">

            {/* Action cards row */}
            <div className="grid gap-4 sm:grid-cols-2">
              {/* Create with AI Chat */}
              <button
                onClick={() => setIsAICardModalOpen(true)}
                className="flex items-start gap-4 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-5 text-left hover:shadow-md transition-shadow"
              >
                <div className="shrink-0 rounded-lg bg-gradient-to-br from-purple-600 to-pink-600 p-2.5">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Create with AI Chat</h3>
                  <p className="text-xs text-gray-600 mt-1">Describe your idea and AI will refine it into a perfect blog brief.</p>
                </div>
              </button>

              {/* Free Write */}
              <button
                onClick={() => router.push({ pathname: '/blogs/generate', query: wordsParam ? { words: wordsParam } : {} })}
                className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white p-5 text-left hover:shadow-md transition-shadow"
              >
                <div className="shrink-0 rounded-lg bg-gray-100 p-2.5">
                  <Lightbulb className="h-5 w-5 text-gray-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">Write Your Own Topic</h3>
                  <p className="text-xs text-gray-600 mt-1">Skip recommendations and go straight to the draft builder with your own topic.</p>
                </div>
              </button>
            </div>

            {/* Recommended Topic Cards (detailed — matching blogs.tsx) */}
            <section>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="h-4 w-4 text-purple-600" />
                <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Recommended Topics</h2>
              </div>

              {gaps.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                  Excellent coverage — no major content gaps detected.
                </div>
              ) : (
                <div className="space-y-5">
                  {suggestionsLoading && (
                    <div className="flex items-center gap-2 text-xs text-purple-600">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading AI suggestions for each topic...
                    </div>
                  )}
                  {gaps.map((gap, i) => {
                    const sug = cardSuggestions[i];
                    return (
                    <div key={i} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                      {/* Header row */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <h3 className="text-sm font-bold text-gray-900 leading-snug">{gap.topic}</h3>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_COLOURS[gap.priority]}`}>
                          {gap.priority}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed mb-4">{gap.reason}</p>

                      {/* BriefInsight detail panel */}
                      {(gap as any).brief && (
                        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2 mb-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Company Context</p>
                          <p className="text-xs text-gray-700 line-clamp-2">{(gap as any).brief.company_context}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Current Content</p>
                          <p className="text-xs text-gray-700 line-clamp-2">{(gap as any).brief.current_content}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Writing Style</p>
                          <p className="text-xs text-gray-700 line-clamp-2">{(gap as any).brief.writing_style}</p>
                        </div>
                      )}

                      {/* AI Suggestion Fields */}
                      {sug && (
                        <div className="space-y-3 mb-4">
                          {/* Uniqueness Directive */}
                          {sug.uniqueness_directive_options.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Uniqueness Directive</p>
                              <div className="flex flex-wrap gap-1.5">
                                {sug.uniqueness_directive_options.map((opt, idx) => (
                                  <span key={`ud-${idx}`} className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] text-purple-700">
                                    {opt}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Must-Include Points */}
                          {sug.must_include_points_options.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Must-Include Points</p>
                              <div className="flex flex-wrap gap-1.5">
                                {sug.must_include_points_options.map((opt, idx) => (
                                  <span key={`mi-${idx}`} className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] text-indigo-700">
                                    {opt}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Campaign Objective + Trend Context side by side */}
                          <div className="grid gap-3 sm:grid-cols-2">
                            {sug.campaign_objective_options.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Campaign Objective</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {sug.campaign_objective_options.map((opt, idx) => (
                                    <span key={`co-${idx}`} className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-700">
                                      {opt}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {sug.trend_context_options.length > 0 && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Trend Context</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {sug.trend_context_options.map((opt, idx) => (
                                    <span key={`tc-${idx}`} className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] text-teal-700">
                                      {opt}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Builds on */}
                      {gap.relatedTo && gap.relatedTo.length > 0 && (
                        <div className="pt-3 border-t border-gray-100 mb-4">
                          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Builds on</p>
                          {gap.relatedTo.map((t) => (
                            <p key={t} className="text-xs text-[#0A66C2] truncate">→ {t}</p>
                          ))}
                        </div>
                      )}

                      {/* CTAs */}
                      <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                        <Link href="#" onClick={(e) => {
                          e.preventDefault();
                          // Route to template-first flow: intelligence → template → suggestions → editor
                          router.push({
                            pathname: '/blogs/template',
                            query: {
                              ...(wordsParam ? { words: wordsParam } : {}),
                              topic: encodeURIComponent(gap.topic),
                            },
                          });
                        }} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0B5ED7] hover:underline">
                          Write this <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Action Items */}
            <section>
              <h2 className="mb-4 text-base font-bold text-gray-900">Action Items</h2>
              {recommendations.length > 0 ? (
                <div className="space-y-2">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold bg-indigo-100 text-indigo-700">{rec.type}</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-900">{rec.action}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{rec.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500 text-center">
                  No action items at this time. Keep publishing and analyzing performance!
                </div>
              )}
            </section>

            {/* Performance Snapshot */}
            <section>
              <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-indigo-600" /> Performance Snapshot
              </h2>
              {allMetrics.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {allMetrics.filter((m) => m.status === 'published').sort((a, b) => ((b as any).views_count || 0) - ((a as any).views_count || 0)).slice(0, 6).map((m) => (
                    <div key={m.id} className="rounded-xl border border-gray-200 bg-white p-4">
                      <h3 className="text-sm font-semibold text-gray-900 line-clamp-2 mb-3">{m.title}</h3>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Views</p>
                          <p className="text-base font-bold text-gray-900">{((m as any).views_count || 0).toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider">Status</p>
                          <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold bg-blue-100 text-blue-700">Published</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-500 text-center">
                  No published posts yet. Start publishing to see performance metrics!
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* AI Blog Card Modal */}
      {isAICardModalOpen && (
        <AIBlogCardModal
          isOpen={isAICardModalOpen}
          onClose={() => setIsAICardModalOpen(false)}
          onCardCreated={handleAICardCreated}
          companyId={selectedCompanyId || ''}
          companyName={companyProfile?.name || ''}
          companyContext={companyProfile?.brand_voice || ''}
          existingTopics={posts.map((p) => p.title)}
        />
      )}
    </>
  );
}
