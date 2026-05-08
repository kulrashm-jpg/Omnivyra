import type { buildReportScoreModel } from '../reportScoreModelService';
import type { CompetitorIntelligenceResult } from '../reportCompetitorIntelligenceService';
import type { buildPublicDomainAuditDecisions } from '../publicDomainAuditService';
import type { PriorityType } from '../actionPriorityService';

export const SNAPSHOT_MIN_INSIGHTS = 3;
export const SNAPSHOT_MIN_ACTIONS = 2;

export type SignalAvailabilityLevel = 'NO_DATA' | 'LOW_DATA' | 'NORMAL';
export type SnapshotSignalKey =
  | 'content_coverage'
  | 'seo_structure'
  | 'authority'
  | 'competitor'
  | 'geo_relevance';

export type SnapshotInsight = {
  decision_id: string;
  title: string;
  description: string;
  why_it_matters: string;
  business_impact: string;
  issue_type: string;
  confidence_score: number;
  impact_score: number;
  recommendation: string;
  action_type: string;
};

export type SnapshotOpportunity = {
  decision_id: string;
  title: string;
  recommendation: string;
  confidence_score: number;
  action_type: string;
};

export type SnapshotAction = {
  decision_id: string;
  title: string;
  reasoning: string;
  recommendation: string;
  steps: string[];
  tactics: string[];
  focus_page: string;
  timeline: {
    short: string;
    mid: string;
    long: string;
  };
  priority: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  confidence: number;
  expected_outcome: string;
  expected_upside: string;
  effort_level: 'low' | 'medium' | 'high';
  priority_type: PriorityType;
  impact_score: number;
  confidence_score: number;
  action_type: string;
  action_payload: Record<string, unknown>;
};

export type SnapshotTopPriority = {
  title: string;
  why_now: string;
  reasoning: string;
  tactics: string[];
  focus_page: string;
  timeline: {
    short: string;
    mid: string;
    long: string;
  };
  priority: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  confidence: number;
  expected_outcome: string;
  expected_upside: string;
  effort_level: 'low' | 'medium' | 'high';
  priority_type: PriorityType;
  impact_score: number;
  confidence_score: number;
};

export interface SnapshotReportSection {
  section_name: string;
  IU_ids: string[];
  insights: SnapshotInsight[];
  opportunities: SnapshotOpportunity[];
  actions: SnapshotAction[];
}

