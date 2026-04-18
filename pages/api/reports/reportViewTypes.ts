import type { PriorityType } from '../../../backend/services/actionPriorityService';

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
  reasoning: string;
  tactics: string[];
  focusPage: string;
  timeline: {
    short: string;
    mid: string;
    long: string;
  };
  priority: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  confidence: number;
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
    title: string;
    priority: 'high' | 'medium' | 'low';
    expectedImpact: 'high' | 'medium' | 'low';
    effort: 'low' | 'medium' | 'high';
    linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
    reasoning: string;
    tactics: string[];
    focusPage: string;
    timeline: {
      short: string;
      mid: string;
      long: string;
    };
    impact: 'high' | 'medium' | 'low';
    confidence: number;
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
