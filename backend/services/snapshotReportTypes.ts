import type { PersistedDecisionObject } from './decisionObjectService';
import type { ReportReadinessResult } from './reportReadinessService';
import type { ResolvedReportInput } from './reportInputResolver';
import type { CompetitorIntelligenceResult } from './reportCompetitorIntelligenceService';
import type { CompetitiveSnapshotReport } from './reportCompetitorStrategyService';
import type { buildPublicDomainAuditDecisions } from './publicDomainAuditService';
import type { PriorityType } from './actionPriorityService';
import type { buildReportScoreModel } from './reportScoreModelService';
import type { ScoreState, SystemMaturityClass } from './snapshotReport/canonicalScoreState';
import type { CanonicalReport } from './canonicalReport/canonicalReportTypes';

export type { ScoreState, SystemMaturityClass } from './snapshotReport/canonicalScoreState';

/** @deprecated Phase 2 removes signal_availability from the public report shape.
 *  Internal narrative helpers now consume `weakSignalChannels: string[]` derived
 *  inline. The legacy enum survives only to preserve `signalAvailabilityFromDecisions`'s
 *  return type so the helper does not need a parallel rewrite in this phase. */
export type SignalAvailabilityLevel = 'NO_DATA' | 'LOW_DATA' | 'NORMAL';
/** @deprecated Phase 2: see above. */
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
  /** @deprecated Phase 7. Read `canonical.authority_overview.headline.text` or
   *  `canonical.executive_insights.primary_constraint.text` instead. Retained
   *  until automation-activity + PDF export migrate. */
  primary_problem: string;
  /** @deprecated Phase 7. Read `canonical.executive_insights.authority_risk.text` instead. */
  secondary_problems: string[];
  system_maturity: SystemMaturityClass;
  /**
   * Canonical Architecture (final). The single authoritative report contract.
   * Every Phase 7 API surface, export renderer, and UI section reads from here.
   * Legacy fields below are vestigial — tracked for elimination as their last
   * remaining consumers migrate.
   */
  canonical: CanonicalReport;
  /** @deprecated Phase 7. Read `canonical.executive_insights` + `canonical.action_playbook`. */
  seo_executive_summary: {
    overall_health_score: number | null;
    overall_health_score_state: ScoreState;
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
      axis_states: {
        answer_coverage_score: ScoreState;
        entity_clarity_score: ScoreState;
        topical_authority_score: ScoreState;
        citation_readiness_score: ScoreState;
        content_structure_score: ScoreState;
        freshness_score: ScoreState;
      };
      benchmark: {
        answer_coverage_score: number | null;
        entity_clarity_score: number | null;
        topical_authority_score: number | null;
        citation_readiness_score: number | null;
        content_structure_score: number | null;
        freshness_score: number | null;
      };
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
  /** @deprecated Phase 7. Read `canonical.ai_surface_presence` + `canonical.executive_insights`. */
  /**
   * Report 1 assembly — the CMO-facing decision layer: cross-source opportunities, at most
   * five top priorities, and the evidence-driven 30/60/90 plan. Assembled last, from outputs
   * the canonical builder and the Phase 3/4 modules already produced.
   */
  digital_snapshot?: SnapshotDigitalSnapshot;
  /**
   * Phase 4 — website performance and digital-experience intelligence.
   *
   * `performance` carries provider-supplied measurements only: metrics classified with
   * Google's own CrUX categories, or against the published Core Web Vitals thresholds when
   * only lab data exists. There is deliberately no Omnivyra performance score.
   *
   * `digital_experience` is a READINESS CLASSIFICATION plus evidence-linked findings, not a
   * 0–100 score — no defensible benchmark for "digital experience" exists, and inventing one
   * would reintroduce the false precision earlier phases removed. `describesVisitorBehavior`
   * is permanently false: this describes the observed website, never observed visitors.
   */
  performance?: {
    state: string;
    reasonUnavailable: string | null;
    coverage: { measured: number; attempted: number; eligible: number };
    byFormFactor: Record<'mobile' | 'desktop', { measured: number; verdict: string }>;
    observations: Array<{
      url: string;
      formFactor: 'mobile' | 'desktop';
      providerPerformanceScore: number | null;
      overallCategory: string;
      observedAt: string;
      provider: string;
      state: string;
      reasonUnavailable: string | null;
      metrics: Array<{
        key: string; label: string; value: number | null; unit: string;
        category: string; verdict: string; source: string | null;
        threshold: { good: number; poor: number } | null; state: string;
      }>;
    }>;
  } | null;
  digital_experience?: {
    readiness: string;
    state: string;
    coverage: { pagesEvaluated: number; signalsEvaluated: number; signalsTotal: number };
    pillars: Array<{
      pillar: string; label: string; readiness: string; state: string;
      coverage: { evaluated: number; total: number };
      findings: SnapshotExperienceFinding[];
    }>;
    findings: SnapshotExperienceFinding[];
    limitations: Array<{ kind: string; message: string; affects: string[] }>;
    describesVisitorBehavior: false;
  } | null;
  /**
   * Phase 3 — the two customer-facing competition views.
   *
   * Table A answers "who solves a substantially similar problem?"; Table B answers "who
   * competes for the same customer decision?". They are DELIBERATELY separate: a company can
   * be strong on one axis and weak on the other, and collapsing them into a single score is
   * what previously made Semrush and HubSpot indistinguishable from a true direct rival.
   *
   * Both are rendered from the canonical `competitorRelationModel`; no consumer may classify.
   * Customer-facing classification uses the evidence-derived vocabulary
   * (direct / adjacent / substitute / strategic / not_competitive / unknown), NOT the legacy
   * `direct_competitor | seo_competitor | authority_leader` field, which remains on
   * `competitor_intelligence` for internal compatibility only.
   */
  competitive_tables?: {
    productCompetition: Array<{
      competitor: string;
      domain: string | null;
      productOverlap: number | null;
      problemUseCaseOverlap: number | null;
      evidence: string[];
      classification: 'direct' | 'adjacent' | 'substitute' | 'none' | 'unknown';
      confidence: string;
      state: string;
    }>;
    marketCompetition: Array<{
      competitor: string;
      domain: string | null;
      customerIcp: string | null;
      segment: 'smb' | 'mid_market' | 'enterprise' | 'unknown';
      geography: string | null;
      marketOverlap: number | null;
      evidence: string[];
      classification: 'same_segment' | 'adjacent_segment' | 'different' | 'unknown';
      confidence: string;
      state: string;
    }>;
    unclassified: Array<{ competitor: string; domain: string | null; reason: string; signalCount: number }>;
    summary: Record<'direct' | 'adjacent' | 'substitute' | 'strategic' | 'not_competitive' | 'unclassified', number>;
    empty: boolean;
    emptyReason: string | null;
  };
  /**
   * Phase 2 — evidence coverage as a first-class report field.
   *
   * Lifted verbatim from `canonical.evidence_readiness` (no recomputation) so a reader can
   * see what was measured, what could not be, why, and what would unlock it — before
   * reading any conclusion. Deliberately SEPARATE from the scores: coverage describes how
   * much is known, not how good the company is, and it never reduces a score.
   */
  evidence_coverage?: {
    state: string;
    disposition: string;
    coverage_percentage: number;
    ai_coverage_percentage: number | null;
    connected_sources: number;
    total_sources: number;
    website_scanned: boolean;
    authority_measured: boolean;
    headline: string;
    gaps: Array<{ area: string; why: string; impact: string; next_step: string; expected_benefit: string }>;
    next_moves: string[];
  } | null;
  geo_aeo_executive_summary: {
    overall_ai_visibility_score: number | null;
    overall_ai_visibility_score_state: ScoreState;
    /**
     * Phase 2: NULLABLE. When AI visibility is `insufficient_signal` or `unavailable`
     * there is no diagnosis to make, and the report must say nothing rather than assert
     * a generic AEO deficiency. Consumers must handle null.
     */
    primary_gap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
      if_not_addressed: string;
    } | null;
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
  /** @deprecated Phase 7. Read `canonical.authority_overview.overall_score` + `canonical.executive_insights`. */
  unified_intelligence_summary: {
    unified_score: number | null;
    unified_score_state: ScoreState;
    system_maturity: SystemMaturityClass;
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
  competitive_snapshot: CompetitiveSnapshotReport;
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
      axis_states: {
        technical_seo_score: ScoreState;
        keyword_research_score: ScoreState;
        rank_tracking_score: ScoreState;
        backlinks_score: ScoreState;
        competitor_intelligence_score: ScoreState;
        content_quality_score: ScoreState;
      };
      benchmark: {
        technical_seo_score: number | null;
        keyword_research_score: number | null;
        rank_tracking_score: number | null;
        backlinks_score: number | null;
        competitor_intelligence_score: number | null;
        content_quality_score: number | null;
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
  /** @deprecated Phase 7. Read `canonical.executive_insights` + `canonical.action_playbook` instead. */
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
  /** @deprecated Phase 7. Read `canonical.action_playbook.actions` + `canonical.strategic_playbook.actions`. */
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
  resolvedInput?: ResolvedReportInput | null;
  readiness?: ReportReadinessResult | null;
  publicAudit?: Awaited<ReturnType<typeof buildPublicDomainAuditDecisions>> | null;
};

export type SnapshotSectionDefinition = {
  key: 'visibility' | 'content_strength' | 'authority';
  section_name: string;
  IU_ids: string[];
  matches: (decision: PersistedDecisionObject) => boolean;
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

export type NarrativeSection = keyof typeof NARRATIVE_INTENT;
export type NarrativeSignal = {
  key: string;
  text: string;
};

export type NarrativeContext = {
  usedSignals: Set<string>;
  usedTemplateIds: Set<string>;
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

/**
 * Phase 4 — one Digital Experience finding, in the Phase 2 recommendation contract:
 * Problem → Evidence → Why it matters → Action → Effort → Priority(severity) → Measurement.
 * Structurally typed so the report contract matches `digitalExperience.ExperienceFinding`
 * without the types module importing the service.
 */
export type SnapshotExperienceFinding = {
  pillar: string;
  problem: string;
  evidence: string;
  whyItMatters: string;
  action: string;
  severity: string;
  effort: string;
  measurement: string;
};

/**
 * Report 1 assembly output — the CMO-facing decision layer.
 *
 * Cross-source opportunities, at most five top priorities, and an evidence-driven 30/60/90
 * plan. Produced by `digitalSnapshotAssembly`, which reads already-computed outputs and adds
 * no score of its own. Structurally typed so this module does not import the assembler.
 */
export type SnapshotDigitalSnapshot = {
  opportunities: Array<{
    id: string; title: string; problem: string;
    evidence: Array<{ source: string; statement: string; state: ScoreState }>;
    businessImplication: string; action: string; expectedImpact: string;
    impact: number; confidence: string; effort: string; priorityScore: number;
    measurement: string; measurementAvailable: boolean;
    sources: string[]; crossSource: boolean; horizon: string;
  }>;
  topPriorities: SnapshotDigitalSnapshot['opportunities'];
  plan: {
    days_0_30: SnapshotPlanItem[];
    days_31_60: SnapshotPlanItem[];
    days_61_90: SnapshotPlanItem[];
    notes: string[];
  };
  unmeasuredDimensions: string[];
  empty: boolean;
};

export type SnapshotPlanItem = {
  title: string; action: string; why: string;
  measurement: string; measurementAvailable: boolean;
  effort: string; confidence: string; sources: string[];
};
