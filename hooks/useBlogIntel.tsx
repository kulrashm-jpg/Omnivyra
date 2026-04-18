'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  Loader2, Lightbulb, Network, BookOpen, TrendingUp, Rocket,
  Plus, Trash2, ChevronUp, ChevronDown, ExternalLink,
  AlertTriangle, CheckCircle2, ArrowRight, Pencil, X, Copy, Check,
  Zap, RefreshCw, BarChart2, XCircle, Sparkles,
} from 'lucide-react';
import {
  classifyPost, getAmplificationActions, getRecoveryActions,
  buildAuthorityLoop, buildGrowthSummary,
  type PerformanceClass,
} from '../lib/blog/growthEngine';
import {
  generateRepurposedContent, extractRepurposeInput,
  type RepurposedContent,
} from '../lib/blog/repurposingEngine';
import type { BriefInsight, DraftFieldSuggestions, TemplateSessionPayload, EnrichedGap } from '../pages/blogs.types';
import {
  buildTopicClusters,
  detectContentGaps,
  generateRecommendations,
  PLATFORM_DEFAULT_PILLARS,
  type TopicCluster,
  type ContentGap,
  type Recommendation,
  type ExistingPostMeta,
} from '../lib/blog/topicDetection';
import {
  inferRelatedEdges,
  RELATIONSHIP_LABELS,
  type RelationshipType,
  type BlogEdge,
} from '../lib/blog/knowledgeGraph';
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
} from '../lib/blog/performanceEngine';
import {
  buildWritingStyleProfile,
  formatStyleInstructions,
  type WritingStyleProfile,
} from '../lib/content/writingStyleEngine';
import type { CompanyProfile } from '../backend/services/companyProfileService';
import AIBlogCardModal from '../components/blog/AIBlogCardModal';

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

interface CompanyOption {
  company_id: string;
  name: string;
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


export function useBlogIntel() {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('recommendations');

  // ── Data state ────────────────────────────────────────────────────────────
  const [posts,         setPosts]         = useState<PostMeta[]>([]);
  const [series,        setSeries]        = useState<SeriesRow[]>([]);
  const [relationships, setRelationships] = useState<RelRow[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [companyContextNote, setCompanyContextNote] = useState('');
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);

  // ── AI Blog Card Modal state ──────────────────────────────────────────────
  const [isAICardModalOpen, setIsAICardModalOpen] = useState(false);

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

  useEffect(() => {
    let active = true;

    const loadCompanies = async () => {
      try {
        const r = await fetch('/api/company-profile?mode=list', { credentials: 'include' });
        if (!r.ok) return;
        const d = await r.json().catch(() => ({})) as { companies?: Array<{ company_id: string; name?: string }> };
        const list = (d.companies || [])
          .filter((c) => c.company_id)
          .map((c) => ({ company_id: c.company_id, name: c.name || c.company_id }));
        if (!active) return;
        setCompanies(list);

        const remembered = typeof window !== 'undefined' ? localStorage.getItem('selected_company_id') || '' : '';
        const next = remembered && list.some((c) => c.company_id === remembered)
          ? remembered
          : (list[0]?.company_id || '');
        setSelectedCompanyId(next);
      } catch {
        // non-blocking for intelligence dashboard
      }
    };

    void loadCompanies();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedCompanyId) {
      setCompanyContextNote('');
      return;
    }

    const loadCompanyContext = async () => {
      try {
        const r = await fetch(`/api/company-profile?companyId=${encodeURIComponent(selectedCompanyId)}`, { credentials: 'include' });
        if (!r.ok) {
          setCompanyContextNote('');
          setCompanyProfile(null);
          return;
        }
        const d = await r.json().catch(() => ({})) as { profile?: Record<string, unknown> };
        const rawProfile = d.profile || {};

        // Store full profile for WritingStyleEngine use in brief enrichment
        setCompanyProfile(rawProfile as CompanyProfile);

        const industry = typeof rawProfile.industry === 'string' ? rawProfile.industry : '';
        const audience = typeof rawProfile.target_audience === 'string'
          ? rawProfile.target_audience
          : (typeof rawProfile.audience === 'string' ? rawProfile.audience : '');
        const voice = typeof rawProfile.brand_voice === 'string'
          ? rawProfile.brand_voice
          : (typeof rawProfile.writing_style === 'string' ? rawProfile.writing_style : '');

        const parts = [industry, audience, voice].map((x) => (x || '').trim()).filter(Boolean);
        setCompanyContextNote(parts.join(' | '));
      } catch {
        setCompanyContextNote('');
        setCompanyProfile(null);
      }
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem('selected_company_id', selectedCompanyId);
    }

    void loadCompanyContext();
  }, [selectedCompanyId]);

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
    if (!posts.length) return { clusters: [], gaps: [] as EnrichedGap[], recommendations: [], inferred: [] };

    const clusters    = buildTopicClusters(posts);
    const gapResult   = detectContentGaps(clusters, posts, PLATFORM_DEFAULT_PILLARS);
    const recs        = generateRecommendations(gapResult.gaps, clusters, posts);

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

    const selectedCompany = companies.find((c) => c.company_id === selectedCompanyId);
    const topTags = posts
      .flatMap((p) => p.tags || [])
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

    // ── Writing style: use engine when profile is available ─────────────────
    let styleProfile: WritingStyleProfile | null = null;
    let writingStyleText: string;

