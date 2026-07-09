/** BlogIntelView — thin composition: controller + header/frame JSX + tab sections. */
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
import type { BriefInsight } from '../pages/blogs.types';
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
import type { CompanyProfile } from '../lib/shared/companyProfileTypes';
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

import type { useBlogIntel } from '../hooks/useBlogIntel';
import { useBlogIntelViewController } from './BlogIntelViewController';
import BlogIntelViewTabsA from './BlogIntelViewTabsA';
import BlogIntelViewTabsB from './BlogIntelViewTabsB';

type S = ReturnType<typeof useBlogIntel>;

export default function BlogIntelView({ d }: { d: S }) {
  const f = useBlogIntelViewController({ d });
  const {
    _hasError, _isLoading, addPostId, addPostToEdit, allMetrics, classifiedMetrics, clusters, companies, companyContextNote, companyProfile,
    copiedKey, copyToClipboard, createRelationship, createSeries, deleteRelationship, deleteSeries, distQueue, editPosts, editSeries, error,
    gaps, generateRepurpose, generatingRep, growthSummary, growthTier, handleAICardCreated, inferred, isAICardModalOpen, loading, narratives,
    newSeriesDesc, newSeriesTitle, openEditSeries, perfInsights, posts, publishedPosts, recommendations, relSource, relTarget, relType,
    relationships, repurposeTab, repurposedContent, router, saveEditSeries, savingEdit, savingRel, savingSeries, selectedCompanyId,
    selectedGrowthId, series, seriesPostIdSet, setAddPostId, setCompanies, setCompanyContextNote, setCompanyProfile, setCopiedKey,
    setEditPosts, setEditSeries, setError, setGeneratingRep, setGrowthTier, setIsAICardModalOpen, setLoading, setNewSeriesDesc,
    setNewSeriesTitle, setPosts, setRelSource, setRelTarget, setRelType, setRelationships, setRepurposeTab, setRepurposedContent,
    setSavingEdit, setSavingRel, setSavingSeries, setSelectedCompanyId, setSelectedGrowthId, setSeries, setTab, tab, topicPerf
  } = f;
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

          <BlogIntelViewTabsA f={f} />
          <BlogIntelViewTabsB f={f} />
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

      {/* AI Blog Card Creation Modal */}
      <AIBlogCardModal
        isOpen={isAICardModalOpen}
        onClose={() => setIsAICardModalOpen(false)}
        companyId={selectedCompanyId}
        companyName={companies.find((c) => c.company_id === selectedCompanyId)?.name || 'Your Company'}
        companyContext={companyContextNote}
        existingTopics={gaps.map((g) => g.topic)}
        writingStyleGuide={companyProfile ? formatStyleInstructions(buildWritingStyleProfile(companyProfile)) : ''}
        onCardCreated={handleAICardCreated}
      />
    </>
  );
}
