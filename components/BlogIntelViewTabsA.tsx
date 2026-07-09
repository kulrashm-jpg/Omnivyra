/** BlogIntelViewTabsA — verbatim tab JSX of BlogIntelView (babel-verified sibling range 284-670). */
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

export default function BlogIntelViewTabsA({ f }: { f: ReturnType<typeof useBlogIntelViewController> }) {
  const {
    d,
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
                <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-wide text-blue-700 mb-1">Company Context for Recommendations</label>
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                    className="w-full rounded-md border border-blue-200 bg-white px-3 py-2 text-sm"
                  >
                    {companies.map((c) => (
                      <option key={c.company_id} value={c.company_id}>{c.name}</option>
                    ))}
                  </select>
                  {companyContextNote && (
                    <p className="mt-2 text-xs text-blue-700 line-clamp-2">{companyContextNote}</p>
                  )}
                </div>

                {/* Create Custom Blog Card with AI */}
                <div className="mb-4 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-sm">Create Custom Blog Card</h3>
                      <p className="text-xs text-gray-600 mt-1">Have a unique idea? Use AI to refine it into a structured recommendation card.</p>
                    </div>
                    <button
                      onClick={() => setIsAICardModalOpen(true)}
                      type="button"
                      className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-4 py-2 font-medium text-sm transition-all"
                    >
                      <Sparkles className="h-4 w-4" />
                      Create with AI
                    </button>
                  </div>
                </div>
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
                        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Company Context</p>
                          <p className="text-xs text-gray-700 line-clamp-2">{gap.brief.company_context}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Current Content</p>
                          <p className="text-xs text-gray-700 line-clamp-2">{gap.brief.current_content}</p>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Writing Style</p>
                          <p className="text-xs text-gray-700 line-clamp-2">{gap.brief.writing_style}</p>
                        </div>
                        {gap.relatedTo.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Builds on</p>
                            {gap.relatedTo.map((t) => (
                              <p key={t} className="text-xs text-[#0A66C2] truncate">→ {t}</p>
                            ))}
                          </div>
                        )}
                        <Link
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            const token = `sa_gap_brief_${Date.now()}_${i}`;
                            try {
                              sessionStorage.setItem(token, JSON.stringify(gap.brief));
                            } catch {
                              // Continue without storage token if browser blocks it.
                            }
                            void router.push({
                              pathname: '/admin/blog/generate',
                              query: {
                                prefill_source: 'superadmin_blog_intelligence',
                                prefill_topic: gap.topic,
                                prefill_reason: gap.reason,
                                prefill_related: gap.relatedTo.join('|'),
                                prefill_priority: gap.priority,
                                prefill_company_id: gap.brief.company_id,
                                prefill_brief: token,
                              },
                            });
                          }}
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
    </>
  );
}