    if (companyProfile) {
      styleProfile = buildWritingStyleProfile(companyProfile);
      writingStyleText = formatStyleInstructions(styleProfile);
      // Append content-level continuity hints derived from existing posts
      if (frequentTags.length > 0) {
        writingStyleText += `\n  Maintain topical continuity with tags: ${frequentTags.join(', ')}`;
      }
    } else {
      // Fallback when no profile is loaded yet
      writingStyleText = [
        'Lead with a concrete business problem in opening paragraph.',
        'Use authoritative, evidence-led tone with actionable takeaways.',
        frequentTags.length > 0
          ? `Maintain topical continuity with tags: ${frequentTags.join(', ')}.`
          : 'Maintain topical continuity with existing category language.',
        'Include internal linking opportunities and end with practical summary.',
      ].join(' ');
    }

    // Derive tone from style profile if available
    const toneText = styleProfile?.tone_summary
      ? styleProfile.tone_summary
      : 'Confident, analytical, and practical';

    const enrichedGaps: EnrichedGap[] = gapResult.gaps.map((gap) => {
      const relatedTitles = posts
        .filter((p) => gap.relatedTo.some((r) => p.title.toLowerCase().includes(r.toLowerCase()) || r.toLowerCase().includes(p.title.toLowerCase())))
        .slice(0, 3)
        .map((p) => p.title);

      const bestPerformers = [...posts]
        .filter((p) => p.status === 'published')
        .sort((a, b) => (b.views_count || 0) - (a.views_count || 0))
        .slice(0, 3)
        .map((p) => p.title);

      const currentContent = relatedTitles.length > 0
        ? `Existing coverage: ${relatedTitles.join('; ')}. Expand beyond repeated angles.`
        : `No direct coverage yet. Reference adjacent winners: ${bestPerformers.join('; ') || 'none available'}.`;

      const brief: BriefInsight = {
        company_id: selectedCompanyId,
        company_name: selectedCompany?.name || selectedCompanyId || 'Selected Company',
        company_context: companyContextNote || 'No company profile context available. Use selected company context fields during generation.',
        current_content: currentContent,
        writing_style: writingStyleText,
        writing_style_profile: styleProfile,
        related_titles: relatedTitles,
        intent: gap.priority === 'high' ? 'authority' : gap.priority === 'medium' ? 'conversion' : 'awareness',
        tone: toneText,
      };

      return { ...gap, brief };
    });

    return { clusters, gaps: enrichedGaps, recommendations: recs, inferred };
  }, [posts, relationships, selectedCompanyId, companyContextNote, companyProfile, companies]);

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

  // ── AI Blog Card handler ───────────────────────────────────────────────────
  const handleAICardCreated = (card: any) => {
    // In future, this could add the card to a pending recommendations list
    // For now, navigate to the blog generation page with the card details
    const token = `ai_card_${Date.now()}`;
    try {
      sessionStorage.setItem(token, JSON.stringify(card));
    } catch {
      // Continue without storage token if browser blocks it
    }
    void router.push({
      pathname: '/admin/blog/generate',
      query: {
        prefill_source: 'superadmin_ai_card_creation',
        prefill_topic: card.topic,
        prefill_reason: card.reason,
        prefill_priority: card.priority || 'medium',
        prefill_company_id: selectedCompanyId,
        prefill_intent: card.intent,
        prefill_tone: card.tone,
        prefill_card: token,
      },
    });
  };
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

  const _isLoading = loading;
  const _hasError = error;

  const publishedPosts = posts.filter((p) => p.status === 'published');

  // ── Render ─────────────────────────────────────────────────────────────────

  return {
    _hasError,
    _isLoading,
    addPostId,
    addPostToEdit,
    allMetrics,
    classifiedMetrics,
    clusters,
    companies,
    companyContextNote,
    companyProfile,
    copiedKey,
    copyToClipboard,
    createRelationship,
    createSeries,
    deleteRelationship,
    deleteSeries,
    distQueue,
    editPosts,
    editSeries,
    error,
    gaps,
    generateRepurpose,
    generatingRep,
    growthSummary,
    growthTier,
    handleAICardCreated,
    inferred,
    isAICardModalOpen,
    loading,
    narratives,
    newSeriesDesc,
    newSeriesTitle,
    openEditSeries,
    perfInsights,
    posts,
    publishedPosts,
    recommendations,
    relSource,
    relTarget,
    relType,
    relationships,
    repurposeTab,
    repurposedContent,
    router,
    saveEditSeries,
    savingEdit,
    savingRel,
    savingSeries,
    selectedCompanyId,
    selectedGrowthId,
    series,
    seriesPostIdSet,
    setAddPostId,
    setCompanies,
    setCompanyContextNote,
    setCompanyProfile,
    setCopiedKey,
    setEditPosts,
    setEditSeries,
    setError,
    setGeneratingRep,
    setGrowthTier,
    setIsAICardModalOpen,
    setLoading,
    setNewSeriesDesc,
    setNewSeriesTitle,
    setPosts,
    setRelSource,
    setRelTarget,
    setRelType,
    setRelationships,
    setRepurposeTab,
    setRepurposedContent,
    setSavingEdit,
    setSavingRel,
    setSavingSeries,
    setSelectedCompanyId,
    setSelectedGrowthId,
    setSeries,
    setTab,
    tab,
    topicPerf,
  };
}