export interface SnapshotReport {
  report_type: 'snapshot';
  score: ReturnType<typeof buildReportScoreModel>;
  diagnosis: string;
  summary: string;
  primary_problem: string;
  secondary_problems: string[];
  seo_executive_summary: {
    overall_health_score: number;
    primary_problem: {
      title: string;
      impacted_area: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_actions: Array<{
      action_title: string;
      title: string;
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linked_visual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
      tactics: string[];
      focus_page: string;
      timeline: {
        short: string;
        mid: string;
        long: string;
      };
      impact: 'high' | 'medium' | 'low';
      confidence: number;
    }>;
    growth_opportunity: {
      title: string;
      estimated_upside: string;
      based_on: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  geo_aeo_visuals: {
    ai_answer_presence_radar: {
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
    query_answer_coverage_map: {
      queries: Array<{
        query: string;
        coverage: 'full' | 'partial' | 'missing';
        answer_quality_score: number;
      }>;
      confidence: 'high' | 'medium' | 'low';
    };
    answer_extraction_funnel: {
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
    entity_authority_map: {
      entities: Array<{
        entity: string;
        relevance_score: number;
        coverage_score: number;
      }>;
      confidence: 'high' | 'medium' | 'low';
    };
  };
  geo_aeo_executive_summary: {
    overall_ai_visibility_score: number;
    primary_gap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_actions: Array<{
      action_title: string;
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linked_visual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }>;
    visibility_opportunity: {
      title: string;
      estimated_ai_exposure: string;
      based_on: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  unified_intelligence_summary: {
    unified_score: number;
    market_context_summary: string;
    dominant_growth_channel: 'seo' | 'geo_aeo' | 'balanced';
    primary_constraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_unified_actions: Array<{
      action_title: string;
      source: 'seo' | 'geo_aeo';
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    growth_direction: {
      short_term_focus: string;
      long_term_focus: string;
    };
    confidence: 'high' | 'medium' | 'low';
  };
  competitor_visuals: {
    competitor_positioning_radar: {
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
    keyword_gap_analysis: {
      missing_keywords: string[];
      weak_keywords: string[];
      strong_keywords: string[];
      confidence: 'high' | 'medium' | 'low';
    };
    ai_answer_gap_analysis: {
      missing_answers: string[];
      weak_answers: string[];
      strong_answers: string[];
      confidence: 'high' | 'medium' | 'low';
    };
  };
  competitor_intelligence_summary: {
    top_competitor: string;
    competitor_explanation: string;
    primary_gap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    };
    top_3_actions: Array<{
      action_title: string;
      priority: 'high' | 'medium' | 'low';
      expected_impact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }>;
    competitive_position: 'leader' | 'competitive' | 'lagging';
    confidence: 'high' | 'medium' | 'low';
  } | null;
  visual_intelligence: {
    seo_capability_radar: {
      technical_seo_score: number | null;
      keyword_research_score: number | null;
      rank_tracking_score: number | null;
      backlinks_score: number | null;
      competitor_intelligence_score: number | null;
      content_quality_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength: {
        technical_seo_score: 'strong' | 'inferred' | 'weak' | 'missing';
        keyword_research_score: 'strong' | 'inferred' | 'weak' | 'missing';
        rank_tracking_score: 'strong' | 'inferred' | 'weak' | 'missing';
        backlinks_score: 'strong' | 'inferred' | 'weak' | 'missing';
        competitor_intelligence_score: 'strong' | 'inferred' | 'weak' | 'missing';
        content_quality_score: 'strong' | 'inferred' | 'weak' | 'missing';
      };
      source_tags: {
        technical_seo_score: string[] | null;
        keyword_research_score: string[] | null;
        rank_tracking_score: string[] | null;
        backlinks_score: string[] | null;
        competitor_intelligence_score: string[] | null;
        content_quality_score: string[] | null;
      };
    };
    opportunity_coverage_matrix: {
      opportunities: Array<{
        keyword: string;
        opportunity_score: number;
        coverage_score: number;
        opportunity_value_score: number | null;
        priority_bucket: 'quick_win' | 'strategic' | 'low_priority' | null;
        confidence: 'high' | 'medium' | 'low';
      }>;
      confidence: 'high' | 'medium' | 'low';
      opportunity_reasoning: string;
    };
    search_visibility_funnel: {
      impressions: number | null;
      clicks: number | null;
      ctr: number | null;
      estimated_lost_clicks: number | null;
      confidence: 'high' | 'medium' | 'low';
      drop_off_reason_distribution: {
        ranking_issue_pct: number | null;
        ctr_issue_pct: number | null;
        intent_mismatch_pct: number | null;
      };
    };
    crawl_health_breakdown: {
      metadata_issues: number | null;
      structure_issues: number | null;
      internal_link_issues: number | null;
      crawl_depth_issues: number | null;
      confidence: 'high' | 'medium' | 'low';
      severity_split: {
        critical: number | null;
        moderate: number | null;
        low: number | null;
        classification: 'classified' | 'unclassified';
      };
    };
  };
  // signal_availability removed in Phase 2 — replaced by canonical pillar/dimension states.
  company_context: {
    company_name: string | null;
    domain: string | null;
    homepage_headline: string | null;
    tagline: string | null;
    primary_offering: string | null;
    positioning: string | null;
    market_context: string | null;
    logo_url: string | null;
    favicon_url: string | null;
    positioning_strength: PositioningStrength;
    positioning_narrative: string;
    positioning_gap: string | null;
    market_type: MarketType;
    market_narrative: string;
    strategy_alignment: string;
    market_position: 'below market' | 'at parity' | 'ahead';
    market_position_statement: string;
    position_implication: string;
    execution_risk: string;
    resilience_guidance: string;
  };
  competitor_intelligence: CompetitorIntelligenceResult;
  decision_snapshot: {
    primary_focus_area: string;
    whats_broken: string;
    what_to_fix_first: string;
    what_to_delay: string;
    if_ignored: string;
    execution_sequence: string[];
    if_executed_well: string;
    when_to_expect_impact: {
      short_term: string;
      mid_term: string;
      long_term: string;
    };
    impact_scale: 'high_impact' | 'medium_impact' | 'foundational_impact';
    current_state: string;
    expected_state: string;
    outcome_confidence: 'high' | 'medium' | 'low';
  };
  top_priorities: SnapshotTopPriority[];
  pipeline_audit: {
    resolver_inputs_present: number;
    snapshot_decisions: number;
    supplemental_growth_decisions: number;
    competitor_gap_decisions_added: number;
    fallback_decisions_added: number;
    final_decisions: number;
    final_insights: number;
    final_actions: number;
  };
  sections: SnapshotReportSection[];
}

export type SnapshotReportOptions = {
  resolvedInput?: import('../reportInputResolver').ResolvedReportInput | null;
  readiness?: import('../reportReadinessService').ReportReadinessResult | null;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
};

export type SnapshotSectionDefinition = {
  key: 'visibility' | 'content_strength' | 'authority';
  section_name: string;
  IU_ids: string[];
  matches: (decision: import('../decisionObjectService').PersistedDecisionObject) => boolean;
};

export const NARRATIVE_INTENT = {
  unified: 'overall_market_direction',
  competitor: 'why_competitor_wins',
  opportunity: 'why_gap_exists',
} as const;

export const SIGNAL_BUCKETS = {
  unified: ['authority_gap', 'visibility_loss', 'content_coverage'],
  competitor: ['authority_comparison', 'content_depth', 'positioning'],
  opportunity: ['keyword_gap', 'missing_pages', 'intent_mismatch'],
} as const;

export type NarrativeSection = keyof typeof NARRATIVE_INTENT;
export type NarrativeSignal = {
  key: string;
  text: string;
};
export type NarrativeContext = {
  usedSignals: Set<string>;
  usedTemplateIds: Set<string>;
};

export type CompanyNarrativeContext = {
  companyName: string | null;
  domain: string | null;
  homepageHeadline: string | null;
  tagline: string | null;
  primaryOffering: string | null;
  positioning: string | null;
  marketContext: string | null;
  marketFocus: string | null;
  productServices: string[];
  geography: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
};

export type PositioningStrength = 'strong' | 'moderate' | 'weak';
export type MarketType = 'competitive' | 'saturated' | 'emerging' | 'niche';
export type StrategicContext = {
  positioningStrength: PositioningStrength;
  positioningNarrative: string;
  positioningGap: string | null;
  marketType: MarketType;
  marketNarrative: string;
  keySuccessFactor: string;
  strategyAlignment: string;
  marketPosition: 'below market' | 'at parity' | 'ahead';
  marketPositionStatement: string;
  positionImplication: string;
  executionRisk: string;
  resilienceGuidance: string;
};

export type StructuredActionTrack = 'authority' | 'positioning' | 'comparison' | 'generic';

export const UNIFIED_TEMPLATES = [
  'You are currently {impact} due to {primary_signal}, with additional pressure from {secondary_signal}.',
  '{primary_signal} is driving your current performance, further affected by {secondary_signal}.',
  'Your visibility is being shaped by {primary_signal}, with noticeable influence from {secondary_signal}.',
] as const;

export const COMPETITOR_TEMPLATES = [
  '{competitor} is ahead due to stronger {primary_signal}, particularly in {specific_area}.',
  '{competitor} maintains an advantage through better {primary_signal}, especially across {specific_area}.',
  '{competitor} outperforms by leading in {primary_signal}, with clear strength in {specific_area}.',
] as const;

export const OPPORTUNITY_TEMPLATES = [
  'This gap exists because {primary_signal}, limiting your ability to capture {intent_type} traffic.',
  '{primary_signal} is creating this gap, reducing your visibility for {intent_type} queries.',
  'The absence of {primary_signal} is restricting your ability to capture {intent_type} demand.',
] as const;
