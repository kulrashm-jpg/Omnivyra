/**
 * GET /api/reports/[reportId]?type=snapshot|performance|growth
 *
 * Reads the stored intelligence snapshot from reports.data and maps it
 * to a CMO-friendly view payload for the given report type.
 *
 * All data originates from runCompanyBlogIntelligence — no re-computation here.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import { renderReportPdf } from '../../../backend/services/export/reportPdfRenderer';
import { buildBusinessImpact } from '../../../backend/services/businessImpactFormatter';
import { sanitizeReportViewPayload } from '../../../backend/services/reportContentSanitizationService';
import {
  buildExpectedUpside,
  classifyPriorityType,
  comparePriorityType,
  describePriorityType,
  type PriorityType,
} from '../../../backend/services/actionPriorityService';
import {
  startAsyncReportGeneration,
  type ReportRecord,
} from '../../../backend/services/reportCardService';
import type {
  CompanyBlogIntelligenceResult,
  PostIntelligence,
} from '../../../lib/blog/companyBlogIntelligenceService';

// ── Task 6: canonical type derived from the intelligence engine ───────────────
export type ReportIntelligenceData = CompanyBlogIntelligenceResult;

/** Reports older than this are considered stale. */
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ── View-layer types (consumed by [reportId].tsx) ─────────────────────────────

export type ReportViewInsight = {
  text: string;
  icon: 'alert' | 'trend';
  whyItMatters: string;
  businessImpact: string;
};

export type ReportViewMetric = {
  label: string;
  score: number;
  color: string;
};

export type ReportViewOpportunity = {
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  priority: string;
};

export type ReportViewNextStep = {
  action: string;
  description: string;
  steps: string[];
  expectedOutcome: string;
  expectedUpside: string;
  impactScore: number;
  effortLevel: 'low' | 'medium' | 'high';
  priorityType: PriorityType;
  priorityWhy: string;
};

export type ReportViewTopPriority = {
  title: string;
  whyNow: string;
  expectedOutcome: string;
  expectedUpside: string;
  effortLevel: 'low' | 'medium' | 'high';
  priorityType: PriorityType;
  priorityWhy: string;
  impactScore: number;
  confidenceScore: number;
  impactLabel: string;
  timeToImpact: string;
};

export type ReportViewSeoVisuals = {
  seoCapabilityRadar: {
    technical_seo_score: number | null;
    keyword_research_score: number | null;
    rank_tracking_score: number | null;
    backlinks_score: number | null;
    competitor_intelligence_score: number | null;
    content_quality_score: number | null;
    confidence: 'high' | 'medium' | 'low';
    data_source_strength?: {
      technical_seo_score: 'strong' | 'inferred' | 'weak' | 'missing';
      keyword_research_score: 'strong' | 'inferred' | 'weak' | 'missing';
      rank_tracking_score: 'strong' | 'inferred' | 'weak' | 'missing';
      backlinks_score: 'strong' | 'inferred' | 'weak' | 'missing';
      competitor_intelligence_score: 'strong' | 'inferred' | 'weak' | 'missing';
      content_quality_score: 'strong' | 'inferred' | 'weak' | 'missing';
    };
    source_tags?: {
      technical_seo_score: string[] | null;
      keyword_research_score: string[] | null;
      rank_tracking_score: string[] | null;
      backlinks_score: string[] | null;
      competitor_intelligence_score: string[] | null;
      content_quality_score: string[] | null;
    };
    tooltips: Record<string, string>;
    insightSentence: string;
  };
  opportunityCoverageMatrix: {
    opportunities: Array<{
      keyword: string;
      opportunity_score: number;
      coverage_score: number;
      opportunity_value_score?: number | null;
      priority_bucket?: 'quick_win' | 'strategic' | 'low_priority' | null;
      confidence: 'high' | 'medium' | 'low';
    }>;
    confidence: 'high' | 'medium' | 'low';
    opportunityReasoning: string;
    insightSentence: string;
  };
  searchVisibilityFunnel: {
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    estimated_lost_clicks: number | null;
    confidence: 'high' | 'medium' | 'low';
    drop_off_reason_distribution?: {
      ranking_issue_pct: number | null;
      ctr_issue_pct: number | null;
      intent_mismatch_pct: number | null;
    };
    tooltips: Record<string, string>;
    insightSentence: string;
  };
  crawlHealthBreakdown: {
    metadata_issues: number | null;
    structure_issues: number | null;
    internal_link_issues: number | null;
    crawl_depth_issues: number | null;
    confidence: 'high' | 'medium' | 'low';
    severity_split?: {
      critical: number | null;
      moderate: number | null;
      low: number | null;
      classification: 'classified' | 'unclassified';
    };
    tooltips: Record<string, string>;
    insightSentence: string;
  };
};

export type ReportViewSeoExecutiveSummary = {
  overallHealthScore: number;
  primaryProblem: {
    title: string;
    impactedArea: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
    severity: 'critical' | 'moderate' | 'low';
    reasoning: string;
    ifNotAddressed: string;
  };
  top3Actions: Array<{
    actionTitle: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
    reasoning: string;
  }>;
  growthOpportunity: {
    title: string;
    estimatedUpside: string;
    basedOn: string;
  } | null;
  confidence: 'high' | 'medium' | 'low';
};

export type ReportViewGeoAeoVisuals = {
  aiAnswerPresenceRadar: {
    answer_coverage_score: number | null;
    entity_clarity_score: number | null;
    topical_authority_score: number | null;
    citation_readiness_score: number | null;
    content_structure_score: number | null;
    freshness_score: number | null;
    confidence: 'high' | 'medium' | 'low';
    data_source_strength: 'strong' | 'inferred' | 'weak' | 'missing';
    source_tags: string[] | null;
  };
  queryAnswerCoverageMap: {
    queries: Array<{
      query: string;
      coverage: 'full' | 'partial' | 'missing';
      answer_quality_score: number;
    }>;
    confidence: 'high' | 'medium' | 'low';
  };
  answerExtractionFunnel: {
    total_queries: number | null;
    answerable_content_pct: number | null;
    structured_content_pct: number | null;
    citation_ready_pct: number | null;
    confidence: 'high' | 'medium' | 'low';
    drop_off_reason_distribution: {
      answer_gap_pct: number | null;
      structure_gap_pct: number | null;
      citation_gap_pct: number | null;
    };
  };
  entityAuthorityMap: {
    entities: Array<{
      entity: string;
      relevance_score: number;
      coverage_score: number;
    }>;
    confidence: 'high' | 'medium' | 'low';
  };
};

export type ReportViewGeoAeoExecutiveSummary = {
  overallAiVisibilityScore: number;
  primaryGap: {
    title: string;
    type: 'answer_gap' | 'entity_gap' | 'structure_gap';
    severity: 'critical' | 'moderate' | 'low';
    reasoning: string;
    ifNotAddressed: string;
  };
  top3Actions: Array<{
    actionTitle: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
    reasoning: string;
  }>;
  visibilityOpportunity: {
    title: string;
    estimatedAiExposure: string;
    basedOn: string;
  } | null;
  confidence: 'high' | 'medium' | 'low';
};

export type ReportViewUnifiedIntelligenceSummary = {
  unifiedScore: number;
  marketContextSummary: string;
  dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced';
  primaryConstraint: {
    title: string;
    source: 'seo' | 'geo_aeo';
    severity: 'critical' | 'moderate' | 'low';
    reasoning: string;
    ifNotAddressed: string;
  };
  top3UnifiedActions: Array<{
    actionTitle: string;
    source: 'seo' | 'geo_aeo';
    priority: 'high' | 'medium' | 'low';
    expectedImpact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    reasoning: string;
  }>;
  growthDirection: {
    shortTermFocus: string;
    longTermFocus: string;
  };
  confidence: 'high' | 'medium' | 'low';
};

export type ReportViewProgressComparison = {
  previous_report_id: string;
  current_report_id: string;
  unified_score_change: number | null;
  seo_changes: {
    health_score_delta: number | null;
    impressions_delta: number | null;
    clicks_delta: number | null;
    ctr_delta: number | null;
  };
  geo_aeo_changes: {
    ai_visibility_delta: number | null;
    answer_coverage_delta: number | null;
    citation_readiness_delta: number | null;
  };
  competitor_changes: {
    position_change: number | null;
    gap_reduction_score: number | null;
  };
  data_status: 'complete' | 'partial' | 'insufficient';
  summary: {
    overall_trend: 'improving' | 'declining' | 'stable';
    biggest_gain: string;
    biggest_drop: string;
  };
} | null;

export type ReportViewCompetitorVisuals = {
  competitorPositioningRadar: {
    competitors: Array<{
      name: string;
      domain: string;
      content_score: number;
      keyword_coverage_score: number;
      authority_score: number;
      technical_score: number;
      ai_answer_presence_score: number;
    }>;
    user: {
      content_score: number;
      keyword_coverage_score: number;
      authority_score: number;
      technical_score: number;
      ai_answer_presence_score: number;
    };
    confidence: 'high' | 'medium' | 'low';
  };
  keywordGapAnalysis: {
    missing_keywords: string[];
    weak_keywords: string[];
    strong_keywords: string[];
    confidence: 'high' | 'medium' | 'low';
  };
  aiAnswerGapAnalysis: {
    missing_answers: string[];
    weak_answers: string[];
    strong_answers: string[];
    confidence: 'high' | 'medium' | 'low';
  };
};

export type ReportViewCompetitorIntelligenceSummary = {
  topCompetitor: string;
  competitorExplanation: string;
  primaryGap: {
    title: string;
    type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
    severity: 'critical' | 'moderate' | 'low';
    reasoning: string;
    ifNotAddressed: string;
  };
  top3Actions: Array<{
    actionTitle: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    reasoning: string;
  }>;
  competitivePosition: 'leader' | 'competitive' | 'lagging';
  confidence: 'high' | 'medium' | 'low';
} | null;

export type ReportViewCompetitorMovementComparison = {
  previous_report_id: string;
  current_report_id: string;
  competitors: Array<{
    domain: string;
    previous_scores: {
      content_score: number;
      keyword_coverage_score: number;
      authority_score: number;
      technical_score: number;
      ai_answer_presence_score: number;
    };
    current_scores: {
      content_score: number;
      keyword_coverage_score: number;
      authority_score: number;
      technical_score: number;
      ai_answer_presence_score: number;
    };
    delta: {
      content_delta: number | null;
      keyword_delta: number | null;
      authority_delta: number | null;
      technical_delta: number | null;
      ai_answer_delta: number | null;
    };
    movement: 'improving' | 'declining' | 'stable';
  }>;
  user_vs_competitor_shift: {
    closest_competitor: string;
    gap_change: number | null;
    direction: 'closing_gap' | 'widening_gap' | 'unchanged';
  };
  data_status: 'complete' | 'partial' | 'insufficient';
  summary: {
    overall_trend: 'improving' | 'declining' | 'stable';
    key_movement: string;
  };
} | null;

export type ReportViewTimelineComparison = {
  snapshots: Array<{
    report_id: string;
    created_at: string;
    unified_score: number | null;
    competitor: {
      domain: string;
      score: number;
    } | null;
    delta_from_previous: number | null;
  }>;
  meta: {
    trend: 'improving' | 'declining' | 'stable';
    total_change: number | null;
    data_points: number;
    data_status: 'complete' | 'partial' | 'insufficient';
  };
} | null;

export type ReportViewStrategicScore = {
  value: number;
  label: 'strong strategic position' | 'developing position' | 'constrained position';
  strategic_score_change: number | null;
  movement: 'improving' | 'declining' | 'stable';
  primary_driver: string;
  interpretation: string;
  confidence: 'high' | 'medium' | 'low';
  strategic_score_breakdown: {
    position: {
      state: 'below market' | 'at parity' | 'ahead';
      score: number;
      weight: number;
    };
    growth: {
      state: 'improving' | 'stable' | 'declining';
      score: number;
      weight: number;
    };
    risk: {
      state: 'high' | 'medium' | 'low';
      score: number;
      weight: number;
    };
    positioning: {
      state: 'weak' | 'moderate' | 'strong';
      score: number;
      weight: number;
    };
  };
};

export type ReportViewPayload = {
  reportId: string;
  companyId: string;
  domain: string;
  reportType: 'snapshot' | 'performance' | 'growth';
  generatedDate: string;
  generated_at: string;
  is_stale: boolean;
  engine_version: string;
  status: 'generating' | 'completed' | 'failed';
  title: string;
  companyContext?: {
    companyName: string | null;
    domain: string | null;
    homepageHeadline: string | null;
    tagline: string | null;
    primaryOffering: string | null;
    positioning: string | null;
    marketContext: string | null;
    positioningStrength?: 'strong' | 'moderate' | 'weak';
    positioningNarrative?: string;
    positioningGap?: string | null;
    marketType?: 'competitive' | 'saturated' | 'emerging' | 'niche';
    marketNarrative?: string;
    strategyAlignment?: string;
    marketPosition?: 'below market' | 'at parity' | 'ahead';
    marketPositionStatement?: string;
    positionImplication?: string;
    executionRisk?: string;
    resilienceGuidance?: string;
  };
  diagnosis: string;
  summary: string;
  overallScore: number;
  scoreExplanation?: {
    dimensions: Array<{ key: string; label: string; value: number; explanation: string }>;
    weakestDimensions: Array<{ key: string; label: string; value: number }>;
    limitingFactors: string[];
    growthPath: {
      currentLevel: string;
      nextLevel: string | null;
      focus: string[];
      projectedScoreImprovements: Array<{
        dimension: string;
        currentValue: number;
        projectedValue: number;
        projectedTotalScore: number;
      }>;
    };
  };
  confidenceSource: string;
  insights: ReportViewInsight[];
  metrics: ReportViewMetric[];
  opportunities: ReportViewOpportunity[];
  competitorContext?: {
    summary: string;
    competitors: Array<{
      name: string;
      domain: string | null;
      classification: string;
      source: string;
      relevanceScore: number;
      rationale: string;
      standing: 'Behind' | 'At Par' | 'Ahead';
    }>;
    strongestGaps: Array<{
      gapType: string;
      title: string;
      whyItMatters: string;
      confidenceScore: number;
      impactScore: number;
      leadingCompetitors: string[];
    }>;
  };
  seoExecutiveSummary?: ReportViewSeoExecutiveSummary;
  seoVisuals?: ReportViewSeoVisuals;
  geoAeoVisuals?: ReportViewGeoAeoVisuals;
  geoAeoExecutiveSummary?: ReportViewGeoAeoExecutiveSummary;
  unifiedIntelligenceSummary?: ReportViewUnifiedIntelligenceSummary;
  competitorVisuals?: ReportViewCompetitorVisuals;
  competitorIntelligenceSummary?: ReportViewCompetitorIntelligenceSummary;
  progressComparison?: ReportViewProgressComparison;
  competitorMovementComparison?: ReportViewCompetitorMovementComparison;
  timelineComparison?: ReportViewTimelineComparison;
  strategicScore?: ReportViewStrategicScore;
  decisionSnapshot?: {
    primaryFocusArea: string;
    whatsBroken: string;
    whatToFixFirst: string;
    whatToDelay: string;
    ifIgnored: string;
    executionSequence: string[];
    ifExecutedWell: string;
    whenToExpectImpact: {
      shortTerm: string;
      midTerm: string;
      longTerm: string;
    };
    impactScale: 'high_impact' | 'medium_impact' | 'foundational_impact';
    currentState: string;
    expectedState: string;
    outcomeConfidence: 'high' | 'medium' | 'low';
  };
  topPriorities: ReportViewTopPriority[];
  nextSteps: ReportViewNextStep[];
};

