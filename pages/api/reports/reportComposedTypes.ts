import type { PriorityType } from '../../../backend/services/actionPriorityService';
// GAP-01 — the canonical Report 1 contract.
//
// `composed_report` is a verbatim persistence of the `SnapshotReport` produced by
// `composeSnapshotReport` (see reportCardServiceAssembly.enrichComposedReportWithInputContext,
// which spreads it). Every canonical Report 1 field below therefore ALREADY exists on the stored
// row; it was simply absent from this type, so the mapper could not read it without an `as any`
// escape and the renderer never saw it.
//
// These are TYPE-ONLY re-uses of the producer's own declarations. No parallel schema is
// introduced: if `SnapshotReport` changes shape, this contract changes with it and the compiler
// reports every consumer that must follow.
import type { CanonicalReport } from '../../../backend/services/canonicalReport/canonicalReportTypes';
import type { ScoreState, SnapshotReport, SystemMaturityClass } from '../../../backend/services/snapshotReportTypes';

export type ComposedReportSection = {
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
    reasoning?: string;
    recommendation?: string;
    steps?: string[];
    tactics?: string[];
    focus_page?: string;
    timeline?: {
      short?: string;
      mid?: string;
      long?: string;
    };
    priority?: 'high' | 'medium' | 'low';
    impact?: 'high' | 'medium' | 'low';
    effort?: 'low' | 'medium' | 'high';
    confidence?: number;
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

export type ComposedReportData = {
  report_type?: 'snapshot' | 'performance' | 'growth';
  score?: {
    available?: boolean;
    value?: number | null;
    /**
     * GAP-01 — the evidence state that authorises `value`.
     *
     * `buildReportScoreModel` has always emitted this, but this type omitted it, so the mapper
     * had to read it through `(report.score as any)?.state`. That cast is what decides whether
     * the UI shows a number or "Insufficient signal", which makes it exactly the wrong place
     * for an unchecked escape: a typo in the property name would have silently downgraded
     * every measured score to `insufficient_signal` with no compiler complaint.
     */
    state?: ScoreState;
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
    logo_url?: string | null;
    favicon_url?: string | null;
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
      category?: string;
      tags?: string[];
      problem_overlap?: number;
      icp_overlap?: number;
      market_overlap?: number;
      revenue_tier?: 'startup' | 'growth' | 'scale' | 'enterprise';
      product_depth?: number;
      authority_score?: number;
      authority_signals?: {
        traffic_estimate?: string | null;
        installs?: string | null;
        reviews?: string | null;
        funding_level?: 'bootstrap' | 'funded' | 'enterprise';
        search_visibility?: string | null;
        brand_strength?: 'low' | 'medium' | 'high';
      };
      final_score?: number;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3';
      positioning?: {
        strengths_vs_company?: string[];
        weaknesses_vs_company?: string[];
        differentiation?: string;
        threat_level?: 'low' | 'medium' | 'high';
      };
      enrichment_confidence_score?: number;
      enrichment?: {
        category?: string | null;
        description?: string | null;
        icp?: {
          age_group?: string | null;
          use_case?: string | null;
          user_intent?: string | null;
        };
        business_model?: string | null;
        geography?: string | null;
        product_type?: string | null;
        scale_signals?: Record<string, unknown>;
        confidence_score?: number;
        sources?: string[];
      } | null;
      rationale?: string;
    }>;
    market_alternatives?: Array<{
      name?: string;
      domain?: string | null;
      classification?: string;
      source?: string;
      relevance_score?: number;
      category?: string;
      tags?: string[];
      problem_overlap?: number;
      icp_overlap?: number;
      market_overlap?: number;
      revenue_tier?: 'startup' | 'growth' | 'scale' | 'enterprise';
      product_depth?: number;
      authority_score?: number;
      authority_signals?: {
        traffic_estimate?: string | null;
        installs?: string | null;
        reviews?: string | null;
        funding_level?: 'bootstrap' | 'funded' | 'enterprise';
        search_visibility?: string | null;
        brand_strength?: 'low' | 'medium' | 'high';
      };
      final_score?: number;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3';
      positioning?: {
        strengths_vs_company?: string[];
        weaknesses_vs_company?: string[];
        differentiation?: string;
        threat_level?: 'low' | 'medium' | 'high';
      };
      enrichment_confidence_score?: number;
      enrichment?: {
        category?: string | null;
        description?: string | null;
        icp?: {
          age_group?: string | null;
          use_case?: string | null;
          user_intent?: string | null;
        };
        business_model?: string | null;
        geography?: string | null;
        product_type?: string | null;
        scale_signals?: Record<string, unknown>;
        confidence_score?: number;
        sources?: string[];
      } | null;
      rationale?: string;
    }>;
    competitive_summary?: {
      top_threats?: string[];
      key_advantage?: string;
      key_risk?: string;
      positioning_statement?: string;
    };
    competitors_by_tier?: {
      tier_1?: Array<{ name?: string; category?: string; tags?: string[]; tier?: string; final_score?: number; authority_score?: number; positioning?: { strengths_vs_company?: string[]; weaknesses_vs_company?: string[]; differentiation?: string; threat_level?: 'low' | 'medium' | 'high' }; rationale?: string }>;
      tier_2?: Array<{ name?: string; category?: string; tags?: string[]; tier?: string; final_score?: number; authority_score?: number; positioning?: { strengths_vs_company?: string[]; weaknesses_vs_company?: string[]; differentiation?: string; threat_level?: 'low' | 'medium' | 'high' }; rationale?: string }>;
      tier_3?: Array<{ name?: string; category?: string; tags?: string[]; tier?: string; final_score?: number; authority_score?: number; positioning?: { strengths_vs_company?: string[]; weaknesses_vs_company?: string[]; differentiation?: string; threat_level?: 'low' | 'medium' | 'high' }; rationale?: string }>;
    };
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
    reasoning?: string;
    tactics?: string[];
    focus_page?: string;
    timeline?: {
      short?: string;
      mid?: string;
      long?: string;
    };
    priority?: 'high' | 'medium' | 'low';
    impact?: 'high' | 'medium' | 'low';
    effort?: 'low' | 'medium' | 'high';
    confidence?: number;
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
      title?: string;
      priority?: 'high' | 'medium' | 'low';
      expected_impact?: 'high' | 'medium' | 'low';
      effort?: 'low' | 'medium' | 'high';
      linked_visual?: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning?: string;
      tactics?: string[];
      focus_page?: string;
      timeline?: {
        short?: string;
        mid?: string;
        long?: string;
      };
      impact?: 'high' | 'medium' | 'low';
      confidence?: number;
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
  competitive_snapshot?: {
    competitors?: Array<{
      name?: string;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3';
      threat_level?: 'low' | 'medium' | 'high';
      differentiation?: string;
    }>;
    competitive_snapshot_summary?: {
      top_threat?: string;
      immediate_positioning_angle?: string;
      action?: string;
    };
  };
  competitive_pressure_analysis?: {
    competitors?: Array<{
      name?: string;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3';
      threat_level?: 'low' | 'medium' | 'high';
      authority_score?: number;
      pressure_on?: string[];
      action?: string;
    }>;
    summary?: {
      highest_pressure?: string;
      primary_risk?: string;
      next_action?: string;
    };
  } | null;
  competitive_strategy_map?: {
    tier_breakdown?: {
      tier_1?: Array<{ name?: string; tier?: 'Tier 1'; threat_level?: 'low' | 'medium' | 'high'; differentiation?: string }>;
      tier_2?: Array<{ name?: string; tier?: 'Tier 2'; threat_level?: 'low' | 'medium' | 'high'; differentiation?: string }>;
      tier_3?: Array<{ name?: string; tier?: 'Tier 3'; threat_level?: 'low' | 'medium' | 'high'; differentiation?: string }>;
    };
    opportunity_map?: {
      whitespace_opportunities?: string[];
      underexploited_icp_segments?: string[];
      weak_competitor_areas?: string[];
    };
    strategic_actions?: {
      how_to_beat_tier_1?: string;
      how_to_differentiate_from_tier_2?: string;
      how_to_ignore_tier_3?: string;
    };
  } | null;
  strategic_position?: {
    positioning_statement?: string;
    primary_battlefield?: string;
    avoidance_zone?: string;
    messaging_angle?: string;
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

  // ── Canonical Report 1 contract (GAP-01) ────────────────────────────────────
  //
  // Optional because a legacy stored report (composed before these phases shipped) will not
  // carry them. Absent stays absent — the mapper maps `null`/`undefined` through unchanged and
  // the renderer omits the corresponding section rather than inventing an empty one.

  /** Canonical report layer (Phase 2). Previously reachable only via `(report as any).canonical`. */
  canonical?: CanonicalReport;
  /** @deprecated legacy maturity mirror — kept because `mapComposedReport` still reads it. */
  system_maturity?: SystemMaturityClass;
  /** Report 1 assembly: cross-source opportunities, top priorities, 30/60/90 plan. */
  digital_snapshot?: SnapshotReport['digital_snapshot'];
  /** Phase 2 evidence coverage, lifted verbatim from `canonical.evidence_readiness`. */
  evidence_coverage?: SnapshotReport['evidence_coverage'];
  /** Phase 4 digital-experience readiness + evidence-linked findings. */
  digital_experience?: SnapshotReport['digital_experience'];
  /** Phase 4 provider-supplied performance measurements. No Omnivyra performance score. */
  performance?: SnapshotReport['performance'];
  /** Phase 3 two-axis public-domain competition views. */
  competitive_tables?: SnapshotReport['competitive_tables'];
  /** GAP-09 — what evidence acquisition did on this run (crawl outcome + SERP state). */
  evidence_acquisition?: SnapshotReport['evidence_acquisition'];
  /** GAP-06 — public-domain search visibility, sourced from public SERP acquisition only. */
  search_visibility?: SnapshotReport['search_visibility'];
  /** GAP-08 — identity fields with explicit provenance. */
  company_identity?: SnapshotReport['company_identity'];
  /** GAP-10 — the per-check website evidence the deterministic engines already produced. */
  website_checks?: SnapshotReport['website_checks'];
};
