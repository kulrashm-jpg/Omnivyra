'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import {
  FileText, Plus, Edit2, Trash2, Loader2, AlertCircle,
  Sparkles, ArrowRight, TrendingUp, Lightbulb, Search, X,
} from 'lucide-react';
import { useCompanyContext } from '../../components/CompanyContext';
import AIBlogCardModal from '../../components/blog/AIBlogCardModal';
import {
  buildTopicClusters, detectContentGaps, generateRecommendations, PLATFORM_DEFAULT_PILLARS,
  type ContentGap, type ExistingPostMeta,
} from '../../lib/blog/topicDetection';
import {
  buildWritingStyleProfile,
  formatStyleInstructions,
  type WritingStyleProfile,
} from '../../lib/content/writingStyleEngine';
import type { CompanyProfile } from '../../lib/shared/companyProfileTypes';
import type { BriefInsight, DraftFieldSuggestions, TemplateSessionPayload, EnrichedGap } from '../blogs.types';

// ── Types ────────────────────────────────────────────────────────────────────

interface Article {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string | null;
  category: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  views_count: number;
  created_at: string;
  angle_type: string | null;
  content_type: string;
}


type FilterTab = 'all' | 'draft' | 'used';

const PRIORITY_COLOURS: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-green-100 text-green-700',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function stripHtml(s: string) {
  return s.replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildArticleCompanyContext(profile: CompanyProfile | null): string {
  if (!profile) return '';
  return [
    profile.industry ? `Industry: ${profile.industry}` : null,
    profile.category ? `Category: ${profile.category}` : null,
    profile.target_audience ? `Target audience: ${profile.target_audience}` : null,
    profile.target_audience_list?.length ? `Target audience segments: ${profile.target_audience_list.join(', ')}` : null,
    profile.ideal_customer_profile ? `Ideal customer profile: ${profile.ideal_customer_profile}` : null,
    profile.brand_positioning ? `Brand positioning: ${profile.brand_positioning}` : null,
    profile.unique_value ? `Unique value: ${profile.unique_value}` : null,
    profile.products_services ? `Products and services: ${profile.products_services}` : null,
    profile.key_messages ? `Key messages: ${profile.key_messages}` : null,
    profile.content_strategy ? `Content strategy: ${profile.content_strategy}` : null,
    profile.goals ? `Goals: ${profile.goals}` : null,
    profile.brand_voice ? `Brand voice: ${profile.brand_voice}` : null,
  ].filter(Boolean).join('\n');
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ArticlesPage() {
  const router = useRouter();
  const { selectedCompanyId } = useCompanyContext();

  // Core data
  const [articles, setArticles]       = useState<Article[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  // Intelligence
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);
  const [gaps, setGaps]                     = useState<(ContentGap & { brief?: BriefInsight })[]>([]);

  // UI state
  const [filterTab, setFilterTab]         = useState<FilterTab>('all');
  const [search, setSearch]               = useState('');
  const [view, setView]                   = useState<'articles' | 'ideas'>('articles');
  const [isAICardModalOpen, setIsAICardModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting]           = useState(false);

  // ── Fetch articles ─────────────────────────────────────────────────────────

  const fetchArticles = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    setError('');
    try {
      const [articlesRes, profileRes] = await Promise.all([
        fetch(`/api/company/blogs?company_id=${selectedCompanyId}&content_type=article`, { credentials: 'include' }).then(r => r.json()),
        fetch(`/api/company-profile?company_id=${selectedCompanyId}`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      setArticles(articlesRes.blogs || []);
      setCompanyProfile(profileRes?.profile || null);
    } catch {
      setError('Failed to load articles. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  // ── Compute gaps (memoized) ────────────────────────────────────────────────

  const computedGaps = useMemo(() => {
    if (!selectedCompanyId) return [];

    const posts: ExistingPostMeta[] = articles.map(a => ({
      id: a.id, title: a.title, slug: a.slug || '', status: a.status,
      excerpt: a.excerpt || '', tags: [], category: a.category || '',
    }));

    // When no articles exist, provide default article-oriented gaps
    if (posts.length < 3) {
      const defaultGaps: (ContentGap & { brief?: BriefInsight })[] = [
        {
          topic: 'Industry Analysis: Current State and Future Trends',
          slug: 'industry-analysis-current-state-future-trends',
          priority: 'high', relatedTo: [],
          reason: 'Authoritative industry analysis establishes thought leadership and attracts decision-makers researching market direction.',
          brief: {
            company_id: selectedCompanyId, company_name: 'Your Company',
            company_context: 'Establish authority with in-depth industry analysis and forward-looking perspectives.',
            current_content: 'No articles yet. Start with high-impact thought leadership.',
            writing_style: companyProfile?.brand_voice || 'Professional, analytical, and evidence-based',
            writing_style_profile: null, related_titles: [],
            intent: 'authority', tone: 'authoritative',
          },
        },
        {
          topic: 'Expert Perspective: Challenges and Solutions',
          slug: 'expert-perspective-challenges-solutions',
          priority: 'high', relatedTo: [],
          reason: 'Research-backed expert perspectives build credibility and drive organic sharing among professionals.',
          brief: {
            company_id: selectedCompanyId, company_name: 'Your Company',
            company_context: 'Provide expert analysis that professionals trust and share.',
            current_content: 'No articles yet. Expert perspectives attract high-quality readers.',
            writing_style: companyProfile?.brand_voice || 'Journalistic, balanced, and insightful',
            writing_style_profile: null, related_titles: [],
            intent: 'authority', tone: 'balanced',
          },
        },
        {
          topic: 'Data-Driven Deep Dive: What the Numbers Tell Us',
          slug: 'data-driven-deep-dive-what-numbers-tell-us',
          priority: 'medium', relatedTo: [],
          reason: 'Data-driven articles generate backlinks and citations, building domain authority over time.',
          brief: {
            company_id: selectedCompanyId, company_name: 'Your Company',
            company_context: 'Use data and research to back up claims and attract citations.',
            current_content: 'No articles yet. Data-driven pieces are highly shareable.',
            writing_style: companyProfile?.brand_voice || 'Evidence-led, precise, and balanced',
            writing_style_profile: null, related_titles: [],
            intent: 'awareness', tone: 'analytical',
          },
        },
      ];
      return defaultGaps;
    }

    const clusters = buildTopicClusters(posts);
    const gapResult = detectContentGaps(clusters, posts, PLATFORM_DEFAULT_PILLARS);

    // Enrich gaps with brief context
    const topTags = articles
      .flatMap(() => [] as string[])
      .reduce<Record<string, number>>((acc, tag) => {
        const key = String(tag || '').trim().toLowerCase();
        if (!key) return acc;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
    const frequentTags = Object.entries(topTags)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag);

    let writingStyleText: string;
    let styleProfile: WritingStyleProfile | null = null;
    if (companyProfile) {
      styleProfile = buildWritingStyleProfile(companyProfile);
      writingStyleText = formatStyleInstructions(styleProfile);
      if (frequentTags.length > 0) {
        writingStyleText += `\n  Maintain topical continuity with tags: ${frequentTags.join(', ')}`;
      }
    } else {
      writingStyleText = 'Write like a professional journalist or industry analyst. Use authoritative, balanced tone with evidence-based insights.';
    }
    const toneText = styleProfile?.tone_summary || 'Authoritative, balanced, and insightful';

    const enrichedGaps = gapResult.gaps.map((gap) => {
      const relatedTitles = posts
        .filter(p => gap.relatedTo.some(r => p.title.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(p.title.toLowerCase())))
        .slice(0, 3)
        .map(p => p.title);

      return {
        ...gap,
        brief: {
          company_id: selectedCompanyId,
          company_name: 'Your Company',
          company_context: companyProfile
            ? `Industry: ${companyProfile.industry || 'N/A'}. Audience: ${companyProfile.target_audience || 'N/A'}.`
            : 'Professional audience seeking in-depth analysis.',
          current_content: `${posts.length} articles published. Filling content gaps.`,
          writing_style: writingStyleText,
          writing_style_profile: styleProfile,
          related_titles: relatedTitles,
          intent: 'authority' as const,
          tone: toneText,
        },
      };
    });

    return enrichedGaps;
  }, [articles, selectedCompanyId, companyProfile]);

  useEffect(() => { setGaps(computedGaps); }, [computedGaps]);

  // ── AI card handler ────────────────────────────────────────────────────────

  const handleAICardCreated = (card: any) => {
    const token = `ai_card_${Date.now()}`;
    try {
      sessionStorage.setItem(token, JSON.stringify(card));
    } catch { /* ignore storage error */ }
    void router.push({
      pathname: '/articles/create',
      query: {
        prefill_source: 'company_admin_ai_card_creation',
        prefill_topic: card.topic,
        prefill_reason: card.reason,
        prefill_priority: card.priority || 'medium',
        prefill_company_id: selectedCompanyId,
        prefill_intent: card.intent || 'authority',
        prefill_tone: card.tone || 'authoritative',
        prefill_card: token,
      },
    });
  };

  // ── Delete article ─────────────────────────────────────────────────────────

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/company/blogs?id=${deleteConfirm.id}&company_id=${selectedCompanyId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Could not delete this article. Please try again.');
      }
    } catch {
      alert('Could not delete this article. Please check your connection and try again.');
    }
    setDeleteConfirm(null);
    setDeleting(false);
    fetchArticles();
  };

  // ── Filtered articles ──────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = articles;
    if (filterTab === 'draft') list = list.filter(a => a.status === 'draft' && !a.published_at);
    else if (filterTab === 'used') list = list.filter(a => a.status === 'published' || !!a.published_at);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(a => a.title.toLowerCase().includes(q) || (a.excerpt || '').toLowerCase().includes(q));
    }
    return list;
  }, [articles, filterTab, search]);

  const draftCount = articles.filter(a => a.status === 'draft' && !a.published_at).length;
  const usedCount  = articles.filter(a => a.status === 'published' || !!a.published_at).length;

  const tabCls = (t: string) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
      filterTab === t ? 'bg-orange-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    }`;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Head><title>Articles | Article Intelligence</title></Head>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Articles</h1>
            <p className="text-sm text-gray-500 mt-0.5">Create, manage, and distribute in-depth articles.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/articles/create')}
              className="flex items-center gap-1.5 bg-orange-600 text-white px-3 py-2 rounded-lg text-sm font-semibold hover:bg-orange-700 transition-colors"
            >
              <Plus className="h-4 w-4" /> Write Article
            </button>
          </div>
        </div>

        {/* View Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setView('articles')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              view === 'articles' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Articles
          </button>
          <button
            onClick={() => setView('ideas')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${
              view === 'ideas' ? 'border-orange-600 text-orange-600' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Ideas & Recommendations
          </button>
        </div>

        {/* Articles View */}
        {view === 'articles' && (
          <>
            {/* Filter + Search */}
            <div className="flex items-center justify-between gap-3 mb-5">
              <div className="flex gap-1.5">
                <button onClick={() => setFilterTab('all')} className={tabCls('all')}>All ({articles.length})</button>
                <button onClick={() => setFilterTab('draft')} className={tabCls('draft')}>Drafts ({draftCount})</button>
                <button onClick={() => setFilterTab('used')} className={tabCls('used')}>Used ({usedCount})</button>
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search articles..."
                  className="pl-8 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:border-orange-300 focus:ring-1 focus:ring-orange-200 outline-none w-48"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3 w-3 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 text-red-700 border border-red-200 rounded-lg p-3 mb-4 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-400">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Loading...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20">
                <FileText className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                <p className="font-medium text-gray-600">
                  {filterTab === 'all' ? 'No articles yet' : `No ${filterTab} articles`}
                </p>
                <p className="text-sm text-gray-400 mt-1">Generate an SEO-ready article in minutes — it's saved here, ready to edit, schedule, or publish.</p>
                <button
                  onClick={() => router.push('/articles/create')}
                  className="mt-3 bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-orange-700 transition-colors"
                >
                  Write Your First Article
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(article => {
                  const preview = stripHtml(article.excerpt || '').slice(0, 120);
                  return (
                    <div key={article.id} className="bg-white rounded-xl border border-gray-200/60 shadow-sm p-4 sm:p-5 hover:shadow-md transition-shadow">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold text-gray-900 text-base">{article.title || 'Untitled'}</h3>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                              article.status === 'published'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}>
                              {article.status === 'published' ? 'Used' : 'Draft'}
                            </span>
                            {article.angle_type && (
                              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{article.angle_type}</span>
                            )}
                          </div>
                          {preview && (
                            <p className="text-sm text-gray-400 line-clamp-2 mt-0.5">{preview}{(article.excerpt || '').length > 120 ? '...' : ''}</p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                            <span>{fmtDate(article.created_at)}</span>
                            {article.status === 'published' && <span>Used {fmtDate(article.published_at)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => router.push(`/articles/new?edit=${article.id}`)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            <Edit2 className="h-3.5 w-3.5" /> Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ id: article.id, title: article.title })}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* Ideas & Recommendations View */}
        {view === 'ideas' && (
          <div className="space-y-8">
            {/* AI Card Creation */}
            <div className="rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-sm">Create Custom Article Card with AI</h3>
                  <p className="text-xs text-gray-600 mt-1">Have a unique idea? Use AI to generate a recommendation card.</p>
                </div>
                <button
                  onClick={() => setIsAICardModalOpen(true)}
                  className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-orange-600 to-amber-600 text-white px-4 py-2 text-sm font-medium"
                >
                  <Sparkles className="h-4 w-4" /> Create with AI
                </button>
              </div>
            </div>

            {/* Gap Cards */}
            {gaps.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                Excellent coverage — no major gaps detected.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gaps.map((gap, i) => (
                  <div key={i} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className="text-sm font-bold text-gray-900 leading-snug">{gap.topic}</h3>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${PRIORITY_COLOURS[gap.priority]}`}>
                        {gap.priority}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed flex-1">{gap.reason}</p>

                    {gap.brief && (
                      <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Context</p>
                        <p className="text-xs text-gray-700 line-clamp-2">{gap.brief.company_context}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Writing Style</p>
                        <p className="text-xs text-gray-700 line-clamp-2">{gap.brief.writing_style}</p>
                      </div>
                    )}

                    {gap.relatedTo && gap.relatedTo.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Builds on</p>
                        {gap.relatedTo.map((t) => (
                          <p key={t} className="text-xs text-orange-600 truncate">→ {t}</p>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          const briefToken = `brief_${Date.now()}`;
                          try {
                            sessionStorage.setItem(briefToken, JSON.stringify(gap.brief));
                          } catch { /* ignore */ }
                          router.push({
                            pathname: '/articles/create',
                            query: {
                              prefill_topic: gap.topic,
                              prefill_reason: gap.reason,
                              prefill_brief: briefToken,
                            },
                          });
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:underline"
                      >
                        Write this <ArrowRight className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
              <h3 className="font-semibold text-gray-900 mb-2">Delete Article</h3>
              <p className="text-sm text-gray-600 mb-4">
                Are you sure you want to delete &ldquo;{deleteConfirm.title}&rdquo;? This cannot be undone.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  disabled={deleting}
                  className="px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  disabled={deleting}
                  className="px-3 py-2 text-sm text-white bg-red-600 rounded-lg hover:bg-red-700 flex items-center gap-1"
                >
                  {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* AI Card Modal */}
      <AIBlogCardModal
        isOpen={isAICardModalOpen}
        onClose={() => setIsAICardModalOpen(false)}
        onCardCreated={handleAICardCreated}
        companyId={selectedCompanyId || ''}
        companyName={companyProfile?.name || 'Your Company'}
        companyContext={buildArticleCompanyContext(companyProfile)}
        existingTopics={articles.map(a => a.title)}
        writingStyleGuide={companyProfile?.brand_voice || ''}
        contentLabel="article"
        contentType="article"
      />
    </>
  );
}

