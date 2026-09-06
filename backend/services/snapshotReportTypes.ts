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
// GAP-10 — the provenance vocabulary is owned by `evidenceProvenance.ts`; imported, never restated.
import type { EvidenceProvenanceClass } from './evidenceProvenance';

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
   * GAP-09 — what evidence acquisition actually did on this run (crawl outcome + SERP state).
   *
   * Persisted so a stored report can be interrogated later: a report whose sections all abstain
   * is only trustworthy if the record shows whether that is because the site was healthy, or
   * because nothing was ever fetched.
   */
  evidence_acquisition?: SnapshotEvidenceAcquisition | null;
  /**
   * GAP-06 — what public search results establish about this domain. Sourced exclusively from
   * public SERP acquisition; never from Search Console or any other connected private analytics.
   */
  search_visibility?: SnapshotSearchVisibility | null;
  /**
   * GAP-08 — the customer-facing identity fields with their provenance made explicit, so declared
   * information can never be read as public observation.
   */
  company_identity?: SnapshotCompanyIdentity | null;
  /**
   * GAP-10 — the per-check website evidence the deterministic engines already produce.
   *
   * `null` when nothing was evaluable (a company with no crawled pages), so the section abstains
   * rather than rendering a wall of "not evaluated".
   */
  website_checks?: SnapshotWebsiteChecks | null;
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
  /**
   * GAP-09 — the outcome of the report-triggered crawl.
   *
   * `ensureReportCrawlEvidence` runs in `generateReportPayload` BEFORE composition and its result
   * was only ever `console.info`'d, so a report could not state whether the website it describes
   * was actually fetched. The caller now hands the existing result down; the composer stores it
   * verbatim. Optional — a growth/performance run does not crawl, and a legacy caller omits it.
   */
  crawlEvidence?: SnapshotCrawlEvidence | null;
};

/**
 * GAP-09 — the run's evidence-acquisition record.
 *
 * Deliberately a RECORD OF WHAT HAPPENED, not a score and not a judgement. It answers one
 * question the report previously could not: *was the website actually crawled, and what came
 * back?* A report that abstains everywhere is credible only if it can say why, and "we never
 * fetched the site" and "we fetched the site and it is healthy" are the two readings the reader
 * must never have to guess between.
 *
 * Nothing here is derived. `crawl` is the existing `ReportCrawlEvidenceResult` narrowed to the
 * fields a reader needs; `serp` is read from the competitor engine's existing
 * `discovery_metadata`. No new acquisition, no second evidence model.
 */
export type SnapshotCrawlEvidence = {
  /** Existing `ReportCrawlAction`: reused | crawled | refreshed | partial | skipped_no_domain | failed. */
  action: string;
  /** Pages in `canonical_pages` after the decision — the number every crawl-derived percentage is over. */
  pagesAfter: number;
  /** Pages present before it ran; `pagesAfter > pagesBefore` means this run fetched new evidence. */
  pagesBefore: number;
  /** Most recent `last_crawled_at` seen for the company, when any page exists. */
  lastCrawledAt: string | null;
  durationMs: number;
  /** The service's own decision reason — never customer copy on its own, but honest when surfaced. */
  reason: string;
  /** Present only when the crawl was attempted and threw. */
  error?: string;
};

/**
 * GAP-06 — public-domain search visibility.
 *
 * Answers ONE question: *what can public search results currently establish about this domain?*
 * It deliberately does not answer "what does the connected Search Console property say" — that is
 * private, customer-granted data and belongs to a different report. Every value here originates
 * from a public SERP response.
 *
 * `position === null` on an observation means the domain was not found in the returned window.
 * That is a finding, not a zero: a rank of 0 does not exist, and rendering one would convert an
 * absence into a measurement.
 */
export type SnapshotSearchObservation = {
  query: string;
  /** The provider's own rank. Null when the domain did not appear in the returned rows. */
  position: number | null;
  url: string | null;
  title: string | null;
  snippet: string | null;
  /** Organic rows returned for this query — the window the position was (or was not) found in. */
  resultCount: number;
};

export type SnapshotSearchVisibility = {
  /**
   * `measured`            — queries ran and the domain was observed at least once.
   * `insufficient_signal` — queries ran but the domain was not observed in any of them.
   * `unavailable`         — acquisition could not run (no credential, or budget exhausted).
   * `failed`              — acquisition was attempted and the provider errored.
   */
  state: 'measured' | 'insufficient_signal' | 'unavailable' | 'failed';
  /** Provider identifier, never a credential or an environment-variable name. */
  provider: string | null;
  /**
   * GAP-07 — the evidence source and its provenance class, carried on the surface itself.
   *
   * Stamped so this can never be confused with the GSC-derived rank signal: that one is
   * CONNECTED_SOURCE (the customer's authenticated property), this one is PUBLIC_OBSERVED (rows
   * anyone can see). Both describe the same search engine; only one belongs in a public-domain
   * report as observation.
   */
  source: 'serp';
  provenance: 'PUBLIC_OBSERVED';
  observedAt: string | null;
  queriesRun: number;
  /** Queries where the company's own domain appeared. */
  queriesRanked: number;
  /** Best (lowest) observed position across all queries; null when never observed. */
  bestPosition: number | null;
  observations: SnapshotSearchObservation[];
  /** External SERP requests attributable to this report run. */
  requestsMade: number;
  reason: string | null;
};