type ReportApiRow = Pick<
  ReportRecord,
  'id' | 'company_id' | 'user_id' | 'domain' | 'report_type' | 'status' | 'created_at' | 'data' | 'metadata'
>;

function buildGeneratingPayload(
  reportId: string,
  companyId: string,
  domain: string,
  reportType: 'snapshot' | 'performance' | 'growth',
  createdAt: string,
): ReportViewPayload {
  return {
    reportId,
    companyId,
    domain,
    reportType,
    generatedDate: createdAt,
    generated_at: createdAt,
    is_stale: false,
    engine_version: 'v1',
    status: 'generating',
    title: '',
    diagnosis: '',
    summary: '',
    overallScore: 0,
    confidenceSource: '',
    insights: [],
    metrics: [],
    opportunities: [],
    topPriorities: [],
    nextSteps: [],
  };
}

async function requeueIncompleteReport(report: ReportApiRow): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('reports')
    .update({
      status: 'generating',
      updated_at: now,
      completed_at: null,
      error_message: null,
    })
    .eq('id', report.id)
    .eq('status', 'completed');

  if (error) {
    console.error('[reports/[reportId]] failed to requeue incomplete report:', error);
    return;
  }

  startAsyncReportGeneration(report as ReportRecord);
}

// ── Mappers: CompanyBlogIntelligenceResult → ReportViewPayload ────────────────

type ComposedReportSection = {
  section_name?: string;
  IU_ids?: string[];
  insights?: Array<{
    title?: string;
    description?: string;
    why_it_matters?: string;
    business_impact?: string;
    issue_type?: string;
    confidence_score?: number;
    impact_score?: number;
    recommendation?: string;
    action_type?: string;
  }>;
  opportunities?: Array<{
    title?: string;
    recommendation?: string;
    confidence_score?: number;
    action_type?: string;
  }>;
  actions?: Array<{
    title?: string;
    recommendation?: string;
    steps?: string[];
    expected_outcome?: string;
    expected_upside?: string;
    effort_level?: 'low' | 'medium' | 'high';
    priority_type?: PriorityType;
    confidence_score?: number;
    impact_score?: number;
    action_type?: string;
    action_payload?: Record<string, unknown>;
  }>;
};

type ComposedReportData = {
  report_type?: 'snapshot' | 'performance' | 'growth';
  score?: {
    available?: boolean;
    value?: number | null;
    label?: string | null;
    dimensions?: Array<{ key?: string; label?: string; value?: number; explanation?: string }>;
    weakest_dimensions?: Array<{ key?: string; label?: string; value?: number }>;
    limiting_factors?: string[];
    growth_path?: {
      current_level?: string;
      next_level?: string | null;
      focus?: string[];
      projected_score_improvements?: Array<{
        dimension?: string;
        current_value?: number;
        projected_value?: number;
        projected_total_score?: number;
      }>;
    };
  };
  diagnosis?: string;
  summary?: string;
  company_context?: {
    company_name?: string | null;
    domain?: string | null;
    homepage_headline?: string | null;
    tagline?: string | null;
    primary_offering?: string | null;
    positioning?: string | null;
    market_context?: string | null;
    positioning_strength?: 'strong' | 'moderate' | 'weak';
    positioning_narrative?: string;
    positioning_gap?: string | null;
    market_type?: 'competitive' | 'saturated' | 'emerging' | 'niche';
    market_narrative?: string;
    strategy_alignment?: string;
    market_position?: 'below market' | 'at parity' | 'ahead';
    market_position_statement?: string;
    position_implication?: string;
    execution_risk?: string;
    resilience_guidance?: string;
  };
  competitor_intelligence?: {
    summary?: string;
    detected_competitors?: Array<{
      name?: string;
      domain?: string | null;
      classification?: string;
      source?: string;
      relevance_score?: number;
      rationale?: string;
    }>;
    comparison?: {
      competitors?: Array<{
        competitor?: {
          name?: string;
          domain?: string | null;
        };
        deltas_vs_company?: {
          content_depth?: number;
          authority_score?: number;
          publishing_frequency?: number;
          engagement_score?: number;
          seo_coverage?: number;
          geo_presence?: number;
          aeo_readiness?: number;
        };
      }>;
    };
    generated_gaps?: Array<{
      gap_type?: string;
      title?: string;
      why_it_matters?: string;
      confidence_score?: number;
      impact_score?: number;
      leading_competitors?: string[];
    }>;
    discovery_metadata?: {
      serp_status?: 'live' | 'fallback';
      serp_domains_found?: number;
      is_fallback_used?: boolean;
    };
  };
  top_priorities?: Array<{
    title?: string;
    why_now?: string;
    expected_outcome?: string;
    expected_upside?: string;
    effort_level?: 'low' | 'medium' | 'high';
    priority_type?: PriorityType;
    impact_score?: number;
    confidence_score?: number;
  }>;
  visual_intelligence?: {
    seo_capability_radar?: {
      technical_seo_score?: number | null;
      keyword_research_score?: number | null;
      rank_tracking_score?: number | null;
      backlinks_score?: number | null;
      competitor_intelligence_score?: number | null;
      content_quality_score?: number | null;
      confidence?: 'high' | 'medium' | 'low';
      data_source_strength?: {
        technical_seo_score?: 'strong' | 'inferred' | 'weak' | 'missing';
        keyword_research_score?: 'strong' | 'inferred' | 'weak' | 'missing';
        rank_tracking_score?: 'strong' | 'inferred' | 'weak' | 'missing';
        backlinks_score?: 'strong' | 'inferred' | 'weak' | 'missing';
        competitor_intelligence_score?: 'strong' | 'inferred' | 'weak' | 'missing';
        content_quality_score?: 'strong' | 'inferred' | 'weak' | 'missing';
      };
      source_tags?: {
        technical_seo_score?: string[] | null;
        keyword_research_score?: string[] | null;
        rank_tracking_score?: string[] | null;
        backlinks_score?: string[] | null;
        competitor_intelligence_score?: string[] | null;
        content_quality_score?: string[] | null;
      };
    };
    opportunity_coverage_matrix?: {
      opportunities?: Array<{
        keyword?: string;
        opportunity_score?: number;
        coverage_score?: number;
        opportunity_value_score?: number | null;
        priority_bucket?: 'quick_win' | 'strategic' | 'low_priority' | null;
        confidence?: 'high' | 'medium' | 'low';
      }>;
      confidence?: 'high' | 'medium' | 'low';
      opportunity_reasoning?: string;
    };
    search_visibility_funnel?: {
      impressions?: number | null;
      clicks?: number | null;
      ctr?: number | null;
      estimated_lost_clicks?: number | null;
      confidence?: 'high' | 'medium' | 'low';
      drop_off_reason_distribution?: {
        ranking_issue_pct?: number | null;
        ctr_issue_pct?: number | null;
        intent_mismatch_pct?: number | null;
      };
    };
    crawl_health_breakdown?: {
      metadata_issues?: number | null;
      structure_issues?: number | null;
      internal_link_issues?: number | null;
      crawl_depth_issues?: number | null;
      confidence?: 'high' | 'medium' | 'low';
      severity_split?: {
        critical?: number | null;
        moderate?: number | null;
        low?: number | null;
        classification?: 'classified' | 'unclassified';
      };
    };
  };
  seo_executive_summary?: {
    overall_health_score?: number;
    primary_problem?: {
      title?: string;
      impacted_area?: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity?: 'critical' | 'moderate' | 'low';
      reasoning?: string;
      if_not_addressed?: string;
    };
    top_3_actions?: Array<{
      action_title?: string;
      priority?: 'high' | 'medium' | 'low';
      expected_impact?: 'high' | 'medium' | 'low';
      effort?: 'low' | 'medium' | 'high';
      linked_visual?: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning?: string;
    }>;
    growth_opportunity?: {
      title?: string;
      estimated_upside?: string;
      based_on?: string;
    } | null;
    confidence?: 'high' | 'medium' | 'low';
  };
  geo_aeo_visuals?: {
    ai_answer_presence_radar?: {
      answer_coverage_score?: number | null;
      entity_clarity_score?: number | null;
      topical_authority_score?: number | null;
      citation_readiness_score?: number | null;
      content_structure_score?: number | null;
      freshness_score?: number | null;
      confidence?: 'high' | 'medium' | 'low';
      data_source_strength?: 'strong' | 'inferred' | 'weak' | 'missing';
      source_tags?: string[] | null;
    };
    query_answer_coverage_map?: {
      queries?: Array<{
        query?: string;
        coverage?: 'full' | 'partial' | 'missing';
        answer_quality_score?: number;
      }>;
      confidence?: 'high' | 'medium' | 'low';
    };
    answer_extraction_funnel?: {
      total_queries?: number | null;
      answerable_content_pct?: number | null;
      structured_content_pct?: number | null;
      citation_ready_pct?: number | null;
      confidence?: 'high' | 'medium' | 'low';
      drop_off_reason_distribution?: {
        answer_gap_pct?: number | null;
        structure_gap_pct?: number | null;
        citation_gap_pct?: number | null;
      };
    };
    entity_authority_map?: {
      entities?: Array<{
        entity?: string;
        relevance_score?: number;
        coverage_score?: number;
      }>;
      confidence?: 'high' | 'medium' | 'low';
    };
  };
  geo_aeo_executive_summary?: {
    overall_ai_visibility_score?: number;
    primary_gap?: {
      title?: string;
      type?: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity?: 'critical' | 'moderate' | 'low';
      reasoning?: string;
      if_not_addressed?: string;
    };
    top_3_actions?: Array<{
      action_title?: string;
      priority?: 'high' | 'medium' | 'low';
      expected_impact?: 'high' | 'medium' | 'low';
      effort?: 'low' | 'medium' | 'high';
      linked_visual?: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning?: string;
    }>;
    visibility_opportunity?: {
      title?: string;
      estimated_ai_exposure?: string;
      based_on?: string;
    } | null;
    confidence?: 'high' | 'medium' | 'low';
  };
  unified_intelligence_summary?: {
    unified_score?: number;
    market_context_summary?: string;
    dominant_growth_channel?: 'seo' | 'geo_aeo' | 'balanced';
    primary_constraint?: {
      title?: string;
      source?: 'seo' | 'geo_aeo';
      severity?: 'critical' | 'moderate' | 'low';
      reasoning?: string;
      if_not_addressed?: string;
    };
    top_3_unified_actions?: Array<{
      action_title?: string;
      source?: 'seo' | 'geo_aeo';
      priority?: 'high' | 'medium' | 'low';
      expected_impact?: 'high' | 'medium' | 'low';
      effort?: 'low' | 'medium' | 'high';
      reasoning?: string;
    }>;
    growth_direction?: {
      short_term_focus?: string;
      long_term_focus?: string;
    };
    confidence?: 'high' | 'medium' | 'low';
  };
  competitor_visuals?: {
    competitor_positioning_radar?: {
      competitors?: Array<{
        name?: string;
        domain?: string;
        content_score?: number;
        keyword_coverage_score?: number;
        authority_score?: number;
        technical_score?: number;
        ai_answer_presence_score?: number;
      }>;
      user?: {
        content_score?: number;
        keyword_coverage_score?: number;
        authority_score?: number;
        technical_score?: number;
        ai_answer_presence_score?: number;
      };
      confidence?: 'high' | 'medium' | 'low';
    };
    keyword_gap_analysis?: {
      missing_keywords?: string[];
      weak_keywords?: string[];
      strong_keywords?: string[];
      confidence?: 'high' | 'medium' | 'low';
    };
    ai_answer_gap_analysis?: {
      missing_answers?: string[];
      weak_answers?: string[];
      strong_answers?: string[];
      confidence?: 'high' | 'medium' | 'low';
    };
  };
  competitor_intelligence_summary?: {
    top_competitor?: string;
    competitor_explanation?: string;
    primary_gap?: {
      title?: string;
      type?: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity?: 'critical' | 'moderate' | 'low';
      reasoning?: string;
      if_not_addressed?: string;
    };
    top_3_actions?: Array<{
      action_title?: string;
      priority?: 'high' | 'medium' | 'low';
      expected_impact?: 'high' | 'medium' | 'low';
      effort?: 'low' | 'medium' | 'high';
      reasoning?: string;
    }>;
    competitive_position?: 'leader' | 'competitive' | 'lagging';
    confidence?: 'high' | 'medium' | 'low';
  } | null;
  decision_snapshot?: {
    primary_focus_area?: string;
    whats_broken?: string;
    what_to_fix_first?: string;
    what_to_delay?: string;
    if_ignored?: string;
    execution_sequence?: string[];
    if_executed_well?: string;
    when_to_expect_impact?: {
      short_term?: string;
      mid_term?: string;
      long_term?: string;
    };
    impact_scale?: 'high_impact' | 'medium_impact' | 'foundational_impact';
    current_state?: string;
    expected_state?: string;
    outcome_confidence?: 'high' | 'medium' | 'low';
  };
  sections?: ComposedReportSection[];
};

function flattenComposedSections(report: ComposedReportData): {
  insights: NonNullable<ComposedReportSection['insights']>[number][];
  opportunities: NonNullable<ComposedReportSection['opportunities']>[number][];
  actions: NonNullable<ComposedReportSection['actions']>[number][];
} {
  const sections = Array.isArray(report.sections) ? report.sections : [];

  return {
    insights: sections.flatMap((section) => Array.isArray(section.insights) ? section.insights : []),
    opportunities: sections.flatMap((section) => Array.isArray(section.opportunities) ? section.opportunities : []),
    actions: sections.flatMap((section) => Array.isArray(section.actions) ? section.actions : []),
  };
}

