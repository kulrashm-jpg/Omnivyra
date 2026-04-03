/**
 * Company Blog Intelligence Service
 *
 * Orchestrates all five intelligence engines for a company's blog portfolio:
 *   1. companyPerformanceAdapter  — DB → PostPerformance[]
 *   2. performanceEngine          — scores, health, topic performance, insights
 *   3. growthEngine               — per-post and portfolio growth actions
 *   4. topicDetection             — clusters, gaps, recommendations
 *   5. knowledgeGraph             — suggested internal link edges
 *
 * Pure orchestration — no business logic lives here.
 * Called by POST /api/blogs/intelligence (COMPANY_ADMIN only).
 */

import { supabase } from '../../backend/db/supabaseClient';
import {
  fetchCompanyPostPerformance,
  fetchCompanySeriesPostIds,
} from './companyPerformanceAdapter';
import {
  computeAllMetrics,
  computeTopicPerformance,
  generatePerformanceInsights,
  generateTopicNarratives,
  type PostMetrics,
  type TopicPerformance,
  type TopicNarrative,
  type PerformanceInsight,
} from './performanceEngine';
import {
  classifyPost,
  getRecoveryActions,
  getAmplificationActions,
  buildAuthorityLoop,
  buildGrowthSummary,
  type GrowthAction,
  type GrowthSummary,
  type AuthorityStage,
} from './growthEngine';
import {
  buildTopicClusters,
  detectContentGaps,
  generateRecommendations,
  type ContentGap,
  type ContentGapWarning,
  type Recommendation,
} from './topicDetection';
import {
  inferRelatedEdges,
  type BlogNode,
  type BlogEdge,
  type RelationshipType,
} from './knowledgeGraph';
import {
  computeSearchScores,
  type BlogPost as ScoringBlogPost,
  type SearchScores,
} from './searchScoringEngine';
import {
  analyzeOptimization,
  type OptimizationResult,
} from './optimizationEngine';

// ── Response types ────────────────────────────────────────────────────────────

export interface PostIntelligence {
  id:               string;
  title:            string;
  scores: {
    engagement: number;
    visibility: number;
    health:     PostMetrics['health'];
    scale:      '0-100';
  };
  search_scores: {
    seo: number;
    aeo: number;
    geo: number;
  };
  insights:         PerformanceInsight[];
  recovery_actions: GrowthAction[];
  growth_actions:   GrowthAction[];
  optimization:     OptimizationResult;
  internal_links:   number;
  references_count: number;
}

/** TopicPerformance extended with narrative classification from generateTopicNarratives(). */
export interface TopicPerformanceWithNarrative extends TopicPerformance {
  verdict:   TopicNarrative['verdict'];
  narrative: string;
}

export interface AuthorityIntelligence {
  current_stage: string;
  stages:        AuthorityStage[];
}

export interface PortfolioIntelligence {
  authority:         AuthorityIntelligence;
  growth_summary:    GrowthSummary;
  topic_performance: TopicPerformanceWithNarrative[];
  recommendations:   Recommendation[];
}

export type GapsWarning = ContentGapWarning | 'NO_DATA';

export interface GapsIntelligence {
  items:   ContentGap[];
  warning: GapsWarning | null;
}

export type SuggestedEdge = ReturnType<typeof inferRelatedEdges>[number];

export interface GraphIntelligence {
  suggested_edges: SuggestedEdge[];
}

export interface CompanyBlogIntelligenceResult {
  posts:     PostIntelligence[];
  portfolio: PortfolioIntelligence;
  gaps:      GapsIntelligence;
  graph:     GraphIntelligence;
}

// ── DB row types ──────────────────────────────────────────────────────────────

interface PillarRow {
  name: string;
  slug: string;
}

