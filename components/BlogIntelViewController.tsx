/** useBlogIntelViewController — state/handlers of BlogIntelView, verbatim. */
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

type S = ReturnType<typeof useBlogIntel>;

export function useBlogIntelViewController({ d }: { d: S }) {
  const {
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
  } = d;

  return {
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
  };
}