function normalizeImpact(impactScore?: number): 'high' | 'medium' | 'low' {
  const value = Number(impactScore ?? 0);
  if (value >= 75) return 'high';
  if (value >= 40) return 'medium';
  return 'low';
}

function buildPriorityImpactLabel(impactScore?: number, confidenceScore?: number): string {
  const impact = Number(impactScore ?? 0);
  const confidence = Number(confidenceScore ?? 0);
  if (impact >= 80 || confidence >= 0.8) return 'High impact';
  if (impact >= 55 || confidence >= 0.6) return 'Medium impact';
  return 'Emerging impact';
}

function buildPriorityTimeToImpact(
  effortLevel?: 'low' | 'medium' | 'high',
  confidenceScore?: number,
): string {
  const confidence = Number(confidenceScore ?? 0);
  if (effortLevel === 'low' && confidence >= 0.65) return '1-2 weeks';
  if (effortLevel === 'medium' || confidence >= 0.45) return '2-4 weeks';
  return '4-8 weeks';
}

function buildFallbackTopPriorities(nextSteps: ReportViewNextStep[]): ReportViewTopPriority[] {
  return sortReportActions(nextSteps).slice(0, 3).map((step, index) => {
    const confidenceScore = Math.max(0.45, 0.8 - index * 0.12);
    const impactScore = Math.max(55, 82 - index * 10);
    const priorityType = classifyPriorityType({
      impactScore,
      effortLevel: step.effortLevel,
    });
    return {
      title: step.action,
      whyNow: step.description || 'This action has strong near-term leverage.',
      expectedOutcome: step.expectedOutcome,
      expectedUpside: step.expectedUpside,
      effortLevel: step.effortLevel,
      priorityType,
      priorityWhy: describePriorityType(priorityType),
      impactScore,
      confidenceScore,
      impactLabel: buildPriorityImpactLabel(impactScore, confidenceScore),
      timeToImpact: buildPriorityTimeToImpact(step.effortLevel, confidenceScore),
    };
  });
}

function sortReportActions<T extends { priorityType: PriorityType; impactScore: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => comparePriorityType(left, right));
}

function buildCompetitorStanding(delta?: {
  content_depth?: number;
  authority_score?: number;
  publishing_frequency?: number;
  engagement_score?: number;
  seo_coverage?: number;
  geo_presence?: number;
  aeo_readiness?: number;
}): 'Behind' | 'At Par' | 'Ahead' {
  if (!delta) return 'At Par';
  const values = [
    Number(delta.content_depth ?? 0),
    Number(delta.authority_score ?? 0),
    Number(delta.publishing_frequency ?? 0),
    Number(delta.engagement_score ?? 0),
    Number(delta.seo_coverage ?? 0),
    Number(delta.geo_presence ?? 0),
    Number(delta.aeo_readiness ?? 0),
  ];
  const averageDelta = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (averageDelta >= 8) return 'Behind';
  if (averageDelta <= -6) return 'Ahead';
  return 'At Par';
}

function buildComposedMetrics(
  reportType: 'snapshot' | 'performance' | 'growth',
  sections: ComposedReportSection[],
): ReportViewMetric[] {
  return sections.slice(0, 4).map((section, index) => {
    const insightCount = Array.isArray(section.insights) ? section.insights.length : 0;
    const opportunityCount = Array.isArray(section.opportunities) ? section.opportunities.length : 0;
    const actionCount = Array.isArray(section.actions) ? section.actions.length : 0;
    const totalSignals = insightCount + opportunityCount + actionCount;
    const score = Math.min(totalSignals * 12 + (opportunityCount > 0 ? 8 : 0), 100);

    const color =
      reportType === 'growth'
        ? 'from-emerald-400 to-teal-600'
        : reportType === 'performance'
          ? 'from-blue-500 to-indigo-700'
          : index % 2 === 0
            ? 'from-blue-400 to-blue-600'
            : 'from-green-400 to-green-600';

    return {
      label: section.section_name || `Section ${index + 1}`,
      score,
      color,
    };
  });
}

function buildSeoVisuals(report: ComposedReportData): ReportViewSeoVisuals | undefined {
  const visuals = report.visual_intelligence;
  if (!visuals) return undefined;

  const radar = visuals.seo_capability_radar;
  const matrix = visuals.opportunity_coverage_matrix;
  const funnel = visuals.search_visibility_funnel;
  const crawl = visuals.crawl_health_breakdown;
  const unifiedConstraint = report.unified_intelligence_summary?.primary_constraint?.title || 'the primary growth constraint';
  const seoPrimary = report.seo_executive_summary?.primary_problem?.title || 'core search constraints';

  const radarScores = [
    radar?.technical_seo_score,
    radar?.keyword_research_score,
    radar?.rank_tracking_score,
    radar?.backlinks_score,
    radar?.competitor_intelligence_score,
    radar?.content_quality_score,
  ].filter((value): value is number => typeof value === 'number');
  const missingRadarSignals = 6 - radarScores.length;
  const softenedRadarConfidence: 'high' | 'medium' | 'low' =
    missingRadarSignals >= 3
      ? 'low'
      : missingRadarSignals === 2 && (radar?.confidence || 'low') === 'high'
        ? 'medium'
        : (radar?.confidence || 'low');

  return {
    seoCapabilityRadar: {
      technical_seo_score: typeof radar?.technical_seo_score === 'number' ? radar.technical_seo_score : null,
      keyword_research_score: typeof radar?.keyword_research_score === 'number' ? radar.keyword_research_score : null,
      rank_tracking_score: typeof radar?.rank_tracking_score === 'number' ? radar.rank_tracking_score : null,
      backlinks_score: typeof radar?.backlinks_score === 'number' ? radar.backlinks_score : null,
      competitor_intelligence_score: typeof radar?.competitor_intelligence_score === 'number' ? radar.competitor_intelligence_score : null,
      content_quality_score: typeof radar?.content_quality_score === 'number' ? radar.content_quality_score : null,
      confidence: softenedRadarConfidence,
      data_source_strength: radar?.data_source_strength
        ? {
            technical_seo_score: radar.data_source_strength.technical_seo_score || 'missing',
            keyword_research_score: radar.data_source_strength.keyword_research_score || 'missing',
            rank_tracking_score: radar.data_source_strength.rank_tracking_score || 'missing',
            backlinks_score: radar.data_source_strength.backlinks_score || 'missing',
            competitor_intelligence_score: radar.data_source_strength.competitor_intelligence_score || 'missing',
            content_quality_score: radar.data_source_strength.content_quality_score || 'missing',
          }
        : undefined,
      source_tags: radar?.source_tags
        ? {
            technical_seo_score: radar.source_tags.technical_seo_score ?? null,
            keyword_research_score: radar.source_tags.keyword_research_score ?? null,
            rank_tracking_score: radar.source_tags.rank_tracking_score ?? null,
            backlinks_score: radar.source_tags.backlinks_score ?? null,
            competitor_intelligence_score: radar.source_tags.competitor_intelligence_score ?? null,
            content_quality_score: radar.source_tags.content_quality_score ?? null,
          }
        : undefined,
      tooltips: {
        technical_seo_score: 'Reflects crawl health, structural SEO, metadata coverage, and answer-engine readiness.',
        keyword_research_score: 'Shows how much keyword opportunity coverage is visible in the report data.',
        rank_tracking_score: 'Summarizes how strong current search visibility and click capture look in tracked keyword evidence.',
        backlinks_score: 'Proxy for backlink and authority strength using the authority dimension in the score model.',
        competitor_intelligence_score: 'Shows how strongly the company currently performs versus benchmarked competitors in the snapshot.',
        content_quality_score: 'Measures how well pages answer buyer questions with depth, structure, and relevance.',
      },
      insightSentence:
        typeof radar?.technical_seo_score === 'number'
          ? `Because ${unifiedConstraint} is unresolved, SEO is currently constrained by ${seoPrimary}. ${[
              ['content quality', radar.content_quality_score],
              ['backlinks', radar.backlinks_score],
              ['technical SEO', radar.technical_seo_score],
            ]
              .filter((item): item is [string, number] => typeof item[1] === 'number')
              .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'available signal areas'} currently leads, while weaker dimensions constrain performance. This is supported by technical ${radar?.technical_seo_score ?? 'n/a'}, visibility ${radar?.rank_tracking_score ?? 'n/a'}, authority ${radar?.backlinks_score ?? 'n/a'}.`
          : 'SEO capability radar is inferred from limited crawl/search signals in this run, so confidence is intentionally reduced.',
    },
    opportunityCoverageMatrix: {
      opportunities: Array.isArray(matrix?.opportunities)
        ? matrix!.opportunities!
            .filter((item) => item.keyword && typeof item.opportunity_score === 'number' && typeof item.coverage_score === 'number')
            .map((item) => ({
              keyword: item.keyword as string,
              opportunity_score: Number(item.opportunity_score ?? 0),
              coverage_score: Number(item.coverage_score ?? 0),
              opportunity_value_score: typeof item.opportunity_value_score === 'number' ? Number(item.opportunity_value_score) : null,
              priority_bucket: item.priority_bucket ?? null,
              confidence: item.confidence || 'low',
            }))
        : [],
      confidence: matrix?.confidence || 'low',
      opportunityReasoning:
        matrix?.opportunity_reasoning ||
        'These opportunity gaps usually come from stronger market demand than current page coverage and intent alignment.',
      insightSentence:
        Array.isArray(matrix?.opportunities) && matrix!.opportunities!.length > 0
          ? 'This confirms the same constraint: highest-value gaps are where opportunity stays high while coverage remains uneven.'
          : 'Opportunity matrix is inferred from limited keyword signal coverage in this run.',
    },
    searchVisibilityFunnel: {
      impressions: typeof funnel?.impressions === 'number' ? funnel.impressions : null,
      clicks: typeof funnel?.clicks === 'number' ? funnel.clicks : null,
      ctr: typeof funnel?.ctr === 'number' ? funnel.ctr : null,
      estimated_lost_clicks: typeof funnel?.estimated_lost_clicks === 'number' ? funnel.estimated_lost_clicks : null,
      confidence: funnel?.confidence || 'low',
      drop_off_reason_distribution: funnel?.drop_off_reason_distribution
        ? {
            ranking_issue_pct: typeof funnel.drop_off_reason_distribution.ranking_issue_pct === 'number' ? funnel.drop_off_reason_distribution.ranking_issue_pct : null,
            ctr_issue_pct: typeof funnel.drop_off_reason_distribution.ctr_issue_pct === 'number' ? funnel.drop_off_reason_distribution.ctr_issue_pct : null,
            intent_mismatch_pct: typeof funnel.drop_off_reason_distribution.intent_mismatch_pct === 'number' ? funnel.drop_off_reason_distribution.intent_mismatch_pct : null,
          }
        : undefined,
      tooltips: {
        impressions: 'The number of search appearances visible in tracked keyword evidence.',
        clicks: 'The number of clicks captured from those search appearances.',
        ctr: 'Click-through rate from visible impressions to visits.',
        estimated_lost_clicks: 'Estimated clicks left on the table because rankings or snippets are not strong enough yet.',
      },
      insightSentence:
        typeof funnel?.estimated_lost_clicks === 'number'
          ? `This mirrors the upstream constraint: search visibility creates demand, but roughly ${Math.round(funnel.estimated_lost_clicks).toLocaleString()} potential clicks are still being lost before visits happen.`
          : 'Search funnel evidence is limited because impressions/clicks signals were sparse in this run.',
    },
    crawlHealthBreakdown: {
      metadata_issues: typeof crawl?.metadata_issues === 'number' ? crawl.metadata_issues : null,
      structure_issues: typeof crawl?.structure_issues === 'number' ? crawl.structure_issues : null,
      internal_link_issues: typeof crawl?.internal_link_issues === 'number' ? crawl.internal_link_issues : null,
      crawl_depth_issues: typeof crawl?.crawl_depth_issues === 'number' ? crawl.crawl_depth_issues : null,
      confidence: crawl?.confidence || 'low',
      severity_split: crawl?.severity_split
        ? {
            critical: typeof crawl.severity_split.critical === 'number' ? crawl.severity_split.critical : null,
            moderate: typeof crawl.severity_split.moderate === 'number' ? crawl.severity_split.moderate : null,
            low: typeof crawl.severity_split.low === 'number' ? crawl.severity_split.low : null,
            classification: crawl.severity_split.classification || 'unclassified',
          }
        : undefined,
      tooltips: {
        metadata_issues: 'Missing, thin, or duplicated titles and descriptions found in the crawl.',
        structure_issues: 'Thin pages or weak heading structure affecting crawl understanding and ranking potential.',
        internal_link_issues: 'Pages with weak internal link support or orphan-like patterns.',
        crawl_depth_issues: 'Crawl errors or depth-related issues that reduce reliable page discovery.',
      },
      insightSentence:
        typeof crawl?.metadata_issues === 'number'
          ? `Technical evidence reinforces the same story: issue concentration remains highest in metadata ${crawl?.metadata_issues ?? 'n/a'} and structure ${crawl?.structure_issues ?? 'n/a'}.`
          : 'Crawl evidence is limited in this run, so technical confidence is intentionally reduced.',
    },
  };
}

function buildSeoExecutiveSummary(report: ComposedReportData): ReportViewSeoExecutiveSummary | undefined {
  const summary = report.seo_executive_summary;
  if (!summary) return undefined;

  return {
    overallHealthScore: Number(summary.overall_health_score ?? 0),
    primaryProblem: {
      title: summary.primary_problem?.title || 'Primary SEO issue still forming',
      impactedArea: summary.primary_problem?.impacted_area || 'visibility',
      severity: summary.primary_problem?.severity || 'low',
      reasoning: summary.primary_problem?.reasoning || 'The report does not yet have enough signal to sharpen this diagnosis further.',
      ifNotAddressed: summary.primary_problem?.if_not_addressed || 'If not addressed, traffic capture and conversion efficiency will remain constrained.',
    },
    top3Actions: Array.isArray(summary.top_3_actions)
      ? summary.top_3_actions.map((item) => ({
          actionTitle: item.action_title || 'Priority action',
          priority: item.priority || 'medium',
          expectedImpact: item.expected_impact || 'medium',
          effort: item.effort || 'medium',
          linkedVisual: item.linked_visual || 'radar',
          reasoning: item.reasoning || 'This action is one of the clearest next moves in the current snapshot.',
        })).slice(0, 3)
      : [],
    growthOpportunity: summary.growth_opportunity
      ? {
          title: summary.growth_opportunity.title || 'Growth opportunity identified',
          estimatedUpside: summary.growth_opportunity.estimated_upside || 'Upside is visible and should be quantified in the next data-rich run.',
          basedOn: summary.growth_opportunity.based_on || 'Based on current snapshot signals.',
        }
      : null,
    confidence: summary.confidence || 'low',
  };
}

