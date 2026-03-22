'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Loader2, Lightbulb, Network, BookOpen, TrendingUp, Rocket,
  Plus, Trash2, ChevronUp, ChevronDown, ExternalLink,
  AlertTriangle, CheckCircle2, ArrowRight, Pencil, X, Copy, Check,
  Zap, RefreshCw, BarChart2, XCircle,
} from 'lucide-react';
import {
  classifyPost, getAmplificationActions, getRecoveryActions,
  buildAuthorityLoop, buildGrowthSummary,
  type PerformanceClass,
} from '../../../lib/blog/growthEngine';
import {
  generateRepurposedContent, extractRepurposeInput,
  type RepurposedContent,
} from '../../../lib/blog/repurposingEngine';
import {
  buildTopicClusters,
  detectContentGaps,
  generateRecommendations,
  type TopicCluster,
  type ContentGap,
  type Recommendation,
  type ExistingPostMeta,
} from '../../../lib/blog/topicDetection';
import {
  inferRelatedEdges,
  RELATIONSHIP_LABELS,
  type RelationshipType,
  type BlogEdge,
} from '../../../lib/blog/knowledgeGraph';
import {
  computeAllMetrics,
  computeTopicPerformance,
  generatePerformanceInsights,
  buildDistributionQueue,
  generateTopicNarratives,
  type PostPerformance,
  type PostMetrics,
  type PerformanceInsight,
  type DistributionItem,
  type TopicNarrative,
} from '../../../lib/blog/performanceEngine';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PostMeta extends ExistingPostMeta {
  views_count:      number;
  likes_count:      number;
  status:           string;
  has_summary:      boolean;
  internal_links:   number;
  references_count: number;
  published_at:     string | null;
}

interface SeriesPost {
  blog_id:  string;
  position: number;
  title:    string;
  slug:     string;
  status:   string;
}

interface SeriesRow {
  id:                 string;
  title:              string;
  slug:               string;
  description:        string | null;
  blog_series_posts:  SeriesPost[];
}

interface RelRow {
  id:               string;
  source_blog_id:   string;
  target_blog_id:   string;
  relationship_type: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TAB_LABELS = [
  { id: 'recommendations', label: 'What to Write',   icon: Lightbulb  },
  { id: 'performance',     label: 'Performance',     icon: TrendingUp },
  { id: 'growth',          label: 'Growth Engine',   icon: Rocket     },
  { id: 'coverage',        label: 'Topic Coverage',  icon: BarChart2  },
  { id: 'graph',           label: 'Knowledge Graph', icon: Network    },
  { id: 'series',          label: 'Series',          icon: BookOpen   },
] as const;
type TabId = typeof TAB_LABELS[number]['id'];

const PRIORITY_COLOURS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-gray-100 text-gray-600',
};