/**
 * GAP-08 — one customer-facing identity field, with its provenance made explicit.
 *
 * The Brand Brief renders Offering / Positioning / Market / Differentiation with a `measured`
 * state and no marker, while every one of those values comes from the company's own profile.
 * `company_context.homepage_headline` is the sharpest case: the NAME says the crawler read it off
 * the home page; the VALUE is `profile.key_messages`, typed into an onboarding form.
 *
 * The fix is labelling, never deletion — declared information is useful, it simply must not wear
 * an observed field's clothes. Where a public observation also exists the two are reconciled and
 * the disagreement, if any, stays visible rather than being silently resolved in favour of either.
 *
 * `provenance` is the GAP-07 vocabulary, not a second taxonomy.
 */
export type SnapshotIdentityField = {
  key: 'offering' | 'positioning' | 'market' | 'differentiation';
  label: string;
  /** The value shown to the customer — observed when one exists, otherwise declared. */
  value: string;
  provenance: 'PUBLIC_OBSERVED' | 'COMPANY_CONFIRMED' | 'INFERRED';
  /** What the company told us. Retained even when an observation supersedes it. */
  declaredValue: string | null;
  /** What the public web actually shows, when it could be read. */
  observedValue: string | null;
  /**
   * `observed_only` — the public web established it and nothing was declared.
   * `declared_only`  — the company stated it and no public observation exists.
   * `agree`          — both exist and match.
   * `differ`         — both exist and disagree. Rendered as a disagreement, never collapsed.
   */
  agreement: 'observed_only' | 'declared_only' | 'agree' | 'differ';
};

export type SnapshotCompanyIdentity = {
  fields: SnapshotIdentityField[];
  /** True when at least one field rests on company-declared input. Drives the section note. */
  hasDeclared: boolean;
  /** True when at least one field could be read from the public web. */
  hasObserved: boolean;
};

/**
 * GAP-10 — one website check, exactly as the deterministic engine already computed it.
 *
 * The technical, content and accessibility engines evaluate 60+ checks on every snapshot run, and
 * every one of them was discarded before persistence: `engineEvidenceDigest` fed narrative text
 * only, so `robots_txt`, `sitemap_xml`, `structured_data`, `hreflang` and `duplicate_titles` had
 * ZERO occurrences in a persisted `composed_report` while the same report stated that 27 pages had
 * been evaluated. This carries the existing results through — it does not re-evaluate anything.
 *
 * `status` is the engine's own verdict and is never rewritten. In particular `not_evaluable`
 * (the engine had no data) stays distinct from an evaluated check that observed zero findings —
 * "we did not look" and "we looked and found none" are different statements about the site.
 *
 * The engine's numeric `score` is DELIBERATELY not carried. It is a per-check pass percentage,
 * and GAP-10 delivers observations, not a second scoring surface. Counts the customer needs are
 * already present in `detail` ("3 duplicate titles", "12 sitemap URLs"), written by the engine.
 */
export type SnapshotWebsiteCheck = {
  /** The engine's own key, e.g. `robots_txt`. Never renamed. */
  key: string;
  /** The engine's own label, e.g. "robots.txt". */
  label: string;
  /** The engine's own verdict. `not_evaluable` means no stored data, never a failure. */
  status: 'pass' | 'warn' | 'fail' | 'not_evaluable';
  /** The engine's own observed detail, carrying the counts. Null when the engine wrote none. */
  detail: string | null;
  /** Which deterministic engine produced it — for grouping and for honest attribution. */
  engine: 'technical' | 'content' | 'accessibility';
  /**
   * GAP-11A — example pages drawn from the SAME rows the aggregate counted.
   *
   * "3 duplicate titles" is a number a reader cannot act on; "which pages?" is the next question.
   * Only checks whose own computation already holds the affected page rows supply this, so a URL
   * here was always fetched and counted — never derived from a domain, path, title or count.
   *
   * Absent means the check is aggregate-only, NOT that nothing was affected. Bounded by the
   * producer and deliberately not exhaustive, so the renderer must never present it as the
   * complete list.
   */
  examples?: Array<{ url: string }>;
};

/** GAP-10 — presentation grouping. Names follow the section's own vocabulary, not a new taxonomy. */
export type SnapshotWebsiteCheckGroup = {
  id:
    | 'reachability'
    | 'indexability'
    | 'metadata'
    | 'structured_data'
    | 'linking'
    | 'rendering'
    | 'content_structure'
    | 'accessibility';
  label: string;
  checks: SnapshotWebsiteCheck[];
};

export type SnapshotWebsiteChecks = {
  groups: SnapshotWebsiteCheckGroup[];
  /**
   * Coverage disclosure in the GAP-09 idiom ("9 of 10 signals"): how many checks the engines could
   * actually evaluate. These are COUNTS OF CHECKS, deliberately not a ratio, percentage, band or
   * score — GAP-10 introduces no scoring surface of any kind.
   */
  evaluated: number;
  notEvaluable: number;
  total: number;
  /** Pages the crawl corpus held for this run, as already reported by the digital-experience read. */
  pagesEvaluated: number;
  /**
   * GAP-07 vocabulary. Every check here derives from the public crawl, so the class is resolved by
   * `provenanceForSource('public_audit')` — `evidenceProvenance.ts` stays the sole authority and
   * this surface follows it, rather than asserting a literal that could silently diverge from it.
   */
  provenance: EvidenceProvenanceClass;
};

export type SnapshotEvidenceAcquisition = {
  crawl: SnapshotCrawlEvidence | null;
  /**
   * SERP acquisition state for this run, lifted from `competitor_intelligence.discovery_metadata`.
   * `live` = at least one keyword returned usable domains; `fallback` = the queries ran but
   * yielded nothing usable; `unavailable` = no discovery metadata was produced at all.
   */
  serp: {
    status: 'live' | 'fallback' | 'unavailable';
    keywordCount: number | null;
    domainsFound: number | null;
  };
  /** When this record was assembled — the report's own observation time for acquisition. */
  observedAt: string;
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