function buildGeoAeoVisuals(report: ComposedReportData): ReportViewGeoAeoVisuals | undefined {
  const visuals = report.geo_aeo_visuals;
  if (!visuals) return undefined;

  return {
    aiAnswerPresenceRadar: {
      answer_coverage_score: typeof visuals.ai_answer_presence_radar?.answer_coverage_score === 'number' ? visuals.ai_answer_presence_radar.answer_coverage_score : null,
      entity_clarity_score: typeof visuals.ai_answer_presence_radar?.entity_clarity_score === 'number' ? visuals.ai_answer_presence_radar.entity_clarity_score : null,
      topical_authority_score: typeof visuals.ai_answer_presence_radar?.topical_authority_score === 'number' ? visuals.ai_answer_presence_radar.topical_authority_score : null,
      citation_readiness_score: typeof visuals.ai_answer_presence_radar?.citation_readiness_score === 'number' ? visuals.ai_answer_presence_radar.citation_readiness_score : null,
      content_structure_score: typeof visuals.ai_answer_presence_radar?.content_structure_score === 'number' ? visuals.ai_answer_presence_radar.content_structure_score : null,
      freshness_score: typeof visuals.ai_answer_presence_radar?.freshness_score === 'number' ? visuals.ai_answer_presence_radar.freshness_score : null,
      confidence: visuals.ai_answer_presence_radar?.confidence || 'low',
      data_source_strength: visuals.ai_answer_presence_radar?.data_source_strength || 'missing',
      source_tags: visuals.ai_answer_presence_radar?.source_tags ?? null,
    },
    queryAnswerCoverageMap: {
      queries: Array.isArray(visuals.query_answer_coverage_map?.queries)
        ? visuals.query_answer_coverage_map!.queries!.map((item) => ({
            query: item.query || 'Unnamed query',
            coverage: item.coverage || 'missing',
            answer_quality_score: Number(item.answer_quality_score ?? 0),
          }))
        : [],
      confidence: visuals.query_answer_coverage_map?.confidence || 'low',
    },
    answerExtractionFunnel: {
      total_queries: typeof visuals.answer_extraction_funnel?.total_queries === 'number' ? visuals.answer_extraction_funnel.total_queries : null,
      answerable_content_pct: typeof visuals.answer_extraction_funnel?.answerable_content_pct === 'number' ? visuals.answer_extraction_funnel.answerable_content_pct : null,
      structured_content_pct: typeof visuals.answer_extraction_funnel?.structured_content_pct === 'number' ? visuals.answer_extraction_funnel.structured_content_pct : null,
      citation_ready_pct: typeof visuals.answer_extraction_funnel?.citation_ready_pct === 'number' ? visuals.answer_extraction_funnel.citation_ready_pct : null,
      confidence: visuals.answer_extraction_funnel?.confidence || 'low',
      drop_off_reason_distribution: {
        answer_gap_pct: typeof visuals.answer_extraction_funnel?.drop_off_reason_distribution?.answer_gap_pct === 'number' ? visuals.answer_extraction_funnel.drop_off_reason_distribution.answer_gap_pct : null,
        structure_gap_pct: typeof visuals.answer_extraction_funnel?.drop_off_reason_distribution?.structure_gap_pct === 'number' ? visuals.answer_extraction_funnel.drop_off_reason_distribution.structure_gap_pct : null,
        citation_gap_pct: typeof visuals.answer_extraction_funnel?.drop_off_reason_distribution?.citation_gap_pct === 'number' ? visuals.answer_extraction_funnel.drop_off_reason_distribution.citation_gap_pct : null,
      },
    },
    entityAuthorityMap: {
      entities: Array.isArray(visuals.entity_authority_map?.entities)
        ? visuals.entity_authority_map!.entities!.map((item) => ({
            entity: item.entity || 'Unnamed entity',
            relevance_score: Number(item.relevance_score ?? 0),
            coverage_score: Number(item.coverage_score ?? 0),
          }))
        : [],
      confidence: visuals.entity_authority_map?.confidence || 'low',
    },
  };
}

function buildGeoAeoExecutiveSummary(report: ComposedReportData): ReportViewGeoAeoExecutiveSummary | undefined {
  const summary = report.geo_aeo_executive_summary;
  if (!summary) return undefined;
  return {
    overallAiVisibilityScore: Number(summary.overall_ai_visibility_score ?? 0),
    primaryGap: {
      title: summary.primary_gap?.title || 'Primary AI visibility gap still forming',
      type: summary.primary_gap?.type || 'answer_gap',
      severity: summary.primary_gap?.severity || 'low',
      reasoning: summary.primary_gap?.reasoning || 'Current crawl evidence is limited, so this gap is directional and confidence is reduced.',
      ifNotAddressed: summary.primary_gap?.if_not_addressed || 'If not addressed, AI answer visibility will remain constrained and citation performance will stay weak.',
    },
    top3Actions: Array.isArray(summary.top_3_actions)
      ? summary.top_3_actions.map((item) => ({
          actionTitle: item.action_title || 'Priority action',
          priority: item.priority || 'medium',
          expectedImpact: item.expected_impact || 'medium',
          effort: item.effort || 'medium',
          linkedVisual: item.linked_visual || 'radar',
          reasoning: item.reasoning || 'This action is one of the clearest next AI-visibility moves in the current snapshot.',
        })).slice(0, 3)
      : [],
    visibilityOpportunity: summary.visibility_opportunity
      ? {
          title: summary.visibility_opportunity.title || 'AI visibility opportunity identified',
          estimatedAiExposure: summary.visibility_opportunity.estimated_ai_exposure || 'Upside is visible and should be quantified in the next data-rich run.',
          basedOn: summary.visibility_opportunity.based_on || 'Based on current query and structure signals.',
        }
      : null,
    confidence: summary.confidence || 'low',
  };
}

function buildUnifiedIntelligenceSummary(report: ComposedReportData): ReportViewUnifiedIntelligenceSummary | undefined {
  const summary = report.unified_intelligence_summary;
  if (!summary) return undefined;

  return {
    unifiedScore: Number(summary.unified_score ?? 0),
    marketContextSummary:
      summary.market_context_summary ||
      'Current market context is inferred from combined SEO and GEO/AEO signals, with the strongest channel carrying near-term growth leverage.',
    dominantGrowthChannel: summary.dominant_growth_channel || 'balanced',
    primaryConstraint: {
      title: summary.primary_constraint?.title || 'Primary cross-channel constraint still forming',
      source: summary.primary_constraint?.source || 'seo',
      severity: summary.primary_constraint?.severity || 'low',
      reasoning: summary.primary_constraint?.reasoning || 'Current report evidence is limited, so this constraint is directional and confidence is reduced.',
      ifNotAddressed: summary.primary_constraint?.if_not_addressed || 'If not addressed, growth will remain constrained across both SEO and GEO/AEO channels.',
    },
    top3UnifiedActions: Array.isArray(summary.top_3_unified_actions)
      ? summary.top_3_unified_actions.slice(0, 3).map((action) => ({
          actionTitle: action.action_title || 'Priority action',
          source: action.source || 'seo',
          priority: action.priority || 'medium',
          expectedImpact: action.expected_impact || 'medium',
          effort: action.effort || 'medium',
          reasoning: action.reasoning || 'This action addresses a shared growth constraint across channels.',
        }))
      : [],
    growthDirection: {
      shortTermFocus: summary.growth_direction?.short_term_focus || 'Stabilize the highest-urgency visibility constraints first.',
      longTermFocus: summary.growth_direction?.long_term_focus || 'Build a balanced search and AI-answer visibility engine.',
    },
    confidence: summary.confidence || 'low',
  };
}

function buildCompetitorVisuals(report: ComposedReportData): ReportViewCompetitorVisuals | undefined {
  const visuals = report.competitor_visuals;
  if (!visuals) return undefined;

  return {
    competitorPositioningRadar: {
      competitors: Array.isArray(visuals.competitor_positioning_radar?.competitors)
        ? visuals.competitor_positioning_radar!.competitors!.map((item) => ({
            name: item.name || 'Competitor',
            domain: item.domain || item.name || 'unknown-competitor',
            content_score: Number(item.content_score ?? 0),
            keyword_coverage_score: Number(item.keyword_coverage_score ?? 0),
            authority_score: Number(item.authority_score ?? 0),
            technical_score: Number(item.technical_score ?? 0),
            ai_answer_presence_score: Number(item.ai_answer_presence_score ?? 0),
          }))
        : [],
      user: {
        content_score: Number(visuals.competitor_positioning_radar?.user?.content_score ?? 0),
        keyword_coverage_score: Number(visuals.competitor_positioning_radar?.user?.keyword_coverage_score ?? 0),
        authority_score: Number(visuals.competitor_positioning_radar?.user?.authority_score ?? 0),
        technical_score: Number(visuals.competitor_positioning_radar?.user?.technical_score ?? 0),
        ai_answer_presence_score: Number(visuals.competitor_positioning_radar?.user?.ai_answer_presence_score ?? 0),
      },
      confidence: visuals.competitor_positioning_radar?.confidence || 'low',
    },
    keywordGapAnalysis: {
      missing_keywords: Array.isArray(visuals.keyword_gap_analysis?.missing_keywords) ? visuals.keyword_gap_analysis!.missing_keywords! : [],
      weak_keywords: Array.isArray(visuals.keyword_gap_analysis?.weak_keywords) ? visuals.keyword_gap_analysis!.weak_keywords! : [],
      strong_keywords: Array.isArray(visuals.keyword_gap_analysis?.strong_keywords) ? visuals.keyword_gap_analysis!.strong_keywords! : [],
      confidence: visuals.keyword_gap_analysis?.confidence || 'low',
    },
    aiAnswerGapAnalysis: {
      missing_answers: Array.isArray(visuals.ai_answer_gap_analysis?.missing_answers) ? visuals.ai_answer_gap_analysis!.missing_answers! : [],
      weak_answers: Array.isArray(visuals.ai_answer_gap_analysis?.weak_answers) ? visuals.ai_answer_gap_analysis!.weak_answers! : [],
      strong_answers: Array.isArray(visuals.ai_answer_gap_analysis?.strong_answers) ? visuals.ai_answer_gap_analysis!.strong_answers! : [],
      confidence: visuals.ai_answer_gap_analysis?.confidence || 'low',
    },
  };
}

function buildCompetitorIntelligenceSummary(report: ComposedReportData): ReportViewCompetitorIntelligenceSummary | undefined {
  const summary = report.competitor_intelligence_summary;
  if (summary === null) return null;
  if (!summary) return undefined;

  const radarCount = report.competitor_visuals?.competitor_positioning_radar?.competitors?.length ?? 0;
  const fallbackUsed =
    report.competitor_intelligence?.discovery_metadata?.is_fallback_used === true ||
    report.competitor_intelligence?.discovery_metadata?.serp_status === 'fallback';
  let confidence: 'high' | 'medium' | 'low' = summary.confidence || 'low';
  if (radarCount === 0) confidence = 'low';
  else if (fallbackUsed && confidence === 'high') confidence = 'medium';
  else if (fallbackUsed && radarCount < 2) confidence = 'low';

  return {
    topCompetitor: summary.top_competitor || 'No reliable competitor identified yet',
    competitorExplanation:
      summary.competitor_explanation ||
      'Competitor direction is inferred from available market signals; stronger coverage, authority, and answer readiness are currently constraining your position.',
    primaryGap: {
      title: summary.primary_gap?.title || 'Primary competitor gap still forming',
      type: summary.primary_gap?.type || 'keyword_gap',
      severity: summary.primary_gap?.severity || 'low',
      reasoning: summary.primary_gap?.reasoning || 'Competitor gap reasoning is limited in this run, so comparative confidence is reduced.',
      ifNotAddressed: summary.primary_gap?.if_not_addressed || 'If not addressed, competitor pressure will continue reducing qualified traffic and conversion leverage.',
    },
    top3Actions: Array.isArray(summary.top_3_actions)
      ? summary.top_3_actions.slice(0, 3).map((action) => ({
          actionTitle: action.action_title || 'Priority action',
          priority: action.priority || 'medium',
          expectedImpact: action.expected_impact || 'medium',
          effort: action.effort || 'medium',
          reasoning: action.reasoning || 'This action addresses the strongest detected market gap.',
        }))
      : [],
    competitivePosition: summary.competitive_position || 'competitive',
    confidence,
  };
}

