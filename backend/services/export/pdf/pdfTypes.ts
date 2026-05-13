import PDFDocument from 'pdfkit';

export type PDFDoc = InstanceType<typeof PDFDocument>;

export type EffortLevel = 'low' | 'medium' | 'high';
export type ReportType = 'snapshot' | 'performance' | 'growth';

export type PdfInsight = {
  text: string;
  whyItMatters: string;
  businessImpact: string;
};

export type PdfTopPriority = {
  title: string;
  whyNow: string;
  expectedOutcome: string;
  expectedUpside: string;
  effortLevel: EffortLevel;
  priorityType: 'quick_win' | 'high_impact' | 'strategic';
  priorityWhy: string;
  impactScore: number;
  confidenceScore: number;
  impactLabel?: string;
  timeToImpact?: string;
};

export type PdfNextStep = {
  action: string;
  description: string;
  steps: string[];
  reasoning?: string;
  tactics?: string[];
  focusPage?: string;
  timeline?: {
    short: string;
    mid: string;
    long: string;
  };
  priority?: 'high' | 'medium' | 'low';
  impact?: 'high' | 'medium' | 'low';
  effort?: 'low' | 'medium' | 'high';
  confidence?: number;
  expectedOutcome: string;
  expectedUpside: string;
  effortLevel: EffortLevel;
  priorityType: 'quick_win' | 'high_impact' | 'strategic';
  priorityWhy: string;
};

export type PdfReportPayload = {
  domain: string;
  overallScore?: number;
  companyContext?: {
    companyName: string | null;
    domain: string | null;
    homepageHeadline: string | null;
    tagline: string | null;
    primaryOffering: string | null;
    positioning: string | null;
    marketContext: string | null;
    logoUrl?: string | null;
    faviconUrl?: string | null;
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
  title: string;
  reportType: ReportType;
  generatedDate: string;
  diagnosis: string;
  summary: string;
  confidenceSource?: string;
  scoreExplanation?: {
    dimensions?: Array<{
      key: string;
      label: string;
      value: number;
      explanation: string;
    }>;
    weakestDimensions?: Array<{
      key: string;
      label: string;
      value: number;
    }>;
    limitingFactors?: string[];
    growthPath?: {
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
  seoExecutiveSummary?: {
    overallHealthScore: number;
    primaryProblem: {
      title: string;
      impactedArea: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: Array<{
      actionTitle: string;
      title?: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
      tactics?: string[];
      focusPage?: string;
      timeline?: {
        short: string;
        mid: string;
        long: string;
      };
      impact?: 'high' | 'medium' | 'low';
      confidence?: number;
    }>;
    growthOpportunity: {
      title: string;
      estimatedUpside: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  seoVisuals?: {
    seoCapabilityRadar: {
      technical_seo_score: number | null;
      keyword_research_score: number | null;
      rank_tracking_score: number | null;
      backlinks_score: number | null;
      competitor_intelligence_score: number | null;
      content_quality_score: number | null;
      confidence: 'high' | 'medium' | 'low';
      data_source_strength?: Record<string, 'strong' | 'inferred' | 'weak' | 'missing'>;
      source_tags?: Record<string, string[] | null>;
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
  geoAeoExecutiveSummary?: {
    overallAiVisibilityScore: number;
    primaryGap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
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
  geoAeoVisuals?: {
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
  unifiedIntelligenceSummary?: {
    unifiedScore: number;
    marketContextSummary?: string;
    dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced';
    primaryConstraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
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
  competitorVisuals?: {
    competitorPositioningRadar: {
      competitors: Array<{
        name: string;
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
  competitorIntelligenceSummary?: {
    topCompetitor: string;
    primaryGap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
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
  competitiveSnapshot?: {
    competitors: Array<{ name: string; tier: 'Tier 1' | 'Tier 2' | 'Tier 3'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
    summary: { topThreat: string; immediatePositioningAngle: string; action: string };
  } | null;
  competitivePressureAnalysis?: {
    competitors: Array<{ name: string; tier: 'Tier 1' | 'Tier 2' | 'Tier 3'; threatLevel: 'low' | 'medium' | 'high'; authorityScore: number; pressureOn: string[]; action: string }>;
    summary: { highestPressure: string; primaryRisk: string; nextAction: string };
  } | null;
  competitiveStrategyMap?: {
    tierBreakdown: {
      tier1: Array<{ name: string; tier: 'Tier 1'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
      tier2: Array<{ name: string; tier: 'Tier 2'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
      tier3: Array<{ name: string; tier: 'Tier 3'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
    };
    opportunityMap: { whitespaceOpportunities: string[]; underexploitedIcpSegments: string[]; weakCompetitorAreas: string[] };
    strategicActions: { howToBeatTier1: string; howToDifferentiateFromTier2: string; howToIgnoreTier3: string };
  } | null;
  strategicPosition?: {
    positioningStatement: string;
    primaryBattlefield: string;
    avoidanceZone: string;
    messagingAngle: string;
  } | null;
  competitorContext?: {
    summary: string;
    competitors: Array<{
      name: string;
      domain: string | null;
      classification: string;
      source: string;
      relevanceScore: number;
      category?: string | null;
      tags?: string[];
      problemOverlap?: number;
      icpOverlap?: number;
      marketOverlap?: number;
      revenueTier?: 'startup' | 'growth' | 'scale' | 'enterprise' | null;
      productDepth?: number;
      authorityScore?: number;
      authoritySignals?: {
        traffic_estimate?: string | null;
        installs?: string | null;
        reviews?: string | null;
        funding_level?: 'bootstrap' | 'funded' | 'enterprise';
        search_visibility?: string | null;
        brand_strength?: 'low' | 'medium' | 'high';
      } | null;
      finalScore?: number;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3' | null;
      positioning?: {
        strengths_vs_company: string[];
        weaknesses_vs_company: string[];
        differentiation: string;
        threat_level: 'low' | 'medium' | 'high';
      } | null;
      enrichmentConfidenceScore?: number;
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
      rationale: string;
      standing: 'Behind' | 'At Par' | 'Ahead';
    }>;
    marketAlternatives?: Array<{
      name: string;
      category?: string | null;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3' | null;
      relevanceScore: number;
      finalScore: number;
      authorityScore: number;
      rationale: string;
      useCase?: string | null;
      businessModel?: string | null;
    }>;
    competitiveSummary?: {
      topThreats: string[];
      keyAdvantage: string;
      keyRisk: string;
      positioningStatement: string;
    } | null;
    strongestGaps: Array<{
      gapType: string;
      title: string;
      whyItMatters: string;
      confidenceScore: number;
      impactScore: number;
      leadingCompetitors: string[];
    }>;
  };
  competitorMovementComparison?: {
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
    summary: {
      overall_trend: 'improving' | 'declining' | 'stable';
      key_movement: string;
    };
  } | null;
  progressComparison?: {
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
  timelineComparison?: {
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
  topPriorities: PdfTopPriority[];
  insights: PdfInsight[];
  nextSteps: PdfNextStep[];
};