interface RelationshipRow {
  id:                string;
  source_blog_id:    string;
  target_blog_id:    string;
  relationship_type: string;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export async function runCompanyBlogIntelligence(
  companyId: string,
): Promise<CompanyBlogIntelligenceResult> {

  // ── Step 1+2: Fetch all data in parallel ──────────────────────────────────
  const [postsPerf, seriesPostIds, pillarsRes, relRes, blocksRes] = await Promise.all([

    // Adapter: blogs table + company_blog_performance_summary → PostPerformance[]
    fetchCompanyPostPerformance(companyId),

    // Adapter: company_blog_series_posts → Set<string>
    fetchCompanySeriesPostIds(companyId),

    // Pillar topics for content gap analysis
    supabase
      .from('company_blog_pillars')
      .select('name, slug')
      .eq('company_id', companyId)
      .order('priority', { ascending: true }),

    // Existing knowledge graph edges
    supabase
      .from('company_blog_relationships')
      .select('id, source_blog_id, target_blog_id, relationship_type')
      .eq('company_id', companyId),

    // Raw content_blocks for search scoring engine
    supabase
      .from('blogs')
      .select('id, content_blocks')
      .eq('company_id', companyId),
  ]);

  // Index content_blocks by blog id for O(1) lookup during per-post scoring
  const blocksById = new Map<string, unknown>(
    ((blocksRes.data ?? []) as Array<{ id: string; content_blocks: unknown }>)
      .map(row => [row.id, row.content_blocks]),
  );

  // ── Early return: no blogs ────────────────────────────────────────────────
  if (postsPerf.length === 0) {
    return {
      posts: [],
      portfolio: {
        authority: { current_stage: 'Write', stages: [] },
        growth_summary: {
          highCount: 0, mediumCount: 0, lowCount: 0,
          avgEngagement: 0, topPost: null, quickWins: [],
        },
        topic_performance: [],
        recommendations:   [],
      },
      gaps:  { items: [], warning: 'NO_DATA' },
      graph: { suggested_edges: [] },
    };
  }

  // ── Step 3: Performance engine ────────────────────────────────────────────
  const allMetrics      = computeAllMetrics(postsPerf, seriesPostIds);
  const topicPerf       = computeTopicPerformance(allMetrics);
  const perfInsights    = generatePerformanceInsights(allMetrics, seriesPostIds);
  const topicNarratives = generateTopicNarratives(topicPerf);

  // Build a per-slug insight index for O(1) per-post lookup
  const insightsBySlug = new Map<string, PerformanceInsight[]>();
  for (const insight of perfInsights) {
    if (!insight.targetSlug) continue;
    const existing = insightsBySlug.get(insight.targetSlug) ?? [];
    existing.push(insight);
    insightsBySlug.set(insight.targetSlug, existing);
  }

  // Merge topic performance with narrative classification
  const narrativeByCategory = new Map<string, TopicNarrative>(
    topicNarratives.map(n => [n.category, n]),
  );
  const topicPerfWithNarratives: TopicPerformanceWithNarrative[] = topicPerf.map(tp => {
    const n = narrativeByCategory.get(tp.category);
    return {
      ...tp,
      verdict:   n?.verdict   ?? 'deprioritize',
      narrative: n?.message   ?? '',
    };
  });

  // ── Step 4: Growth engine — portfolio level ───────────────────────────────
  const publishedMetrics = allMetrics.filter(m => m.status === 'published');
  const growthSummary    = buildGrowthSummary(publishedMetrics);

  // Portfolio authority: derived from top post's authority loop
  const topPostLoop: AuthorityStage[] = growthSummary.topPost
    ? buildAuthorityLoop(
        growthSummary.topPost,
        seriesPostIds.has(growthSummary.topPost.id),
      )
    : [];
  const authority: AuthorityIntelligence = {
    current_stage: topPostLoop.find(s => s.status === 'ready')?.label ?? 'Write',
    stages:        topPostLoop,
  };

  // ── Per-post output ───────────────────────────────────────────────────────
  const posts: PostIntelligence[] = allMetrics.map((m): PostIntelligence => {
    const isInSeries     = seriesPostIds.has(m.id);
    const cls            = classifyPost(m);

    // Recovery actions: low performers and medium performers need fixing
    const recovery_actions = cls !== 'high' ? getRecoveryActions(m) : [];
    // Growth/amplification actions: high and medium performers can be amplified
    const growth_actions   = cls !== 'low'  ? getAmplificationActions(m, isInSeries) : [];

    // Search scoring: SEO / AEO / GEO
    const scoringPost: ScoringBlogPost = {
      title:            m.title,
      tags:             m.tags,
      internal_links:   m.internal_links,
      references_count: m.references_count,
      content_blocks:   blocksById.get(m.id) ?? [],
    };
    const searchScores: SearchScores = computeSearchScores(scoringPost);
    const { seo_score, aeo_score, geo_score } = searchScores;
    const optimization = analyzeOptimization(scoringPost, searchScores);

    return {
      id:    m.id,
      title: m.title,
      scores: {
        engagement: m.engagement_score,
        visibility: m.visibility_score,
        health:     m.health,
        scale:      '0-100' as const,
      },
      search_scores: {
        seo: seo_score,
        aeo: aeo_score,
        geo: geo_score,
      },
      insights:         insightsBySlug.get(m.slug) ?? [],
      recovery_actions,
      growth_actions,
      optimization,
      internal_links:   m.internal_links,
      references_count: m.references_count,
    };
  });

  // ── Step 5: Topic detection ───────────────────────────────────────────────
  const clusters = buildTopicClusters(allMetrics);

  // ExistingPostMeta requires non-nullable category
  const existingPostMeta = allMetrics.map(m => ({
    id:       m.id,
    title:    m.title,
    slug:     m.slug,
    tags:     m.tags,
    category: m.category ?? '',
  }));

  const pillars  = (pillarsRes.data ?? []) as PillarRow[];
  const gapResult = detectContentGaps(clusters, existingPostMeta, pillars);

  // generateRecommendations requires ExistingPostMeta + content quality fields
  const postsForRecs = allMetrics.map(m => ({
    id:               m.id,
    title:            m.title,
    slug:             m.slug,
    tags:             m.tags,
    category:         m.category ?? '',
    views_count:      m.views_count,
    has_summary:      m.has_summary,
    internal_links:   m.internal_links,
    references_count: m.references_count,
  }));

  const recommendations = generateRecommendations(
    gapResult.gaps,
    clusters,
    postsForRecs,
  );

  // ── Step 6: Knowledge graph ───────────────────────────────────────────────
  // Nodes: published posts only (unpublished not discoverable)
  const nodes: BlogNode[] = allMetrics
    .filter(m => m.status === 'published')
    .map(m => ({
      id:           m.id,
      title:        m.title,
      slug:         m.slug,
      category:     m.category,
      tags:         m.tags,
      views_count:  m.views_count,
      published_at: m.published_at,
    }));

  // Build lookup maps to resolve IDs → titles/slugs for edge construction
  const titleById = new Map(allMetrics.map(m => [m.id, m.title]));
  const slugById  = new Map(allMetrics.map(m => [m.id, m.slug]));

  const existingEdges: BlogEdge[] = (
    (relRes.data ?? []) as RelationshipRow[]
  ).map(r => ({
    id:          r.id,
    sourceId:    r.source_blog_id,
    targetId:    r.target_blog_id,
    type:        r.relationship_type as RelationshipType,
    sourceTitle: titleById.get(r.source_blog_id) ?? '',
    targetTitle: titleById.get(r.target_blog_id) ?? '',
    sourceSlug:  slugById.get(r.source_blog_id)  ?? '',
    targetSlug:  slugById.get(r.target_blog_id)  ?? '',
  }));

  const suggested_edges = inferRelatedEdges(nodes, existingEdges);

  // ── Step 7: Combine ────────────────────────────────────────────────────────
  return {
    posts,
    portfolio: {
      authority,
      growth_summary:    growthSummary,
      topic_performance: topicPerfWithNarratives,
      recommendations,
    },
    gaps: {
      items:   gapResult.gaps,
      warning: gapResult.warning ?? null,
    },
    graph: {
      suggested_edges,
    },
  };
}