function mapComposedReport(
  report: ComposedReportData,
  reportType: 'snapshot' | 'performance' | 'growth',
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): ReportViewPayload | null {
  const sections = Array.isArray(report.sections) ? report.sections : [];
  if (sections.length === 0) return null;

  const flattened = flattenComposedSections(report);
  const insightCount = flattened.insights.length;
  const opportunityCount = flattened.opportunities.length;
  const actionCount = flattened.actions.length;

  const overallScore =
    typeof report.score?.value === 'number'
      ? Math.max(0, Math.min(100, report.score.value))
      : Math.min(
          100,
          35 + sections.length * 10 + Math.min(insightCount, 6) * 4 + Math.min(opportunityCount, 5) * 5,
        );

  const insights: ReportViewInsight[] = flattened.insights.slice(0, 6).map((insight) => ({
    text: insight.title || insight.recommendation || 'Key insight identified',
    icon: normalizeImpact(insight.impact_score) === 'high' ? 'alert' : 'trend',
    whyItMatters:
      insight.why_it_matters ||
      insight.description ||
      insight.recommendation ||
      'This signal should influence prioritization in the next execution cycle.',
    businessImpact:
      insight.business_impact ||
      buildBusinessImpact({
        issueType: insight.issue_type,
        actionType: insight.action_type,
        title: insight.title,
        impactTraffic: insight.impact_score,
        impactConversion: insight.impact_score,
        impactRevenue: insight.impact_score,
      }),
  }));

  const opportunities: ReportViewOpportunity[] = flattened.opportunities.slice(0, 6).map((opportunity) => ({
    title: opportunity.title || 'Opportunity identified',
    description:
      opportunity.recommendation ||
      'A prioritized improvement opportunity is available in this section.',
    impact: normalizeImpact((opportunity.confidence_score ?? 0) * 100),
    priority:
      Number(opportunity.confidence_score ?? 0) >= 0.75
        ? 'Act now'
        : Number(opportunity.confidence_score ?? 0) >= 0.4
          ? 'Plan next'
          : 'Monitor',
  }));

  const nextSteps: ReportViewNextStep[] = sortReportActions(flattened.actions.slice(0, 6).map((action) => ({
    ...(function () {
      const effortLevel = action.effort_level || 'medium';
      const impactScore = Number(action.impact_score ?? 0);
      const priorityType = action.priority_type || classifyPriorityType({
        impactScore,
        effortLevel,
      });
      return {
        action: action.title || action.action_type || 'Take action',
        description:
          action.recommendation ||
          'Use this recommendation to turn the report into an execution task.',
        steps: Array.isArray(action.steps) ? action.steps.slice(0, 4) : [],
        expectedOutcome:
          action.expected_outcome ||
          'This action should improve visibility, trust, or conversion readiness.',
        expectedUpside:
          action.expected_upside ||
          buildExpectedUpside({
            priorityType,
            impactScore,
            actionType: action.action_type,
            expectedOutcome: action.expected_outcome,
          }),
        impactScore,
        effortLevel,
        priorityType,
        priorityWhy: describePriorityType(priorityType),
      };
    })()
  })));

  const topPriorities: ReportViewTopPriority[] = Array.isArray(report.top_priorities)
    ? sortReportActions(report.top_priorities.slice(0, 3).map((item) => ({
        ...(function () {
          const effortLevel = item.effort_level || 'medium';
          const impactScore = Number(item.impact_score ?? 0);
          const priorityType = item.priority_type || classifyPriorityType({
            impactScore,
            effortLevel,
          });
          return {
            title: item.title || 'Priority action',
            whyNow: item.why_now || 'This deserves attention before lower-signal improvements.',
            expectedOutcome:
              item.expected_outcome ||
              'This should improve visibility, trust, or conversion readiness.',
            expectedUpside:
              item.expected_upside ||
              buildExpectedUpside({
                priorityType,
                impactScore,
                expectedOutcome: item.expected_outcome,
              }),
            effortLevel,
            priorityType,
            priorityWhy: describePriorityType(priorityType),
            impactScore,
            confidenceScore: Number(item.confidence_score ?? 0),
            impactLabel: buildPriorityImpactLabel(item.impact_score, item.confidence_score),
            timeToImpact: buildPriorityTimeToImpact(effortLevel, item.confidence_score),
          };
        })()
      }))).slice(0, 3)
    : [];
  const competitorContext = report.competitor_intelligence
    ? {
        summary:
          report.competitor_intelligence.summary ||
          'Competitor benchmarking is shaping this snapshot.',
        competitors: Array.isArray(report.competitor_intelligence.detected_competitors)
          ? report.competitor_intelligence.detected_competitors.slice(0, 3).map((item) => ({
              name: item.name || item.domain || 'Market peer',
              domain: item.domain ?? null,
              classification: item.classification || 'direct_competitor',
              source: item.source || 'inferred_keyword_peer',
              relevanceScore: Number(item.relevance_score ?? 0),
              rationale: item.rationale || 'Included as part of the competitor benchmark set.',
              standing: buildCompetitorStanding(
                (Array.isArray(report.competitor_intelligence.comparison?.competitors)
                  ? report.competitor_intelligence.comparison?.competitors.find(
                      (entry) =>
                        `${entry.competitor?.domain || entry.competitor?.name || ''}`.toLowerCase() ===
                        `${item.domain || item.name || ''}`.toLowerCase(),
                    )?.deltas_vs_company
                  : undefined),
              ),
            }))
          : [],
        strongestGaps: Array.isArray(report.competitor_intelligence.generated_gaps)
          ? report.competitor_intelligence.generated_gaps.slice(0, 3).map((gap) => ({
              gapType: gap.gap_type || 'competitor_gap',
              title: gap.title || 'Competitor gap detected',
              whyItMatters:
                gap.why_it_matters ||
                'This gap is affecting how the business compares to competitors.',
              confidenceScore: Number(gap.confidence_score ?? 0),
              impactScore: Number(gap.impact_score ?? 0),
              leadingCompetitors: Array.isArray(gap.leading_competitors) ? gap.leading_competitors : [],
            }))
          : [],
      }
    : undefined;

  const sectionNames = sections
    .map((section) => section.section_name)
    .filter((value): value is string => Boolean(value));
  const title =
    reportType === 'performance'
      ? 'Performance Intelligence Report'
      : reportType === 'growth'
        ? 'Market & Growth Intelligence Report'
        : 'Digital Authority Snapshot';
  const companyContext = reportType === 'snapshot'
    ? {
        companyName: report.company_context?.company_name || null,
        domain: report.company_context?.domain || domain || null,
        homepageHeadline: report.company_context?.homepage_headline || null,
        tagline: report.company_context?.tagline || null,
        primaryOffering: report.company_context?.primary_offering || null,
        positioning: report.company_context?.positioning || null,
        marketContext: report.company_context?.market_context || null,
        positioningStrength: report.company_context?.positioning_strength || undefined,
        positioningNarrative: report.company_context?.positioning_narrative || undefined,
        positioningGap: report.company_context?.positioning_gap || null,
        marketType: report.company_context?.market_type || undefined,
        marketNarrative: report.company_context?.market_narrative || undefined,
        strategyAlignment: report.company_context?.strategy_alignment || undefined,
        marketPosition: report.company_context?.market_position || undefined,
        marketPositionStatement: report.company_context?.market_position_statement || undefined,
        positionImplication: report.company_context?.position_implication || undefined,
        executionRisk: report.company_context?.execution_risk || undefined,
        resilienceGuidance: report.company_context?.resilience_guidance || undefined,
      }
    : undefined;

  const diagnosis =
    report.diagnosis ||
    (reportType === 'performance'
      ? `Performance review surfaced ${opportunityCount} priority opportunities across ${sectionNames.length} sections.`
      : reportType === 'growth'
        ? `Growth analysis identified ${opportunityCount} expansion opportunities across ${sectionNames.length} strategic areas.`
        : `Snapshot analysis surfaced ${insightCount} signals across ${sectionNames.length} core readiness areas.`);

  const summary =
    report.summary ||
    (sectionNames.length > 0
      ? `This ${reportType} report covers ${sectionNames.join(', ')} with ${insightCount} insights, ${opportunityCount} opportunities, and ${actionCount} recommended actions.`
      : `This ${reportType} report contains ${insightCount} insights, ${opportunityCount} opportunities, and ${actionCount} actions.`);
  const decisionSnapshot =
    reportType === 'snapshot'
      ? {
          primaryFocusArea:
            report.decision_snapshot?.primary_focus_area ||
            report.unified_intelligence_summary?.primary_constraint?.title ||
            'Primary growth constraint',
          whatsBroken: report.decision_snapshot?.whats_broken || diagnosis,
          whatToFixFirst:
            report.decision_snapshot?.what_to_fix_first ||
            topPriorities[0]?.title ||
            'Execute the highest-impact action first',
          whatToDelay:
            report.decision_snapshot?.what_to_delay ||
            'Delay lower-impact expansion until the primary constraint is reduced.',
          ifIgnored:
            report.decision_snapshot?.if_ignored ||
            'If ignored, visibility and conversion constraints will continue to compound.',
          executionSequence:
            Array.isArray(report.decision_snapshot?.execution_sequence) && report.decision_snapshot!.execution_sequence!.length > 0
              ? report.decision_snapshot!.execution_sequence!.slice(0, 3)
              : topPriorities.slice(0, 3).map((item, index) => `Step ${index + 1}: ${item.title}`),
          ifExecutedWell:
            report.decision_snapshot?.if_executed_well ||
            'If executed well, visibility quality, authority signals, and conversion readiness should improve in sequence.',
          whenToExpectImpact: {
            shortTerm:
              report.decision_snapshot?.when_to_expect_impact?.short_term ||
              '2-4 weeks: early movement in key visibility constraints.',
            midTerm:
              report.decision_snapshot?.when_to_expect_impact?.mid_term ||
              '1-3 months: stronger authority and content-depth lift query capture.',
            longTerm:
              report.decision_snapshot?.when_to_expect_impact?.long_term ||
              '3-6 months: stronger market position and channel resilience.',
          },
          impactScale: report.decision_snapshot?.impact_scale || 'medium_impact',
          currentState:
            report.decision_snapshot?.current_state ||
            'Constrained visibility and authority performance in core queries',
          expectedState:
            report.decision_snapshot?.expected_state ||
            'Competitive visibility and stronger authority presence in core queries',
          outcomeConfidence: report.decision_snapshot?.outcome_confidence || 'medium',
        }
      : undefined;

  return {
    reportId,
    companyId,
    domain,
    reportType,
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title,
    companyContext,
    diagnosis,
    summary,
    overallScore,
    scoreExplanation: report.score
      ? {
          dimensions: Array.isArray(report.score.dimensions)
            ? report.score.dimensions.map((item) => ({
                key: item.key || 'dimension',
                label: item.label || 'Dimension',
                value: Number(item.value ?? 0),
                explanation: item.explanation || 'This dimension influences the overall score.',
              }))
            : [],
          weakestDimensions: Array.isArray(report.score.weakest_dimensions)
            ? report.score.weakest_dimensions.map((item) => ({
                key: item.key || 'dimension',
                label: item.label || 'Dimension',
                value: Number(item.value ?? 0),
              }))
            : [],
          limitingFactors: Array.isArray(report.score.limiting_factors) ? report.score.limiting_factors : [],
          growthPath: {
            currentLevel: report.score.growth_path?.current_level || report.score.label || 'Current level',
            nextLevel: report.score.growth_path?.next_level ?? null,
            focus: Array.isArray(report.score.growth_path?.focus) ? report.score.growth_path?.focus : [],
            projectedScoreImprovements: Array.isArray(report.score.growth_path?.projected_score_improvements)
              ? report.score.growth_path?.projected_score_improvements.map((item) => ({
                  dimension: item.dimension || 'dimension',
                  currentValue: Number(item.current_value ?? 0),
                  projectedValue: Number(item.projected_value ?? 0),
                  projectedTotalScore: Number(item.projected_total_score ?? 0),
                }))
              : [],
          },
        }
      : undefined,
    confidenceSource: `Composed from ${sectionNames.length} report sections`,
    insights,
    metrics: buildComposedMetrics(reportType, sections),
    opportunities,
    competitorContext,
    seoExecutiveSummary: reportType === 'snapshot' ? buildSeoExecutiveSummary(report) : undefined,
    seoVisuals: reportType === 'snapshot' ? buildSeoVisuals(report) : undefined,
    geoAeoVisuals: reportType === 'snapshot' ? buildGeoAeoVisuals(report) : undefined,
    geoAeoExecutiveSummary: reportType === 'snapshot' ? buildGeoAeoExecutiveSummary(report) : undefined,
    unifiedIntelligenceSummary: reportType === 'snapshot' ? buildUnifiedIntelligenceSummary(report) : undefined,
    competitorVisuals: reportType === 'snapshot' ? buildCompetitorVisuals(report) : undefined,
    competitorIntelligenceSummary: reportType === 'snapshot' ? buildCompetitorIntelligenceSummary(report) : undefined,
    decisionSnapshot,
    topPriorities,
    nextSteps,
  };
}