const TYPE_COLOURS: Record<string, string> = {
  write:    'bg-[#0A66C2]/10 text-[#0A66C2]',
  optimize: 'bg-violet-100 text-violet-700',
  link:     'bg-teal-100 text-teal-700',
  series:   'bg-orange-100 text-orange-700',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BlogIntelligencePage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('recommendations');

  // ── Data state ────────────────────────────────────────────────────────────
  const [posts,         setPosts]         = useState<PostMeta[]>([]);
  const [series,        setSeries]        = useState<SeriesRow[]>([]);
  const [relationships, setRelationships] = useState<RelRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);

  // ── Series editor state ───────────────────────────────────────────────────
  const [newSeriesTitle, setNewSeriesTitle]       = useState('');
  const [newSeriesDesc,  setNewSeriesDesc]         = useState('');
  const [savingSeries,   setSavingSeries]          = useState(false);
  const [editSeries,     setEditSeries]            = useState<SeriesRow | null>(null);
  const [editPosts,      setEditPosts]             = useState<SeriesPost[]>([]);
  const [addPostId,      setAddPostId]             = useState('');
  const [savingEdit,     setSavingEdit]            = useState(false);

  // ── Relationship state ────────────────────────────────────────────────────
  const [relSource, setRelSource] = useState('');
  const [relTarget, setRelTarget] = useState('');
  const [relType,   setRelType]   = useState<RelationshipType>('related');
  const [savingRel, setSavingRel] = useState(false);

  // ── Growth Engine state ───────────────────────────────────────────────────
  const [growthTier,        setGrowthTier]        = useState<PerformanceClass | 'all'>('all');
  const [selectedGrowthId,  setSelectedGrowthId]  = useState<string | null>(null);
  const [repurposedContent, setRepurposedContent] = useState<RepurposedContent | null>(null);
  const [repurposeTab,      setRepurposeTab]      = useState<'li1' | 'li2' | 'li3' | 'tw' | 'email' | 'card'>('li1');
  const [generatingRep,     setGeneratingRep]     = useState(false);
  const [copiedKey,         setCopiedKey]         = useState<string | null>(null);

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/admin/blog/intelligence', { credentials: 'include' })
      .then((r) => {
        if (r.status === 403) { router.push('/super-admin/login'); return null; }
        return r.json();
      })
      .then((d) => {
        if (!d) return;
        if (d.error) { setError(d.error); return; }
        setPosts(d.posts ?? []);
        setSeries(d.series ?? []);
        setRelationships(d.relationships ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [router]);

  // ── Computed performance ─────────────────────────────────────────────────
  const {
    allMetrics,
    topicPerf,
    perfInsights,
    distQueue,
    narratives,
  } = useMemo(() => {
    if (!posts.length) return {
      allMetrics: [], topicPerf: [], perfInsights: [], distQueue: [], narratives: [],
    };

    const seriesPostIds = new Set(
      series.flatMap((s) =>
        (s.blog_series_posts ?? []).map((sp: SeriesPost) => sp.blog_id),
      ),
    );

    const perf = posts as PostPerformance[];
    const allMetrics  = computeAllMetrics(perf, seriesPostIds);
    const topicPerf   = computeTopicPerformance(allMetrics);
    const perfInsights = generatePerformanceInsights(allMetrics, seriesPostIds);
    const distQueue   = buildDistributionQueue(allMetrics);
    const narratives  = generateTopicNarratives(topicPerf);

    return { allMetrics, topicPerf, perfInsights, distQueue, narratives };
  }, [posts, series]);

  // ── Computed intelligence ─────────────────────────────────────────────────
  const { clusters, gaps, recommendations, inferred } = useMemo(() => {
    if (!posts.length) return { clusters: [], gaps: [], recommendations: [], inferred: [] };

    const clusters    = buildTopicClusters(posts);
    const gaps        = detectContentGaps(clusters, posts);
    const recs        = generateRecommendations(gaps, clusters, posts);

    const nodes = posts.filter((p) => p.status === 'published').map((p) => ({
      id:          p.id,
      title:       p.title,
      slug:        p.slug,
      category:    p.category,
      tags:        p.tags,
      views_count: p.views_count,
      published_at: p.published_at,
    }));

    const existingEdges = relationships.map((r) => ({
      id:          r.id,
      sourceId:    r.source_blog_id,
      targetId:    r.target_blog_id,
      type:        r.relationship_type as RelationshipType,
      sourceTitle: posts.find((p) => p.id === r.source_blog_id)?.title ?? '',
      targetTitle: posts.find((p) => p.id === r.target_blog_id)?.title ?? '',
      sourceSlug:  posts.find((p) => p.id === r.source_blog_id)?.slug ?? '',
      targetSlug:  posts.find((p) => p.id === r.target_blog_id)?.slug ?? '',
    })) as BlogEdge[];

    const inferred = inferRelatedEdges(nodes, existingEdges);

    return { clusters, gaps, recommendations: recs, inferred };
  }, [posts, relationships]);

  // ── Computed growth ───────────────────────────────────────────────────────
  const { growthSummary, classifiedMetrics, seriesPostIdSet } = useMemo(() => {
    if (!allMetrics.length) return { growthSummary: null, classifiedMetrics: [], seriesPostIdSet: new Set<string>() };

    const seriesPostIdSet = new Set(
      series.flatMap((s) => (s.blog_series_posts ?? []).map((sp: SeriesPost) => sp.blog_id)),
    );

    const classifiedMetrics = allMetrics
      .filter((m) => m.status === 'published')
      .map((m) => ({ ...m, _class: classifyPost(m) as PerformanceClass }));

    const growthSummary = buildGrowthSummary(classifiedMetrics);
    return { growthSummary, classifiedMetrics, seriesPostIdSet };
  }, [allMetrics, series]);

  // Generate repurposed content (fetches full post for blocks, then runs engine)
  const generateRepurpose = async (postId: string) => {
    setGeneratingRep(true);
    setRepurposedContent(null);
    try {
      const r = await fetch(`/api/admin/blog/${postId}`, { credentials: 'include' });
      const post = r.ok ? await r.json() : null;
      if (post) {
        const input = extractRepurposeInput(post);
        setRepurposedContent(generateRepurposedContent(input));
        setRepurposeTab('li1');
      }
    } finally {
      setGeneratingRep(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };

  // ── Series CRUD ────────────────────────────────────────────────────────────
  const createSeries = async () => {
    if (!newSeriesTitle.trim()) return;
    setSavingSeries(true);
    try {
      const r = await fetch('/api/admin/blog/series', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newSeriesTitle.trim(), description: newSeriesDesc.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSeries((prev) => [{ ...d, blog_series_posts: [] }, ...prev]);
      setNewSeriesTitle('');
      setNewSeriesDesc('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingSeries(false);
    }
  };

  const deleteSeries = async (id: string) => {
    if (!confirm('Delete this series? Posts are not deleted.')) return;
    await fetch(`/api/admin/blog/series/${id}`, { method: 'DELETE', credentials: 'include' });
    setSeries((prev) => prev.filter((s) => s.id !== id));
  };

  const openEditSeries = (s: SeriesRow) => {
    setEditSeries(s);
    setEditPosts([...(s.blog_series_posts ?? [])].sort((a, b) => a.position - b.position));
  };

  const saveEditSeries = async () => {
    if (!editSeries) return;
    setSavingEdit(true);
    try {
      await fetch(`/api/admin/blog/series/${editSeries.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:       editSeries.title,
          description: editSeries.description,
          posts:       editPosts.map((p, i) => ({ blog_id: p.blog_id, position: i })),
        }),
      });
      setSeries((prev) => prev.map((s) =>
        s.id === editSeries.id
          ? { ...editSeries, blog_series_posts: editPosts }
          : s,
      ));
      setEditSeries(null);
    } catch {
      alert('Failed to save');
    } finally {
      setSavingEdit(false);
    }
  };

  const addPostToEdit = () => {
    if (!addPostId) return;
    const post = posts.find((p) => p.id === addPostId);
    if (!post) return;
    if (editPosts.find((p) => p.blog_id === addPostId)) return;
    setEditPosts((prev) => [
      ...prev,
      { blog_id: post.id, position: prev.length, title: post.title, slug: post.slug, status: post.status },
    ]);
    setAddPostId('');
  };

  // ── Relationship CRUD ──────────────────────────────────────────────────────
  const createRelationship = async () => {
    if (!relSource || !relTarget) return;
    setSavingRel(true);
    try {
      const r = await fetch('/api/admin/blog/relationships', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_blog_id: relSource, target_blog_id: relTarget, relationship_type: relType }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRelationships((prev) => [d, ...prev]);
      setRelSource(''); setRelTarget('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSavingRel(false);
    }
  };

  const deleteRelationship = async (id: string) => {
    await fetch(`/api/admin/blog/relationships?id=${id}`, { method: 'DELETE', credentials: 'include' });
    setRelationships((prev) => prev.filter((r) => r.id !== id));
  };

  // ── Loading / error ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-10 w-10 animate-spin text-[#0B5ED7]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-xl rounded-xl bg-white p-8 shadow text-center">
          <p className="text-red-600">{error}</p>
          <Link href="/admin/blog" className="mt-4 inline-block text-[#0B5ED7] hover:underline">Back</Link>
        </div>
      </div>
    );
  }

  const publishedPosts = posts.filter((p) => p.status === 'published');

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Blog Intelligence | Omnivyra</title>
      </Head>
      <div className="min-h-screen bg-gray-50">

        {/* ── Top bar ──────────────────────────────────────────────────────── */}
        <div className="border-b border-gray-200 bg-white px-4 py-3 sm:px-6">
          <div className="mx-auto flex max-w-6xl items-center justify-between">
            <div>
              <p className="text-xs text-gray-500">Blog CMS</p>
              <h1 className="text-lg font-bold text-gray-900">Blog Intelligence</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/admin/blog/new" className="inline-flex items-center gap-1.5 rounded-lg bg-[#0B5ED7] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0A52BE]">
                <Plus className="h-3.5 w-3.5" /> New Post
              </Link>
              <Link href="/admin/blog" className="text-sm text-gray-500 hover:text-gray-900">← Blog CMS</Link>
            </div>
          </div>
        </div>

        {/* ── Stats row ────────────────────────────────────────────────────── */}
        <div className="border-b border-gray-100 bg-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="flex divide-x divide-gray-100">
              {[
                { label: 'Published',   value: publishedPosts.length },
                { label: 'Drafts',      value: posts.filter((p) => p.status === 'draft').length },
                { label: 'Series',      value: series.length },
                { label: 'Connections', value: relationships.length },
                { label: 'Total Views', value: posts.reduce((s, p) => s + (p.views_count || 0), 0).toLocaleString() },
              ].map(({ label, value }) => (
                <div key={label} className="flex-1 px-4 py-3 text-center">
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="border-b border-gray-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <nav className="flex gap-1 overflow-x-auto">
              {TAB_LABELS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                    tab === id
                      ? 'border-[#0B5ED7] text-[#0B5ED7]'
                      : 'border-transparent text-gray-500 hover:text-gray-900'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

          {/* ═══════════════════════════════════════════════════════════════
              TAB: RECOMMENDATIONS
          ═══════════════════════════════════════════════════════════════ */}
          {tab === 'recommendations' && (
            <div className="space-y-8">
              {/* Content gaps — What to write */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-[#0B5ED7]" />
                  What to Write Next
                </h2>
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
                        {gap.relatedTo.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Builds on</p>
                            {gap.relatedTo.map((t) => (
                              <p key={t} className="text-xs text-[#0A66C2] truncate">→ {t}</p>
                            ))}
                          </div>
                        )}
                        <Link
                          href={`/admin/blog/new`}
                          className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[#0B5ED7] hover:underline"
                        >
                          Write this <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Action recommendations */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Action Items</h2>
                <div className="space-y-2">
                  {recommendations.map((rec, i) => (
                    <div key={i} className="flex items-start gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_COLOURS[rec.type]}`}>
                        {rec.type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{rec.action}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{rec.reason}</p>
                      </div>
                      <span className={`shrink-0 self-start rounded-full px-2 py-0.5 text-[10px] font-bold ${PRIORITY_COLOURS[rec.priority]}`}>
                        {rec.priority}
                      </span>
                      {rec.targetSlug && (
                        <Link href={`/admin/blog`} className="shrink-0 text-[#0B5ED7] hover:underline text-xs font-medium">
                          Edit →
                        </Link>
                      )}
                    </div>
                  ))}
                  {recommendations.length === 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                      <CheckCircle2 className="h-8 w-8 mx-auto text-green-400 mb-2" />
                      All articles look great — no urgent action items.
                    </div>
                  )}
                </div>
              </section>

              {/* Performance snapshot */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Performance Snapshot</h2>
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Title</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Views</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Likes</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Summary</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Links</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Refs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {publishedPosts
                        .sort((a, b) => (b.views_count || 0) - (a.views_count || 0))
                        .slice(0, 10)
                        .map((p) => (
                          <tr key={p.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-medium text-gray-900 max-w-xs truncate">
                              <Link href={`/blog/${p.slug}`} target="_blank" className="hover:text-[#0B5ED7] inline-flex items-center gap-1">
                                {p.title}
                                <ExternalLink className="h-3 w-3 opacity-40" />
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{(p.views_count || 0).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{p.likes_count || 0}</td>
                            <td className="px-4 py-2.5 text-center">
                              {p.has_summary
                                ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                                : <AlertTriangle className="h-4 w-4 text-amber-400 mx-auto" />}
                            </td>
                            <td className="px-4 py-2.5 text-center text-gray-600">{p.internal_links}</td>
                            <td className="px-4 py-2.5 text-center text-gray-600">{p.references_count}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB: PERFORMANCE
          ═══════════════════════════════════════════════════════════════ */}
          {tab === 'performance' && (
            <div className="space-y-8">

              {/* ── Summary metrics ─────────────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(() => {
                  const published = allMetrics.filter((m) => m.status === 'published');
                  const avgEng    = published.length ? Math.round(published.reduce((s, p) => s + p.engagement_score, 0) / published.length) : 0;
                  const avgComp   = published.length ? Math.round(published.reduce((s, p) => s + p.completion_rate, 0) / published.length) : 0;
                  const avgScroll = published.length ? Math.round(published.reduce((s, p) => s + p.avg_scroll_depth, 0) / published.length) : 0;
                  const bestCat   = topicPerf[0]?.category ?? '—';
                  return [
                    { label: 'Avg Engagement',  value: `${avgEng}/100`,  colour: avgEng >= 50 ? '#16a34a' : avgEng >= 25 ? '#d97706' : '#dc2626' },
                    { label: 'Avg Completion',  value: `${avgComp}%`,   colour: avgComp >= 50 ? '#16a34a' : '#d97706' },
                    { label: 'Avg Scroll Depth',value: `${avgScroll}%`, colour: '#0A66C2' },
                    { label: 'Top Category',    value: bestCat,         colour: '#0B1F33' },
                  ].map(({ label, value, colour }) => (
                    <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 text-center shadow-sm">
                      <p className="text-2xl font-black" style={{ color: colour }}>{value}</p>
                      <p className="text-xs text-gray-500 mt-1">{label}</p>
                    </div>
                  ));
                })()}
              </div>

              {/* ── Topic × Performance narratives ─────────────────────── */}
              {narratives.length > 0 && (
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900 flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-[#0B5ED7]" />
                    Topic Intelligence
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {narratives.map((n) => {
                      const colour = n.verdict === 'scale' ? 'border-green-200 bg-green-50'
                        : n.verdict === 'improve' ? 'border-amber-200 bg-amber-50'
                        : 'border-gray-200 bg-gray-50';
                      const badge = n.verdict === 'scale' ? 'bg-green-100 text-green-700'
                        : n.verdict === 'improve' ? 'bg-amber-100 text-amber-700'
                        : 'bg-gray-100 text-gray-600';
                      return (
                        <div key={n.category} className={`rounded-2xl border p-4 ${colour}`}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge}`}>
                              {n.verdict}
                            </span>
                            <span className="text-xs font-semibold text-gray-700">{n.category}</span>
                          </div>
                          <p className="text-xs text-gray-600 leading-relaxed">{n.message}</p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Performance table ──────────────────────────────────── */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Blog Performance</h2>
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                  <table className="w-full text-sm min-w-[800px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Title</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500">Health</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Engagement</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Views</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Completion</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Avg Time</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Scroll</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Likes</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">Comments</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[...allMetrics]
                        .filter((m) => m.status === 'published')
                        .sort((a, b) => b.engagement_score - a.engagement_score)
                        .map((m) => {
                          const healthColour = m.health === 'excellent' ? 'bg-green-100 text-green-700'
                            : m.health === 'good' ? 'bg-blue-100 text-blue-700'
                            : m.health === 'fair' ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700';
                          const engColour = m.engagement_score >= 50 ? '#16a34a'
                            : m.engagement_score >= 25 ? '#d97706'
                            : '#dc2626';
                          const avgTimeFmt = m.avg_time_seconds > 0
                            ? m.avg_time_seconds >= 60
                              ? `${Math.floor(m.avg_time_seconds / 60)}m ${m.avg_time_seconds % 60}s`
                              : `${m.avg_time_seconds}s`
                            : '—';
                          return (
                            <tr key={m.id} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium text-gray-900 max-w-[220px]">
                                <div className="flex flex-col">
                                  <Link href={`/blog/${m.slug}`} target="_blank" className="hover:text-[#0B5ED7] inline-flex items-center gap-1 line-clamp-1">
                                    {m.title}
                                    <ExternalLink className="h-3 w-3 opacity-40 shrink-0" />
                                  </Link>
                                  {m.category && (
                                    <span className="text-[10px] text-gray-400">{m.category}</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${healthColour}`}>
                                  {m.health}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="inline-flex flex-col items-end gap-1">
                                  <span className="font-bold text-sm" style={{ color: engColour }}>{m.engagement_score}</span>
                                  <div className="w-16 h-1 rounded-full bg-gray-100">
                                    <div className="h-1 rounded-full" style={{ width: `${m.engagement_score}%`, backgroundColor: engColour }} />
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{m.views_count.toLocaleString()}</td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {m.session_count > 0 ? `${Math.round(m.completion_rate)}%` : '—'}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{avgTimeFmt}</td>
                              <td className="px-4 py-3 text-right text-gray-700">
                                {m.session_count > 0 ? `${Math.round(m.avg_scroll_depth)}%` : '—'}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-700">{m.likes_count}</td>
                              <td className="px-4 py-3 text-right text-gray-700">{m.comments_count}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  {allMetrics.filter((m) => m.status === 'published').length === 0 && (
                    <p className="py-10 text-center text-sm text-gray-400">No published posts yet.</p>
                  )}
                </div>
              </section>

              {/* ── Performance insights ────────────────────────────────── */}
              {perfInsights.length > 0 && (
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Optimization Insights</h2>
                  <div className="space-y-2">
                    {perfInsights.map((ins, i) => {
                      const sev = ins.severity === 'critical' ? { bg: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-700', icon: XCircle }
                        : ins.severity === 'warning' ? { bg: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700', icon: AlertTriangle }
                        : { bg: 'bg-blue-50 border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: Lightbulb };
                      const Icon = sev.icon;
                      return (
                        <div key={i} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${sev.bg}`}>
                          <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: ins.severity === 'critical' ? '#dc2626' : ins.severity === 'warning' ? '#d97706' : '#0A66C2' }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{ins.message}</p>
                            <p className="text-xs text-gray-600 mt-0.5">{ins.action}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${sev.badge}`}>
                            {ins.category}
                          </span>
                          {ins.targetSlug && (
                            <Link href={`/admin/blog`} className="shrink-0 text-xs font-medium text-[#0B5ED7] hover:underline">
                              Edit →
                            </Link>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* ── Distribution queue ──────────────────────────────────── */}
              {distQueue.length > 0 && (
                <section>
                  <h2 className="mb-4 text-base font-bold text-gray-900">Distribution Queue</h2>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {distQueue.map((d, i) => (
                      <div key={i} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="rounded-full bg-[#0A66C2]/10 px-2 py-0.5 text-[10px] font-bold text-[#0A66C2] uppercase">
                            {d.action}
                          </span>
                          <span className="text-xs font-semibold text-gray-600">{d.channel}</span>
                        </div>
                        <p className="text-sm font-medium text-gray-900 line-clamp-2 mb-1">{d.title}</p>
                        <p className="text-xs text-gray-500 leading-relaxed">{d.reason}</p>
                        <Link
                          href={`/blog/${d.slug}`}
                          target="_blank"
                          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#0B5ED7] hover:underline"
                        >
                          View post <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB: GROWTH ENGINE
          ═══════════════════════════════════════════════════════════════ */}
          {tab === 'growth' && (
            <div className="space-y-8">

              {/* ── Summary KPIs ─────────────────────────────────────────── */}
              {growthSummary && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { label: 'High Performing', value: growthSummary.highCount,     color: 'text-green-600', bg: 'bg-green-50  border-green-200' },
                    { label: 'Medium',           value: growthSummary.mediumCount,   color: 'text-amber-600', bg: 'bg-amber-50  border-amber-200' },
                    { label: 'Low Performing',   value: growthSummary.lowCount,      color: 'text-red-600',   bg: 'bg-red-50    border-red-200'   },
                    { label: 'Avg Engagement',   value: `${growthSummary.avgEngagement}/100`, color: 'text-[#0B5ED7]', bg: 'bg-blue-50 border-blue-200' },
                  ].map(({ label, value, color, bg }) => (
                    <div key={label} className={`rounded-xl border p-4 text-center ${bg}`}>
                      <p className={`text-2xl font-bold ${color}`}>{value}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Quick Wins ───────────────────────────────────────────── */}
              {(growthSummary?.quickWins?.length ?? 0) > 0 && (
                <section>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-900">
                    <Zap className="h-4 w-4 text-amber-500" /> Quick Wins
                    <span className="text-xs font-normal text-gray-400">— medium posts close to high-performing threshold</span>
                  </h2>
                  <div className="flex flex-wrap gap-3">
                    {growthSummary!.quickWins.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { setSelectedGrowthId(m.id); setRepurposedContent(null); }}
                        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-left hover:bg-amber-100 transition-colors"
                      >
                        <p className="text-sm font-semibold text-gray-900 truncate max-w-[220px]">{m.title}</p>
                        <p className="text-xs text-amber-700 mt-0.5">Engagement {Math.round(m.engagement_score)}/100</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Performance Tiers ────────────────────────────────────── */}
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-gray-900">All Posts by Performance Tier</h2>
                  <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1">
                    {(['all', 'high', 'medium', 'low'] as const).map((tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setGrowthTier(tier)}
                        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                          growthTier === tier
                            ? 'bg-[#0B5ED7] text-white'
                            : 'text-gray-500 hover:text-gray-900'
                        }`}
                      >
                        {tier === 'all' ? 'All' : tier.charAt(0).toUpperCase() + tier.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {classifiedMetrics
                    .filter((m) => growthTier === 'all' || (m as PostMetrics & { _class: PerformanceClass })._class === growthTier)
                    .sort((a, b) => b.engagement_score - a.engagement_score)
                    .map((m) => {
                      const cls = (m as PostMetrics & { _class: PerformanceClass })._class;
                      const clsConfig = {
                        high:   { badge: 'bg-green-100 text-green-700', border: 'border-green-200' },
                        medium: { badge: 'bg-amber-100 text-amber-700', border: 'border-amber-200' },
                        low:    { badge: 'bg-red-100   text-red-700',   border: 'border-gray-200'  },
                      }[cls];
                      const isSelected = selectedGrowthId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => { setSelectedGrowthId(isSelected ? null : m.id); setRepurposedContent(null); }}
                          className={`w-full rounded-xl border p-4 text-left transition-all ${
                            isSelected ? 'border-[#0B5ED7] ring-2 ring-[#0B5ED7]/20 bg-blue-50' : `bg-white ${clsConfig.border} hover:bg-gray-50`
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{m.title}</p>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${clsConfig.badge}`}>{cls}</span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>Eng: <strong className="text-gray-800">{Math.round(m.engagement_score)}</strong></span>
                            <span>Views: <strong className="text-gray-800">{m.views_count.toLocaleString()}</strong></span>
                            <span>Done: <strong className="text-gray-800">{Math.round(m.completion_rate)}%</strong></span>
                          </div>
                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full ${cls === 'high' ? 'bg-green-500' : cls === 'medium' ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${Math.round(m.engagement_score)}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                </div>
              </section>

              {/* ── Selected Post: Actions + Authority Loop ──────────────── */}
              {selectedGrowthId && (() => {
                const m = classifiedMetrics.find((m) => m.id === selectedGrowthId);
                if (!m) return null;
                const cls      = (m as PostMetrics & { _class: PerformanceClass })._class;
                const inSeries = seriesPostIdSet.has(m.id);
                const actions  = cls === 'low'
                  ? getRecoveryActions(m)
                  : getAmplificationActions(m, inSeries);
                const loop     = buildAuthorityLoop(m, inSeries);
                const prioColor = (p: string) =>
                  p === 'critical' ? 'border-red-200 bg-red-50' : p === 'high' ? 'border-[#0B5ED7]/20 bg-blue-50' : 'border-gray-200 bg-white';

                return (
                  <section className="rounded-2xl border border-[#0B5ED7]/20 bg-blue-50/30 p-6">
                    <div className="mb-5 flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#0B5ED7]">
                          {cls === 'low' ? '🔧 Recovery Plan' : '🚀 Amplification Plan'}
                        </p>
                        <h3 className="mt-0.5 text-base font-bold text-gray-900 line-clamp-2">{m.title}</h3>
                      </div>
                      <Link href={`/blog/${m.slug}`} target="_blank" className="shrink-0">
                        <ExternalLink className="h-4 w-4 text-gray-400 hover:text-[#0B5ED7]" />
                      </Link>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
                      {/* Actions */}
                      <div className="space-y-2">
                        <p className="mb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          {cls === 'low' ? 'Suggested Fixes' : 'Growth Actions'}
                        </p>
                        {actions.length === 0 && (
                          <p className="text-sm text-gray-500">No specific actions at this time.</p>
                        )}
                        {actions.map((a, i) => (
                          <div key={i} className={`flex gap-3 rounded-xl border p-3 ${prioColor(a.priority)}`}>
                            <span className="text-lg leading-none">{a.icon}</span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900">{a.label}</p>
                              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{a.reason}</p>
                            </div>
                          </div>
                        ))}

                        {/* Repurpose button */}
                        {cls !== 'low' && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => generateRepurpose(m.id)}
                              disabled={generatingRep}
                              className="inline-flex items-center gap-2 rounded-lg bg-[#0B5ED7] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0A52BE] disabled:opacity-50"
                            >
                              {generatingRep
                                ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                                : <><RefreshCw className="h-4 w-4" /> Generate Repurposed Content</>}
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Authority loop */}
                      <div>
                        <p className="mb-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Authority Loop</p>
                        <ol className="relative border-l-2 border-gray-200 pl-5 space-y-4">
                          {loop.map((stage, i) => {
                            const colors = {
                              done:    'bg-green-500 border-green-500',
                              ready:   'bg-[#0B5ED7] border-[#0B5ED7]',
                              pending: 'bg-white border-gray-300',
                            };
                            return (
                              <li key={i} className="relative">
                                <span className={`absolute -left-[1.45rem] flex h-4 w-4 items-center justify-center rounded-full border-2 ${colors[stage.status]}`}>
                                  {stage.status === 'done' && <Check className="h-2.5 w-2.5 text-white" />}
                                </span>
                                <p className={`text-sm font-semibold ${stage.status === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>
                                  {stage.label}
                                </p>
                                <p className="text-xs text-gray-500 leading-relaxed">{stage.description}</p>
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </div>
                  </section>
                );
              })()}

              {/* ── Repurposed Content Panel ─────────────────────────────── */}
              {repurposedContent && (() => {
                const m = classifiedMetrics.find((m) => m.id === selectedGrowthId);
                const tabConfig = [
                  { key: 'li1',   label: 'LinkedIn 1' },
                  { key: 'li2',   label: 'LinkedIn 2' },
                  { key: 'li3',   label: 'LinkedIn 3' },
                  { key: 'tw',    label: 'Twitter/X'  },
                  { key: 'email', label: 'Email'       },
                  { key: 'card',  label: 'Key Insights'},
                ] as const;

                const activeContent = (() => {
                  if (repurposeTab === 'li1') return repurposedContent.linkedInPosts[0]?.content ?? '';
                  if (repurposeTab === 'li2') return repurposedContent.linkedInPosts[1]?.content ?? '';
                  if (repurposeTab === 'li3') return repurposedContent.linkedInPosts[2]?.content ?? '';
                  if (repurposeTab === 'tw')  return repurposedContent.twitterThread.tweets.map((t, i) => `— Tweet ${i + 1} —\n${t}`).join('\n\n');
                  if (repurposeTab === 'email') {
                    const e = repurposedContent.emailSummary;
                    return `Subject: ${e.subject}\nPreview: ${e.preview}\n\n${e.body}\n\n${e.ctaLabel}\n${e.ctaUrl}`;
                  }
                  const c = repurposedContent.keyInsightsCard;
                  return `${c.headline}\n\n${c.points.map((p) => `• ${p}`).join('\n')}\n\n${c.footer}`;
                })();

                return (
                  <section className="rounded-2xl border border-gray-200 bg-white">
                    <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-900">
                        Repurposed Content
                        {m && <span className="ml-2 text-xs font-normal text-gray-400">— {m.title}</span>}
                      </h3>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(activeContent, 'main')}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                      >
                        {copiedKey === 'main' ? <><Check className="h-3.5 w-3.5 text-green-500" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy</>}
                      </button>
                    </div>

                    {/* Sub-tabs */}
                    <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-4 pt-2">
                      {tabConfig.map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setRepurposeTab(key)}
                          className={`whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                            repurposeTab === key
                              ? 'border-[#0B5ED7] text-[#0B5ED7]'
                              : 'border-transparent text-gray-500 hover:text-gray-800'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Content */}
                    <div className="p-5">
                      {repurposeTab === 'tw' ? (
                        <div className="space-y-3">
                          {repurposedContent.twitterThread.tweets.map((tweet, i) => (
                            <div key={i} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold text-gray-400 mb-1">Tweet {i + 1}</p>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(tweet, `tw${i}`)}
                                  className="shrink-0 text-gray-400 hover:text-gray-700"
                                >
                                  {copiedKey === `tw${i}` ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                              <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{tweet}</p>
                              <p className="mt-1 text-right text-[10px] text-gray-400">{tweet.length} / 280</p>
                            </div>
                          ))}
                        </div>
                      ) : repurposeTab === 'email' ? (
                        <div className="space-y-3">
                          {[
                            { label: 'Subject',  value: repurposedContent.emailSummary.subject  },
                            { label: 'Preview',  value: repurposedContent.emailSummary.preview  },
                            { label: 'Body',     value: repurposedContent.emailSummary.body     },
                            { label: 'CTA',      value: `${repurposedContent.emailSummary.ctaLabel}\n${repurposedContent.emailSummary.ctaUrl}` },
                          ].map(({ label, value }) => (
                            <div key={label}>
                              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
                              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">{value}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : repurposeTab === 'card' ? (
                        <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 space-y-3">
                          <p className="text-base font-bold text-gray-900">{repurposedContent.keyInsightsCard.headline}</p>
                          <ul className="space-y-2">
                            {repurposedContent.keyInsightsCard.points.map((pt, i) => (
                              <li key={i} className="flex gap-2 text-sm text-gray-800">
                                <span className="text-[#0B5ED7] font-bold shrink-0">{i + 1}.</span>
                                {pt}
                              </li>
                            ))}
                          </ul>
                          <p className="text-xs text-gray-500 pt-2 border-t border-gray-200">{repurposedContent.keyInsightsCard.footer}</p>
                        </div>
                      ) : (
                        <div>
                          {repurposedContent.linkedInPosts[repurposeTab === 'li1' ? 0 : repurposeTab === 'li2' ? 1 : 2] && (
                            <div>
                              <p className="mb-2 text-xs text-gray-400 font-medium">
                                {repurposedContent.linkedInPosts[repurposeTab === 'li1' ? 0 : repurposeTab === 'li2' ? 1 : 2].label} variation
                                <span className="ml-2">· {repurposedContent.linkedInPosts[repurposeTab === 'li1' ? 0 : repurposeTab === 'li2' ? 1 : 2].charCount} chars</span>
                              </p>
                              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                                <p className="whitespace-pre-wrap text-sm text-gray-800 leading-relaxed">
                                  {repurposedContent.linkedInPosts[repurposeTab === 'li1' ? 0 : repurposeTab === 'li2' ? 1 : 2].content}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </section>
                );
              })()}

            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB: TOPIC COVERAGE
          ═══════════════════════════════════════════════════════════════ */}
          {tab === 'coverage' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              {/* Cluster bars */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Topic Clusters</h2>
                <div className="space-y-3">
                  {clusters.slice(0, 20).map((c) => (
                    <div key={c.slug} className="rounded-xl border border-gray-200 bg-white p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-gray-900">{c.name}</span>
                        <span className="text-xs text-gray-500">{c.posts} article{c.posts !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-gray-100">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${c.coverage}%`,
                            backgroundColor: c.coverage >= 80 ? '#16a34a' : c.coverage >= 40 ? '#d97706' : '#0A66C2',
                          }}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {c.titles.slice(0, 3).map((t) => (
                          <span key={t} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 truncate max-w-[180px]">{t}</span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {clusters.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-8">No published posts yet.</p>
                  )}
                </div>
              </section>

              {/* Content gaps list */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Pillar Gaps</h2>
                <div className="space-y-2">
                  {gaps.map((g, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${PRIORITY_COLOURS[g.priority]}`}>
                          {g.priority}
                        </span>
                        <span className="text-sm font-semibold text-gray-900">{g.topic}</span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed">{g.reason}</p>
                    </div>
                  ))}
                  {gaps.length === 0 && (
                    <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
                      <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">All pillar topics covered.</p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB: KNOWLEDGE GRAPH
          ═══════════════════════════════════════════════════════════════ */}
          {tab === 'graph' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* Existing relationships */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">
                  Blog Connections
                  <span className="ml-2 text-sm font-normal text-gray-400">({relationships.length})</span>
                </h2>
                <div className="space-y-2">
                  {relationships.map((r) => {
                    const src = posts.find((p) => p.id === r.source_blog_id);
                    const tgt = posts.find((p) => p.id === r.target_blog_id);
                    return (
                      <div key={r.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
                        <div className="flex-1 min-w-0 text-sm">
                          <span className="font-medium text-gray-900 truncate">{src?.title ?? r.source_blog_id}</span>
                          <span className="mx-2 text-xs rounded-full bg-gray-100 px-2 py-0.5 text-gray-500">
                            {RELATIONSHIP_LABELS[r.relationship_type as RelationshipType] ?? r.relationship_type}
                          </span>
                          <span className="font-medium text-gray-900 truncate">{tgt?.title ?? r.target_blog_id}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteRelationship(r.id)}
                          className="shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                  {relationships.length === 0 && (
                    <p className="text-sm text-gray-400 text-center py-6">No connections yet. Create one →</p>
                  )}
                </div>

                {/* Auto-suggested connections */}
                {inferred.length > 0 && (
                  <div className="mt-6">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700 flex items-center gap-1.5">
                      <Lightbulb className="h-4 w-4 text-amber-500" />
                      Suggested connections (shared tags)
                    </h3>
                    <div className="space-y-2">
                      {inferred.slice(0, 5).map((s, i) => (
                        <div key={i} className="flex items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
                          <div className="flex-1 min-w-0 text-sm text-gray-600">
                            <span className="font-medium">{s.sourceTitle}</span>
                            <span className="mx-2 text-gray-400">↔</span>
                            <span className="font-medium">{s.targetTitle}</span>
                            <span className="ml-2 text-xs text-gray-400">({s.sharedTags.slice(0, 2).join(', ')})</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setRelSource(s.sourceId);
                              setRelTarget(s.targetId);
                            }}
                            className="shrink-0 text-xs font-medium text-[#0B5ED7] hover:underline"
                          >
                            Connect
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Create relationship form */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Add Connection</h2>
                <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Source article</label>
                    <select
                      value={relSource}
                      onChange={(e) => setRelSource(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select…</option>
                      {posts.map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Relationship</label>
                    <select
                      value={relType}
                      onChange={(e) => setRelType(e.target.value as RelationshipType)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="related">Related</option>
                      <option value="prerequisite">Prerequisite (read source first)</option>
                      <option value="continuation">Continuation</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Target article</label>
                    <select
                      value={relTarget}
                      onChange={(e) => setRelTarget(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">Select…</option>
                      {posts.filter((p) => p.id !== relSource).map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={createRelationship}
                    disabled={!relSource || !relTarget || savingRel}
                    className="w-full rounded-lg bg-[#0B5ED7] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {savingRel ? 'Saving…' : 'Create connection'}
                  </button>
                </div>
              </section>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              TAB: SERIES
          ═══════════════════════════════════════════════════════════════ */}
          {tab === 'series' && (
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              {/* Series list */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">
                  Reading Series
                  <span className="ml-2 text-sm font-normal text-gray-400">({series.length})</span>
                </h2>
                <div className="space-y-4">
                  {series.map((s) => {
                    const postCount = s.blog_series_posts?.length ?? 0;
                    return (
                      <div key={s.id} className="rounded-2xl border border-gray-200 bg-white p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <BookOpen className="h-4 w-4 text-[#0A66C2] shrink-0" />
                              <h3 className="text-sm font-bold text-gray-900 truncate">{s.title}</h3>
                              <span className="text-xs text-gray-400">({postCount} part{postCount !== 1 ? 's' : ''})</span>
                            </div>
                            {s.description && (
                              <p className="mt-1 text-xs text-gray-500 leading-relaxed">{s.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditSeries(s)}
                              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSeries(s.id)}
                              className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Post list */}
                        {postCount > 0 && (
                          <ol className="mt-3 space-y-1 border-t border-gray-100 pt-3">
                            {[...(s.blog_series_posts ?? [])]
                              .sort((a, b) => a.position - b.position)
                              .map((sp, idx) => (
                                <li key={sp.blog_id} className="flex items-center gap-2 text-xs text-gray-600">
                                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#0A66C2]/10 text-[10px] font-bold text-[#0A66C2]">
                                    {idx + 1}
                                  </span>
                                  <span className="truncate">{sp.title || sp.blog_id}</span>
                                  {sp.status !== 'published' && (
                                    <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                                      draft
                                    </span>
                                  )}
                                </li>
                              ))}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                  {series.length === 0 && (
                    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
                      <BookOpen className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-400">No series yet — create your first reading path →</p>
                    </div>
                  )}
                </div>
              </section>

              {/* Create series form */}
              <section>
                <h2 className="mb-4 text-base font-bold text-gray-900">Create Series</h2>
                <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Series title *</label>
                    <input
                      type="text"
                      value={newSeriesTitle}
                      onChange={(e) => setNewSeriesTitle(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      placeholder="e.g. AI in Marketing"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                    <textarea
                      value={newSeriesDesc}
                      onChange={(e) => setNewSeriesDesc(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                      placeholder="What this series is about…"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={createSeries}
                    disabled={!newSeriesTitle.trim() || savingSeries}
                    className="w-full rounded-lg bg-[#0B5ED7] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {savingSeries ? 'Creating…' : 'Create series'}
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* ── Series edit modal ─────────────────────────────────────────────────── */}
      {editSeries && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="font-bold text-gray-900">Edit Series</h3>
              <button type="button" onClick={() => setEditSeries(null)}>
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Title</label>
                <input
                  value={editSeries.title}
                  onChange={(e) => setEditSeries({ ...editSeries, title: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
                <textarea
                  value={editSeries.description ?? ''}
                  onChange={(e) => setEditSeries({ ...editSeries, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
                />
              </div>

              {/* Post ordering */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-2">Posts (drag to reorder)</label>
                <div className="space-y-1.5">
                  {editPosts.map((sp, idx) => (
                    <div key={sp.blog_id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <span className="text-xs font-bold text-gray-400 w-4 text-center">{idx + 1}</span>
                      <span className="flex-1 text-sm text-gray-700 truncate">{sp.title || sp.blog_id}</span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            const next = [...editPosts];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setEditPosts(next);
                          }}
                          className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === editPosts.length - 1}
                          onClick={() => {
                            const next = [...editPosts];
                            [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                            setEditPosts(next);
                          }}
                          className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditPosts(editPosts.filter((_, i) => i !== idx))}
                          className="rounded p-0.5 text-gray-400 hover:text-red-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add post */}
                <div className="mt-2 flex gap-2">
                  <select
                    value={addPostId}
                    onChange={(e) => setAddPostId(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Add article…</option>
                    {posts
                      .filter((p) => !editPosts.find((ep) => ep.blog_id === p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={addPostToEdit}
                    disabled={!addPostId}
                    className="rounded-lg bg-gray-200 px-3 py-1.5 text-sm font-medium hover:bg-gray-300 disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
            <div className="flex gap-3 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={saveEditSeries}
                disabled={savingEdit}
                className="rounded-lg bg-[#0B5ED7] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditSeries(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