function safeDelta(currentValue: number | null | undefined, previousValue: number | null | undefined): number | null {
  if (currentValue == null || previousValue == null) return null;
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return Number((current - previous).toFixed(4));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function averageNullable(values: Array<number | null>): number | null {
  const usable = values.filter((value): value is number => isFiniteNumber(value));
  if (usable.length === 0) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function formatDeltaRow(label: string, value: number | null): string {
  if (value == null) return `${label} (insufficient data)`;
  return `${label} (${value >= 0 ? '+' : ''}${Number(value.toFixed(2))})`;
}

function competitivePositionWeight(value: 'leader' | 'competitive' | 'lagging' | undefined): number {
  if (value === 'leader') return 3;
  if (value === 'competitive') return 2;
  return 1;
}

function gapSeverityWeight(
  value: 'critical' | 'moderate' | 'low' | undefined,
): number {
  if (value === 'critical') return 3;
  if (value === 'moderate') return 2;
  return 1;
}

function buildProgressComparison(params: {
  current: ReportViewPayload;
  previous: ReportViewPayload;
}): ReportViewProgressComparison {
  const unifiedScoreChange = safeDelta(
    params.current.unifiedIntelligenceSummary?.unifiedScore ?? params.current.overallScore,
    params.previous.unifiedIntelligenceSummary?.unifiedScore ?? params.previous.overallScore,
  );

  const seoChanges = {
    health_score_delta: safeDelta(
      params.current.seoExecutiveSummary?.overallHealthScore,
      params.previous.seoExecutiveSummary?.overallHealthScore,
    ),
    impressions_delta: safeDelta(
      params.current.seoVisuals?.searchVisibilityFunnel.impressions,
      params.previous.seoVisuals?.searchVisibilityFunnel.impressions,
    ),
    clicks_delta: safeDelta(
      params.current.seoVisuals?.searchVisibilityFunnel.clicks,
      params.previous.seoVisuals?.searchVisibilityFunnel.clicks,
    ),
    ctr_delta: safeDelta(
      params.current.seoVisuals?.searchVisibilityFunnel.ctr,
      params.previous.seoVisuals?.searchVisibilityFunnel.ctr,
    ),
  };

  const geoAeoChanges = {
    ai_visibility_delta: safeDelta(
      params.current.geoAeoExecutiveSummary?.overallAiVisibilityScore,
      params.previous.geoAeoExecutiveSummary?.overallAiVisibilityScore,
    ),
    answer_coverage_delta: safeDelta(
      params.current.geoAeoVisuals?.aiAnswerPresenceRadar.answer_coverage_score,
      params.previous.geoAeoVisuals?.aiAnswerPresenceRadar.answer_coverage_score,
    ),
    citation_readiness_delta: safeDelta(
      params.current.geoAeoVisuals?.aiAnswerPresenceRadar.citation_readiness_score,
      params.previous.geoAeoVisuals?.aiAnswerPresenceRadar.citation_readiness_score,
    ),
  };

  const positionChange = safeDelta(
    competitivePositionWeight(params.current.competitorIntelligenceSummary?.competitivePosition),
    competitivePositionWeight(params.previous.competitorIntelligenceSummary?.competitivePosition),
  );
  const gapReductionScore = safeDelta(
    gapSeverityWeight(params.previous.competitorIntelligenceSummary?.primaryGap?.severity),
    gapSeverityWeight(params.current.competitorIntelligenceSummary?.primaryGap?.severity),
  );

  const deltaRows = [
    { label: 'Unified score', value: unifiedScoreChange },
    { label: 'SEO health score', value: seoChanges.health_score_delta },
    { label: 'Impressions', value: seoChanges.impressions_delta },
    { label: 'Clicks', value: seoChanges.clicks_delta },
    { label: 'CTR', value: seoChanges.ctr_delta },
    { label: 'AI visibility', value: geoAeoChanges.ai_visibility_delta },
    { label: 'Answer coverage', value: geoAeoChanges.answer_coverage_delta },
    { label: 'Citation readiness', value: geoAeoChanges.citation_readiness_delta },
    { label: 'Competitive position', value: positionChange },
    { label: 'Gap reduction score', value: gapReductionScore },
  ];

  const comparableRows = deltaRows.filter((row) => row.value != null) as Array<{ label: string; value: number }>;
  const biggestGain = comparableRows.length > 0
    ? [...comparableRows].sort((left, right) => right.value - left.value)[0]
    : null;
  const biggestDrop = comparableRows.length > 0
    ? [...comparableRows].sort((left, right) => left.value - right.value)[0]
    : null;

  const overallTrend: 'improving' | 'declining' | 'stable' =
    unifiedScoreChange != null && unifiedScoreChange >= 2
      ? 'improving'
      : unifiedScoreChange != null && unifiedScoreChange <= -2
        ? 'declining'
        : 'stable';
  const dataStatus: 'complete' | 'partial' | 'insufficient' =
    comparableRows.length === deltaRows.length
      ? 'complete'
      : comparableRows.length > 0
        ? 'partial'
        : 'insufficient';

  return {
    previous_report_id: params.previous.reportId,
    current_report_id: params.current.reportId,
    unified_score_change: unifiedScoreChange,
    seo_changes: seoChanges,
    geo_aeo_changes: geoAeoChanges,
    competitor_changes: {
      position_change: positionChange,
      gap_reduction_score: gapReductionScore,
    },
    data_status: dataStatus,
    summary: {
      overall_trend: overallTrend,
      biggest_gain: biggestGain ? formatDeltaRow(biggestGain.label, biggestGain.value) : 'Insufficient data',
      biggest_drop: biggestDrop ? formatDeltaRow(biggestDrop.label, biggestDrop.value) : 'Insufficient data',
    },
  };
}

function normalizeCompetitorDomain(value: string | undefined | null): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function averageRadarScore(item: {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
}): number {
  const values = [
    Number(item.content_score ?? 0),
    Number(item.keyword_coverage_score ?? 0),
    Number(item.authority_score ?? 0),
    Number(item.technical_score ?? 0),
    Number(item.ai_answer_presence_score ?? 0),
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movementFromDeltas(values: Array<number | null>): 'improving' | 'declining' | 'stable' {
  const averageDelta = averageNullable(values);
  if (averageDelta == null) return 'stable';
  if (averageDelta > 2) return 'improving';
  if (averageDelta < -2) return 'declining';
  return 'stable';
}

function buildCompetitorMovementComparison(params: {
  current: ReportViewPayload;
  previous: ReportViewPayload;
}): ReportViewCompetitorMovementComparison {
  const currentRadar = params.current.competitorVisuals?.competitorPositioningRadar;
  const previousRadar = params.previous.competitorVisuals?.competitorPositioningRadar;

  const fallback: ReportViewCompetitorMovementComparison = {
    previous_report_id: params.previous.reportId,
    current_report_id: params.current.reportId,
    competitors: [],
    user_vs_competitor_shift: {
      closest_competitor: 'Not available',
      gap_change: null,
      direction: 'unchanged',
    },
    data_status: 'insufficient',
    summary: {
      overall_trend: 'stable',
      key_movement: 'No matchable competitors between reports; movement comparison is limited.',
    },
  };

  if (!currentRadar || !previousRadar) {
    return fallback;
  }

  const previousByDomain = new Map(
    previousRadar.competitors.map((competitor) => [
      normalizeCompetitorDomain(competitor.domain || competitor.name),
      competitor,
    ]),
  );

  const matchedCompetitors = currentRadar.competitors
    .map((competitor) => {
      const domain = normalizeCompetitorDomain(competitor.domain || competitor.name);
      if (!domain) return null;
      const previousCompetitor = previousByDomain.get(domain);
      if (!previousCompetitor) return null;

      const delta = {
        content_delta: safeDelta(competitor.content_score, previousCompetitor.content_score),
        keyword_delta: safeDelta(competitor.keyword_coverage_score, previousCompetitor.keyword_coverage_score),
        authority_delta: safeDelta(competitor.authority_score, previousCompetitor.authority_score),
        technical_delta: safeDelta(competitor.technical_score, previousCompetitor.technical_score),
        ai_answer_delta: safeDelta(competitor.ai_answer_presence_score, previousCompetitor.ai_answer_presence_score),
      };
      const movement = movementFromDeltas([
        delta.content_delta,
        delta.keyword_delta,
        delta.authority_delta,
        delta.technical_delta,
        delta.ai_answer_delta,
      ]);

      const currentGap = averageRadarScore(competitor) - averageRadarScore(currentRadar.user);
      const previousGap = averageRadarScore(previousCompetitor) - averageRadarScore(previousRadar.user);
      const gapChange = safeDelta(currentGap, previousGap);

      return {
        domain,
        previous_scores: {
          content_score: Number(previousCompetitor.content_score ?? 0),
          keyword_coverage_score: Number(previousCompetitor.keyword_coverage_score ?? 0),
          authority_score: Number(previousCompetitor.authority_score ?? 0),
          technical_score: Number(previousCompetitor.technical_score ?? 0),
          ai_answer_presence_score: Number(previousCompetitor.ai_answer_presence_score ?? 0),
        },
        current_scores: {
          content_score: Number(competitor.content_score ?? 0),
          keyword_coverage_score: Number(competitor.keyword_coverage_score ?? 0),
          authority_score: Number(competitor.authority_score ?? 0),
          technical_score: Number(competitor.technical_score ?? 0),
          ai_answer_presence_score: Number(competitor.ai_answer_presence_score ?? 0),
        },
        delta,
        movement,
        _currentGap: currentGap,
        _previousGap: previousGap,
        _gapChange: gapChange,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  if (matchedCompetitors.length === 0) {
    return fallback;
  }

  const sortedByRelevance = [...matchedCompetitors].sort((left, right) => Math.abs(left._currentGap) - Math.abs(right._currentGap));
  const closest = sortedByRelevance[0];
  const direction: 'closing_gap' | 'widening_gap' | 'unchanged' =
    closest._gapChange == null
      ? 'unchanged'
      : closest._gapChange <= -2
        ? 'closing_gap'
        : closest._gapChange >= 2
          ? 'widening_gap'
          : 'unchanged';

  const improvingCount = matchedCompetitors.filter((item) => item.movement === 'improving').length;
  const decliningCount = matchedCompetitors.filter((item) => item.movement === 'declining').length;
  const overallTrend: 'improving' | 'declining' | 'stable' =
    improvingCount > decliningCount ? 'improving' : decliningCount > improvingCount ? 'declining' : 'stable';

  const keyMovement =
    closest._gapChange == null
      ? `Insufficient matched history to classify movement vs ${closest.domain}.`
      : direction === 'closing_gap'
      ? `You are catching up to ${closest.domain} (${Number(Math.abs(closest._gapChange).toFixed(1))} point gap improvement).`
      : direction === 'widening_gap'
        ? `${closest.domain} is pulling ahead (${Number(Math.abs(closest._gapChange).toFixed(1))} point wider gap).`
        : `Gap to ${closest.domain} is stable (${Number(closest._gapChange.toFixed(1)) >= 0 ? '+' : ''}${Number(closest._gapChange.toFixed(1))}).`;
  const hasAnyNullDelta = matchedCompetitors.some((item) =>
    Object.values(item.delta).some((value) => value == null),
  );
  const dataStatus: 'complete' | 'partial' | 'insufficient' =
    matchedCompetitors.length === 0
      ? 'insufficient'
      : hasAnyNullDelta || closest._gapChange == null
        ? 'partial'
        : 'complete';

  return {
    previous_report_id: params.previous.reportId,
    current_report_id: params.current.reportId,
    competitors: matchedCompetitors.map((item) => ({
      domain: item.domain,
      previous_scores: item.previous_scores,
      current_scores: item.current_scores,
      delta: item.delta,
      movement: item.movement,
    })),
    user_vs_competitor_shift: {
      closest_competitor: closest.domain,
      gap_change: closest._gapChange == null ? null : Number(closest._gapChange.toFixed(2)),
      direction,
    },
    data_status: dataStatus,
    summary: {
      overall_trend: overallTrend,
      key_movement: keyMovement,
    },
  };
}

function averageCompetitorScore(item: {
  content_score: number;
  keyword_coverage_score: number;
  authority_score: number;
  technical_score: number;
  ai_answer_presence_score: number;
}): number {
  const values = [
    Number(item.content_score ?? 0),
    Number(item.keyword_coverage_score ?? 0),
    Number(item.authority_score ?? 0),
    Number(item.technical_score ?? 0),
    Number(item.ai_answer_presence_score ?? 0),
  ];
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function findClosestCompetitor(payload: ReportViewPayload): { domain: string; score: number } | null {
  const radar = payload.competitorVisuals?.competitorPositioningRadar;
  if (!radar || radar.competitors.length === 0) return null;

  const fromMovement = payload.competitorMovementComparison?.user_vs_competitor_shift?.closest_competitor;
  if (fromMovement) {
    const movementKey = normalizeCompetitorDomain(fromMovement);
    const movementMatch = radar.competitors.find(
      (competitor) => normalizeCompetitorDomain(competitor.domain || competitor.name) === movementKey,
    );
    if (movementMatch) {
      return {
        domain: movementKey || movementMatch.domain || movementMatch.name,
        score: averageCompetitorScore(movementMatch),
      };
    }
  }

  const userScore = averageCompetitorScore(radar.user);
  const closest = [...radar.competitors]
    .map((competitor) => ({
      domain: normalizeCompetitorDomain(competitor.domain || competitor.name) || competitor.name,
      score: averageCompetitorScore(competitor),
      gapAbs: Math.abs(averageCompetitorScore(competitor) - userScore),
    }))
    .sort((left, right) => left.gapAbs - right.gapAbs)[0];

  return closest ? { domain: closest.domain, score: closest.score } : null;
}

function buildTimelineComparison(params: {
  snapshots: ReportViewPayload[];
}): ReportViewTimelineComparison {
  const ordered = [...params.snapshots].sort(
    (left, right) => new Date(left.generated_at).getTime() - new Date(right.generated_at).getTime(),
  );

  if (ordered.length === 0) {
    return {
      snapshots: [],
      meta: { trend: 'stable', total_change: null, data_points: 0, data_status: 'insufficient' },
    };
  }

  const closestCandidates = ordered.map((snapshot) => ({
    reportId: snapshot.reportId,
    competitor: findClosestCompetitor(snapshot),
  }));

  const frequency = new Map<string, number>();
  for (const row of closestCandidates) {
    if (!row.competitor?.domain) continue;
    frequency.set(row.competitor.domain, (frequency.get(row.competitor.domain) ?? 0) + 1);
  }
  const preferredDomain = [...frequency.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const timelineRows = ordered.map((snapshot, index) => {
    const unifiedScore = isFiniteNumber(snapshot.unifiedIntelligenceSummary?.unifiedScore)
      ? Number(snapshot.unifiedIntelligenceSummary?.unifiedScore)
      : isFiniteNumber(snapshot.overallScore)
        ? Number(snapshot.overallScore)
        : null;
    const radar = snapshot.competitorVisuals?.competitorPositioningRadar;
    let competitor: { domain: string; score: number } | null = null;

    if (radar && radar.competitors.length > 0) {
      if (preferredDomain) {
        const matched = radar.competitors.find(
          (item) => normalizeCompetitorDomain(item.domain || item.name) === preferredDomain,
        );
        if (matched) {
          competitor = {
            domain: preferredDomain,
            score: averageCompetitorScore(matched),
          };
        }
      }
      if (!competitor) {
        competitor = findClosestCompetitor(snapshot);
      }
    }

    const previousScore = index > 0
      ? (isFiniteNumber(ordered[index - 1].unifiedIntelligenceSummary?.unifiedScore)
          ? Number(ordered[index - 1].unifiedIntelligenceSummary?.unifiedScore)
          : isFiniteNumber(ordered[index - 1].overallScore)
            ? Number(ordered[index - 1].overallScore)
            : null)
      : null;

    return {
      report_id: snapshot.reportId,
      created_at: snapshot.generated_at,
      unified_score: unifiedScore,
      competitor,
      delta_from_previous:
        unifiedScore == null || previousScore == null
          ? null
          : Number((unifiedScore - previousScore).toFixed(2)),
    };
  });

  const first = timelineRows[0]?.unified_score ?? null;
  const last = timelineRows[timelineRows.length - 1]?.unified_score ?? null;
  const totalChange = first == null || last == null ? null : Number((last - first).toFixed(2));
  const trend: 'improving' | 'declining' | 'stable' =
    totalChange == null ? 'stable' : totalChange > 5 ? 'improving' : totalChange < -5 ? 'declining' : 'stable';
  const usablePoints = timelineRows.filter((item) => item.unified_score != null).length;
  const dataStatus: 'complete' | 'partial' | 'insufficient' =
    usablePoints >= 2
      ? (timelineRows.every((item) => item.unified_score != null) ? 'complete' : 'partial')
      : 'insufficient';

  return {
    snapshots: timelineRows,
    meta: {
      trend,
      total_change: totalChange,
      data_points: timelineRows.length,
      data_status: dataStatus,
    },
  };
}

function inferMarketPosition(payload: ReportViewPayload): 'below market' | 'at parity' | 'ahead' {
  const explicit = payload.companyContext?.marketPosition;
  if (explicit === 'below market' || explicit === 'at parity' || explicit === 'ahead') return explicit;
  const competitivePosition = payload.competitorIntelligenceSummary?.competitivePosition;
  if (competitivePosition === 'lagging') return 'below market';
  if (competitivePosition === 'leader') return 'ahead';
  return 'at parity';
}

function inferGrowthState(payload: ReportViewPayload): 'improving' | 'stable' | 'declining' {
  const progressTrend = payload.progressComparison?.summary?.overall_trend;
  if (progressTrend === 'improving' || progressTrend === 'declining' || progressTrend === 'stable') {
    return progressTrend;
  }
  const timelineTrend = payload.timelineComparison?.meta?.trend;
  if (timelineTrend === 'improving' || timelineTrend === 'declining' || timelineTrend === 'stable') {
    return timelineTrend;
  }
  return 'stable';
}

function inferRiskState(payload: ReportViewPayload): 'high' | 'medium' | 'low' {
  const fromConfidence = payload.decisionSnapshot?.outcomeConfidence;
  if (fromConfidence === 'low') return 'high';
  if (fromConfidence === 'high') return 'low';

  const riskText = `${payload.companyContext?.executionRisk ?? ''} ${payload.decisionSnapshot?.whatToFixFirst ?? ''}`.toLowerCase();
  if (/(may remain limited|fragmented|dilute|constrained|high risk)/.test(riskText)) return 'high';
  if (/(inconsistent|sequencing|moderate)/.test(riskText)) return 'medium';
  return 'low';
}

function inferPositioningState(payload: ReportViewPayload): 'weak' | 'moderate' | 'strong' {
  const state = payload.companyContext?.positioningStrength;
  if (state === 'weak' || state === 'moderate' || state === 'strong') return state;
  return 'moderate';
}

function buildStrategicScore(payload: ReportViewPayload): ReportViewStrategicScore | undefined {
  if (payload.reportType !== 'snapshot') return undefined;

  const positionState = inferMarketPosition(payload);
  const growthState = inferGrowthState(payload);
  const riskState = inferRiskState(payload);
  const positioningState = inferPositioningState(payload);

  const positionScore = positionState === 'ahead' ? 85 : positionState === 'at parity' ? 60 : 30;
  const growthScore = growthState === 'improving' ? 75 : growthState === 'stable' ? 55 : 35;
  const riskScore = riskState === 'low' ? 85 : riskState === 'medium' ? 60 : 35;
  const positioningScore = positioningState === 'strong' ? 80 : positioningState === 'moderate' ? 60 : 35;

  const weights = {
    position: 0.35,
    growth: 0.25,
    risk: 0.25,
    positioning: 0.15,
  };
  const value = Math.round(
    (positionScore * weights.position) +
    (growthScore * weights.growth) +
    (riskScore * weights.risk) +
    (positioningScore * weights.positioning),
  );
  const normalizedValue = Math.max(0, Math.min(100, value));
  const label: ReportViewStrategicScore['label'] =
    normalizedValue >= 80
      ? 'strong strategic position'
      : normalizedValue >= 50
        ? 'developing position'
        : 'constrained position';
  const interpretation =
    label === 'strong strategic position'
      ? (positionState === 'ahead' || positionState === 'at parity'
        ? 'This means you are competitively positioned in your market.'
        : 'This means core strategic signals are strong, but competitor-relative position still needs reinforcement.')
      : label === 'developing position'
        ? (positionState === 'below market'
          ? 'This means you are improving but not yet competitive in core demand areas.'
          : 'This means you are improving, but execution consistency is still required to establish durable competitiveness.')
        : 'This means you are currently below competitive thresholds in your market.';

  const fallbackHeavyCompetitorSignals =
    (payload.competitorContext?.competitors ?? []).filter((item) =>
      item.source === 'inferred_keyword_peer' || item.source === 'serp_unavailable_fallback',
    ).length;
  const totalCompetitorSignals = (payload.competitorContext?.competitors ?? []).length;
  const fallbackRatio =
    totalCompetitorSignals > 0 ? fallbackHeavyCompetitorSignals / totalCompetitorSignals : 1;
  const dataStatusSignals = [
    payload.progressComparison?.data_status,
    payload.competitorMovementComparison?.data_status,
    payload.timelineComparison?.meta?.data_status,
  ];
  const completeCount = dataStatusSignals.filter((item) => item === 'complete').length;
  const partialCount = dataStatusSignals.filter((item) => item === 'partial').length;
  const positioningKnown = Boolean(payload.companyContext?.positioningStrength);
  const confidence: 'high' | 'medium' | 'low' =
    fallbackRatio <= 0.25 && completeCount >= 2 && positioningKnown
      ? 'high'
      : fallbackRatio <= 0.6 && (completeCount + partialCount) >= 1
        ? 'medium'
        : 'low';

  return {
    value: normalizedValue,
    label,
    strategic_score_change: null,
    movement: 'stable',
    primary_driver: 'Insufficient history to identify primary driver.',
    interpretation,
    confidence,
    strategic_score_breakdown: {
      position: { state: positionState, score: positionScore, weight: weights.position },
      growth: { state: growthState, score: growthScore, weight: weights.growth },
      risk: { state: riskState, score: riskScore, weight: weights.risk },
      positioning: { state: positioningState, score: positioningScore, weight: weights.positioning },
    },
  };
}

function buildStrategicScoreWithDelta(params: {
  current: ReportViewPayload;
  previous: ReportViewPayload | null;
}): ReportViewStrategicScore | undefined {
  const currentScore = buildStrategicScore(params.current);
  if (!currentScore) return undefined;
  if (!params.previous) return currentScore;

  const previousScore = buildStrategicScore(params.previous);
  if (!previousScore) return currentScore;

  const delta = Number((currentScore.value - previousScore.value).toFixed(1));
  const movement: 'improving' | 'declining' | 'stable' =
    delta > 5 ? 'improving' : delta < -5 ? 'declining' : 'stable';

  const components: Array<{
    key: 'position' | 'growth' | 'risk' | 'positioning';
    label: string;
    contributionDelta: number;
    rawDelta: number;
  }> = [
    {
      key: 'position',
      label: 'position',
      contributionDelta:
        (currentScore.strategic_score_breakdown.position.score - previousScore.strategic_score_breakdown.position.score) *
        currentScore.strategic_score_breakdown.position.weight,
      rawDelta: currentScore.strategic_score_breakdown.position.score - previousScore.strategic_score_breakdown.position.score,
    },
    {
      key: 'growth',
      label: 'growth',
      contributionDelta:
        (currentScore.strategic_score_breakdown.growth.score - previousScore.strategic_score_breakdown.growth.score) *
        currentScore.strategic_score_breakdown.growth.weight,
      rawDelta: currentScore.strategic_score_breakdown.growth.score - previousScore.strategic_score_breakdown.growth.score,
    },
    {
      key: 'risk',
      label: 'risk',
      contributionDelta:
        (currentScore.strategic_score_breakdown.risk.score - previousScore.strategic_score_breakdown.risk.score) *
        currentScore.strategic_score_breakdown.risk.weight,
      rawDelta: currentScore.strategic_score_breakdown.risk.score - previousScore.strategic_score_breakdown.risk.score,
    },
    {
      key: 'positioning',
      label: 'positioning',
      contributionDelta:
        (currentScore.strategic_score_breakdown.positioning.score - previousScore.strategic_score_breakdown.positioning.score) *
        currentScore.strategic_score_breakdown.positioning.weight,
      rawDelta: currentScore.strategic_score_breakdown.positioning.score - previousScore.strategic_score_breakdown.positioning.score,
    },
  ];

  const primary = [...components].sort((a, b) => Math.abs(b.contributionDelta) - Math.abs(a.contributionDelta))[0];
  const primaryDriver = primary
    ? `${primary.label} ${primary.rawDelta >= 0 ? 'improved' : 'weakened'} (${primary.rawDelta >= 0 ? '+' : ''}${Number(primary.rawDelta.toFixed(1))})`
    : 'Insufficient change signal to identify primary driver.';

  return {
    ...currentScore,
    strategic_score_change: delta,
    movement,
    primary_driver: primaryDriver,
  };
}

function healthToScore(health: PostIntelligence['scores']['health']): number {
  switch (health) {
    case 'excellent':     return 85;
    case 'good':          return 65;
    case 'fair':          return 40;
    case 'poor':          return 15;
    default:              return 50;
  }
}

function mapSnapshot(
  intel: ReportIntelligenceData,
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): ReportViewPayload {
  const { posts, portfolio } = intel;
  const { growth_summary, authority } = portfolio;

  const avgEngagement =
    posts.length > 0
      ? Math.round(posts.reduce((s, p) => s + p.scores.engagement, 0) / posts.length)
      : 0;

  // Top 3 posts by engagement for insight highlights
  const topPosts = [...posts]
    .sort((a, b) => b.scores.engagement - a.scores.engagement)
    .slice(0, 3);

  // Posts that need recovery (quick wins)
  const atRisk = posts.filter(
    (p) => p.scores.health === 'fair' || p.scores.health === 'poor',
  ).slice(0, 3);

  const insights: ReportViewInsight[] = [
    ...topPosts.map((p) => ({
      text: `"${p.title}" — ${p.scores.engagement}% engagement score`,
      icon: 'trend' as const,
      whyItMatters: 'This content is driving authority. Amplify and cross-link it.',
      businessImpact: 'Strong content performance supports qualified traffic, buyer trust, and downstream pipeline efficiency.',
    })),
    ...atRisk.map((p) => ({
      text: `"${p.title}" is ${p.scores.health} — needs attention`,
      icon: 'alert' as const,
      whyItMatters:
        p.recovery_actions[0]?.reason ??
        'Improving this post recovers lost visibility and ranking potential.',
      businessImpact: 'Underperforming content can reduce organic traffic and weaken the conversion path from content to pipeline.',
    })),
  ];

  const metrics: ReportViewMetric[] = [
    {
      label: 'Avg Engagement',
      score: avgEngagement,
      color: 'from-blue-400 to-blue-600',
    },
    {
      label: 'Authority Stage',
      score: authority.stages.findIndex((s) => s.label === authority.current_stage) * 25,
      color: 'from-purple-400 to-purple-600',
    },
    {
      label: 'Content Health',
      score: Math.round(
        posts.reduce((s, p) => s + healthToScore(p.scores.health), 0) / Math.max(posts.length, 1),
      ),
      color: 'from-green-400 to-green-600',
    },
  ];

  // Quick wins = first recovery action per at-risk post
  const opportunities: ReportViewOpportunity[] = atRisk.map((p) => ({
    title: p.title,
    description: p.recovery_actions[0]?.reason ?? 'Review and improve content quality.',
    impact: p.scores.health === 'poor' ? 'high' : 'medium',
    priority: p.scores.health === 'poor' ? 'Fix immediately' : 'Plan next',
  }));

  const nextSteps: ReportViewNextStep[] = growth_summary.quickWins
    .slice(0, 4)
    .map((action) => {
      const effortLevel: 'low' | 'medium' | 'high' = 'medium';
      const priorityType = classifyPriorityType({ impactScore: 68, effortLevel });
      return {
        action: action.title,
        description: action.title,
        steps: [],
        expectedOutcome: 'This action should improve visibility, trust, or conversion readiness.',
        expectedUpside: buildExpectedUpside({
          priorityType,
          impactScore: 68,
          expectedOutcome: 'This action should improve visibility, trust, or conversion readiness.',
        }),
        impactScore: 68,
        effortLevel,
        priorityType,
        priorityWhy: describePriorityType(priorityType),
      };
    });
  const topPriorities = buildFallbackTopPriorities(nextSteps);

  return {
    reportId,
    companyId,
    domain,
    reportType: 'snapshot',
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title: 'Digital Authority Snapshot',
    diagnosis: growth_summary.topPost ? `Top performing content: "${growth_summary.topPost.title}"` : 'Your content portfolio needs focused attention.',
    summary: `${growth_summary.highCount} high-performing posts, ${growth_summary.mediumCount} medium, ${growth_summary.lowCount} low.`,
    overallScore: avgEngagement,
    confidenceSource: `Based on ${posts.length} published posts`,
    insights,
    metrics,
    opportunities,
    topPriorities,
    nextSteps,
  };
}

function mapPerformance(
  intel: ReportIntelligenceData,
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): ReportViewPayload {
  const { posts } = intel;

  const healthCounts = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
  };
  for (const p of posts) {
    healthCounts[p.scores.health] = (healthCounts[p.scores.health] ?? 0) + 1;
  }

  const avgVisibility =
    posts.length > 0
      ? Math.round(posts.reduce((s, p) => s + p.scores.visibility, 0) / posts.length)
      : 0;
  const avgEngagement =
    posts.length > 0
      ? Math.round(posts.reduce((s, p) => s + p.scores.engagement, 0) / posts.length)
      : 0;

  const insights: ReportViewInsight[] = [
    {
      text: `${healthCounts.excellent + healthCounts.good} posts are healthy, ${healthCounts.poor} are poor`,
      icon: 'trend',
      whyItMatters: 'Health distribution directly maps to ranking and reader retention.',
      businessImpact: 'A weak content-health mix can suppress traffic recovery and lower the efficiency of content-led conversion.',
    },
    {
      text: `Average visibility score: ${avgVisibility}%`,
      icon: avgVisibility < 50 ? 'alert' : 'trend',
      whyItMatters: 'Visibility below 50% means most content is not being discovered.',
      businessImpact: 'Lower visibility reduces qualified traffic entering the funnel and limits the pool of visitors who can convert.',
    },
    {
      text: `Average engagement score: ${avgEngagement}%`,
      icon: avgEngagement < 40 ? 'alert' : 'trend',
      whyItMatters: 'Low engagement signals a content-audience fit problem.',
      businessImpact: 'Weak engagement usually lowers conversion quality because visitors are not finding enough relevance to keep moving.',
    },
  ];

  const metrics: ReportViewMetric[] = [
    { label: 'Avg Visibility', score: avgVisibility, color: 'from-blue-500 to-blue-700' },
    { label: 'Avg Engagement', score: avgEngagement, color: 'from-purple-500 to-purple-700' },
    {
      label: 'Healthy Posts',
      score: Math.round(((healthCounts.excellent + healthCounts.good) / Math.max(posts.length, 1)) * 100),
      color: 'from-green-500 to-green-700',
    },
  ];

  const opportunities: ReportViewOpportunity[] = posts
    .filter((p) => p.recovery_actions.length > 0)
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      description: p.recovery_actions[0]?.reason ?? '',
      impact: p.scores.health === 'poor' ? 'high' : 'medium',
      priority: p.scores.health === 'poor' ? 'Fix immediately' : 'Plan next',
    }));

  const nextSteps: ReportViewNextStep[] = posts
    .filter((p) => p.recovery_actions.length > 0)
    .slice(0, 4)
    .map((p) => {
      const effortLevel: 'low' | 'medium' | 'high' = p.scores.health === 'poor' ? 'high' : 'medium';
      const impactScore = p.scores.health === 'poor' ? 82 : 66;
      const priorityType = classifyPriorityType({ impactScore, effortLevel });
      return {
        action: `Improve: ${p.title}`,
        description: p.recovery_actions[0]?.reason ?? '',
        steps: [],
        expectedOutcome: 'This should improve the page health and recover lost performance.',
        expectedUpside: buildExpectedUpside({
          priorityType,
          impactScore,
          actionType: 'improve_content',
          expectedOutcome: 'This should improve the page health and recover lost performance.',
        }),
        impactScore,
        effortLevel,
        priorityType,
        priorityWhy: describePriorityType(priorityType),
      };
    });
  const topPriorities = buildFallbackTopPriorities(nextSteps);

  return {
    reportId,
    companyId,
    domain,
    reportType: 'performance',
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title: 'Performance Intelligence Report',
    diagnosis:
      avgEngagement < 40
        ? 'Content engagement is below threshold — reader fit requires realignment.'
        : 'Solid engagement base with recovery opportunities to unlock.',
    summary: `Your portfolio has ${posts.length} posts. ${healthCounts.excellent + healthCounts.good} are healthy, ${healthCounts.fair + healthCounts.poor} need recovery action.`,
    overallScore: Math.round((avgVisibility + avgEngagement) / 2),
    confidenceSource: `Derived from ${posts.length} post performance records`,
    insights,
    metrics,
    opportunities,
    topPriorities,
    nextSteps,
  };
}

function mapGrowth(
  intel: ReportIntelligenceData,
  reportId: string,
  companyId: string,
  domain: string,
  generatedDate: string,
  generated_at: string,
  is_stale: boolean,
  engine_version: string,
): ReportViewPayload {
  const { portfolio, gaps } = intel;
  const { authority, topic_performance, recommendations } = portfolio;

  const insights: ReportViewInsight[] = [
    {
      text: `Authority stage: ${authority.current_stage}`,
      icon: 'trend',
      whyItMatters: 'Authority stage determines which content investments unlock the next growth tier.',
      businessImpact: 'Authority strength affects how efficiently the business can win traffic, trust, and revenue in competitive topics.',
    },
    ...gaps.items.slice(0, 2).map((gap) => ({
      text: `Content gap: "${gap.topic}"`,
      icon: 'alert' as const,
      whyItMatters: gap.reason ?? 'Filling this gap directly expands your search footprint.',
      businessImpact: 'Open topic gaps limit discoverability and reduce the chances of converting buyers during research and evaluation.',
    })),
    ...topic_performance.slice(0, 2).map((tp) => ({
      text: `Topic "${tp.category}": ${tp.verdict}`,
      icon: tp.verdict === 'scale' ? ('trend' as const) : ('alert' as const),
      whyItMatters: tp.narrative,
      businessImpact:
        tp.verdict === 'scale'
          ? 'Strong topic performance creates leverage for more traffic, stronger trust, and better revenue capture.'
          : 'Weak topic performance leaves demand uncaptured and can slow both traffic growth and revenue contribution.',
    })),
  ];

  const metrics: ReportViewMetric[] = topic_performance.slice(0, 4).map((tp) => ({
    label: tp.category,
    score: Math.round(tp.avg_engagement ?? 0),
    color: tp.verdict === 'scale' ? 'from-emerald-400 to-teal-600' : 'from-orange-400 to-red-500',
  }));

  const opportunities: ReportViewOpportunity[] = gaps.items.slice(0, 6).map((gap) => ({
    title: gap.topic,
    description: gap.reason ?? 'No content exists for this topic yet.',
    impact: gap.priority === 'high' ? 'high' : gap.priority === 'medium' ? 'medium' : 'low',
    priority: gap.priority === 'high' ? 'Fix immediately' : 'Plan next',
  }));

  const nextSteps: ReportViewNextStep[] = recommendations.slice(0, 5).map((rec, index) => {
    const effortLevel: 'low' | 'medium' | 'high' = 'medium';
    const impactScore = Math.max(60, 78 - index * 6);
    const priorityType = classifyPriorityType({ impactScore, effortLevel });
    return {
      action: rec.action,
      description: rec.reason,
      steps: [],
      expectedOutcome: 'This should expand search footprint or strengthen authority.',
      expectedUpside: buildExpectedUpside({
        priorityType,
        impactScore,
        expectedOutcome: 'This should expand search footprint or strengthen authority.',
      }),
      impactScore,
      effortLevel,
      priorityType,
      priorityWhy: describePriorityType(priorityType),
    };
  });
  const topPriorities = buildFallbackTopPriorities(nextSteps);

  return {
    reportId,
    companyId,
    domain,
    reportType: 'growth',
    generatedDate,
    generated_at,
    is_stale,
    engine_version,
    status: 'completed',
    title: 'Market & Growth Intelligence Report',
    diagnosis: `You are at the "${authority.current_stage}" authority stage with ${gaps.items.length} topic gaps to close.`,
    summary: `${recommendations.length} strategic recommendations identified across ${topic_performance.length} tracked topics.`,
    overallScore: Math.round(
      topic_performance.reduce((s, tp) => s + (tp.avg_engagement ?? 0), 0) /
        Math.max(topic_performance.length, 1),
    ),
    confidenceSource: `Based on topic cluster analysis across ${topic_performance.length} topics`,
    insights,
    metrics,
    opportunities,
    topPriorities,
    nextSteps,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReportViewPayload | { error: string; code: string }>,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' });
  }

  const { user, error: authError } = await getSupabaseUserFromRequest(req);
  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }

  const reportId = req.query.reportId as string;
  const format = typeof req.query.format === 'string' ? req.query.format : 'json';

  // Task 4 — reject invalid report type values before any DB work
  const VALID_TYPES = ['snapshot', 'performance', 'growth'] as const;
  type ValidReportType = typeof VALID_TYPES[number];
  const rawType = req.query.type;
  if (typeof rawType !== 'string' || !VALID_TYPES.includes(rawType as ValidReportType)) {
    return res.status(400).json({
      error: `Invalid report type. Must be one of: ${VALID_TYPES.join(', ')}`,
      code: 'INVALID_REPORT_TYPE',
    });
  }
  const type = rawType as ValidReportType;

  // Fetch the report record — confirm ownership via company membership
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id, company_id, user_id, domain, report_type, status, created_at, data, metadata')
    .eq('id', reportId)
    .maybeSingle();

  if (reportError || !report) {
    return res.status(404).json({ error: 'Report not found', code: 'NOT_FOUND' });
  }

  // Confirm the requesting user belongs to this company
  const { data: membership } = await supabase
    .from('user_company_roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('company_id', report.company_id)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) {
    return res.status(403).json({ error: 'Access denied', code: 'ACCESS_DENIED' });
  }

  // Still generating — return status so the view page shows the spinner
  if (report.status !== 'completed' && report.status !== 'failed') {
    return res.status(202).json(
      buildGeneratingPayload(reportId, report.company_id, report.domain, type, report.created_at),
    );
  }

  if (report.status === 'failed') {
    return res.status(500).json({ error: 'Report generation failed', code: 'REPORT_FAILED' });
  }

  // Extract the stored intelligence snapshot
  const stored = report.data as {
    intelligence?: ReportIntelligenceData;
    composed_report?: ComposedReportData;
    engine_version?: string;
  } | null;
  const intel = stored?.intelligence;
  const composedReport = stored?.composed_report;

  if ((!intel || !intel.posts) && !composedReport) {
    void requeueIncompleteReport(report as ReportApiRow);
    return res.status(202).json(
      buildGeneratingPayload(reportId, report.company_id, report.domain, type, report.created_at),
    );
  }

  // Task 1 — staleness
  const generated_at = report.created_at;
  const is_stale = Date.now() - new Date(generated_at).getTime() > STALE_THRESHOLD_MS;

  const generatedDate = new Date(generated_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Task 3 — engine version stored at generation time, fall back to v1
  const engine_version = stored?.engine_version ?? 'v1';

  const composedPayload = composedReport
    ? mapComposedReport(
        composedReport,
        type,
        reportId,
        report.company_id,
        report.domain,
        generatedDate,
        generated_at,
        is_stale,
        engine_version,
      )
    : null;

  const mapStoredReportToPayload = (
    reportRow: {
      id: string;
      company_id: string;
      domain: string;
      report_type: string;
      status: string;
      created_at: string;
      data: unknown;
      metadata: unknown;
    },
  ): ReportViewPayload | null => {
    const rowStored = reportRow.data as {
      intelligence?: ReportIntelligenceData;
      composed_report?: ComposedReportData;
      engine_version?: string;
    } | null;

    const rowGeneratedAt = reportRow.created_at;
    const rowGeneratedDate = new Date(rowGeneratedAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    const rowIsStale = Date.now() - new Date(rowGeneratedAt).getTime() > STALE_THRESHOLD_MS;
    const rowEngineVersion = rowStored?.engine_version ?? 'v1';

    if (rowStored?.composed_report) {
      return mapComposedReport(
        rowStored.composed_report,
        'snapshot',
        reportRow.id,
        reportRow.company_id,
        reportRow.domain,
        rowGeneratedDate,
        rowGeneratedAt,
        rowIsStale,
        rowEngineVersion,
      );
    }

    if (rowStored?.intelligence?.posts) {
      return mapSnapshot(
        rowStored.intelligence,
        reportRow.id,
        reportRow.company_id,
        reportRow.domain,
        rowGeneratedDate,
        rowGeneratedAt,
        rowIsStale,
        rowEngineVersion,
      );
    }

    return null;
  };

  const isSnapshotCategoryRow = (row: {
    report_type: string;
    metadata: unknown;
  }): boolean => {
    if (row.report_type === 'snapshot') return true;
    if (row.report_type !== 'content_readiness') return false;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    return String(metadata.requested_report_category ?? 'snapshot') === 'snapshot';
  };

  const attachProgressComparison = async (
    currentPayload: ReportViewPayload,
  ): Promise<ReportViewPayload> => {
    if (type !== 'snapshot') return currentPayload;

    const { data: timelineReports } = await supabase
      .from('reports')
      .select('id, company_id, domain, report_type, status, created_at, data, metadata')
      .eq('company_id', report.company_id)
      .eq('domain', report.domain)
      .in('report_type', ['snapshot', 'content_readiness'])
      .eq('status', 'completed')
      .lte('created_at', report.created_at)
      .order('created_at', { ascending: false })
      .limit(18);

    const filteredTimelineReports = (timelineReports ?? []).filter(isSnapshotCategoryRow).slice(0, 6);

    if (filteredTimelineReports.length === 0) {
      const enrichedBase = {
        ...currentPayload,
        progressComparison: null,
        competitorMovementComparison: null,
        timelineComparison: null,
      };
      return {
        ...enrichedBase,
        strategicScore: buildStrategicScoreWithDelta({
          current: enrichedBase,
          previous: null,
        }),
      };
    }

    const mappedTimeline = filteredTimelineReports
      .map((row) => {
        if (row.id === currentPayload.reportId) return currentPayload;
        return mapStoredReportToPayload(row);
      })
      .filter((item): item is ReportViewPayload => Boolean(item))
      .sort((left, right) => new Date(right.generated_at).getTime() - new Date(left.generated_at).getTime());

    if (!mappedTimeline.some((item) => item.reportId === currentPayload.reportId)) {
      mappedTimeline.unshift(currentPayload);
    }

    const previousPayload = mappedTimeline.find((item) => item.reportId !== currentPayload.reportId) ?? null;

    if (!previousPayload) {
      const enrichedBase = {
        ...currentPayload,
        progressComparison: null,
        competitorMovementComparison: null,
        timelineComparison: buildTimelineComparison({
          snapshots: mappedTimeline.length > 0 ? mappedTimeline : [currentPayload],
        }),
      };
      return {
        ...enrichedBase,
        strategicScore: buildStrategicScoreWithDelta({
          current: enrichedBase,
          previous: null,
        }),
      };
    }

    const enrichedBase = {
      ...currentPayload,
      progressComparison: buildProgressComparison({
        current: currentPayload,
        previous: previousPayload,
      }),
      competitorMovementComparison: buildCompetitorMovementComparison({
        current: currentPayload,
        previous: previousPayload,
      }),
      timelineComparison: buildTimelineComparison({
        snapshots: mappedTimeline,
      }),
    };
    return {
      ...enrichedBase,
      strategicScore: buildStrategicScoreWithDelta({
        current: enrichedBase,
        previous: previousPayload,
      }),
    };
  };

  if (composedPayload) {
    const withComparison = await attachProgressComparison(composedPayload);
    const sanitizedWithComparison = sanitizeReportViewPayload(withComparison);
    if (format === 'pdf') {
      const pdfBuffer = await renderReportPdf(sanitizedWithComparison);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=\"${type}-${report.domain.replace(/[^a-z0-9.-]+/gi, '-')}-${reportId}.pdf\"`,
      );
      res.setHeader('Cache-Control', 'private, no-store');
      return (res as NextApiResponse).status(200).send(pdfBuffer);
    }
    return res.status(200).json(sanitizedWithComparison);
  }

  if (!intel || !intel.posts) {
    void requeueIncompleteReport(report as ReportApiRow);
    return res.status(202).json(
      buildGeneratingPayload(reportId, report.company_id, report.domain, type, report.created_at),
    );
  }

  const payload =
    type === 'performance'
      ? mapPerformance(intel, reportId, report.company_id, report.domain, generatedDate, generated_at, is_stale, engine_version)
      : type === 'growth'
        ? mapGrowth(intel, reportId, report.company_id, report.domain, generatedDate, generated_at, is_stale, engine_version)
        : mapSnapshot(intel, reportId, report.company_id, report.domain, generatedDate, generated_at, is_stale, engine_version);
  const payloadWithComparison = await attachProgressComparison(payload);
  const sanitizedPayloadWithComparison = sanitizeReportViewPayload(payloadWithComparison);

  if (format === 'pdf') {
    const pdfBuffer = await renderReportPdf(sanitizedPayloadWithComparison);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=\"${type}-${report.domain.replace(/[^a-z0-9.-]+/gi, '-')}-${reportId}.pdf\"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    return (res as NextApiResponse).status(200).send(pdfBuffer);
  }

  return res.status(200).json(sanitizedPayloadWithComparison);
}
