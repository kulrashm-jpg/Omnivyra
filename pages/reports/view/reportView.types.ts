/**
 * Types and pure helpers for the report view page.
 */

export function formatPriorityType(value: 'quick_win' | 'high_impact' | 'strategic'): string {
  if (value === 'quick_win') return 'Quick Win';
  if (value === 'high_impact') return 'High Impact';
  return 'Strategic';
}

export function getScoreStage(score: number): 'Early-stage' | 'Growing' | 'Leader' {
  if (score >= 75) return 'Leader';
  if (score >= 45) return 'Growing';
  return 'Early-stage';
}

export function getScoreStory(score: number, weakestDimensions: Array<{ label: string; value: number }>): string {
  const weakest = weakestDimensions.slice(0, 2).map((item) => item.label.toLowerCase()).join(' and ');
  const stage = getScoreStage(score);
  if (stage === 'Leader') {
    return `The score is in leader territory because the business has a relatively balanced baseline, although ${weakest || 'a few weaker areas'} still limit how dominant it can become.`;
  }
  if (stage === 'Growing') {
    return `The score is in the growing range because the business has real strength, but ${weakest || 'a few uneven dimensions'} are still pulling down overall market position.`;
  }
  return `The score is early-stage because weak spots in ${weakest || 'multiple core dimensions'} are reducing the total more than stronger areas can compensate for.`;
}

export function getFilenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8Match = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).replace(/^["']|["']$/g, '').trim();
    } catch {
      return utf8Match[1].replace(/^["']|["']$/g, '').trim();
    }
  }
  const simpleMatch = header.match(/filename\s*=\s*"([^"]+)"/i) ?? header.match(/filename\s*=\s*([^;]+)/i);
  return simpleMatch?.[1] ? simpleMatch[1].replace(/^["']|["']$/g, '').trim() : null;
}

/**
 * Task 6 — Type safety.
 * ReportData is the canonical shape returned by /api/reports/[reportId].
 * It is derived from CompanyBlogIntelligenceResult via the server-side mappers —
 * no independent scoring logic lives here.
 */
export interface ReportData {
  reportId: string;
  companyId: string;
  domain: string;
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
  title: string;
  reportType: 'snapshot' | 'performance' | 'growth';
  generatedDate: string;
  status: 'generating' | 'completed' | 'failed';
  diagnosis: string;
  overallScore: number;
  scoreExplanation?: {
    dimensions: {
      key: string;
      label: string;
      value: number;
      explanation: string;
    }[];
    weakestDimensions: {
      key: string;
      label: string;
      value: number;
    }[];
    limitingFactors: string[];
    growthPath: {
      currentLevel: string;
      nextLevel: string | null;
      focus: string[];
      projectedScoreImprovements: {
        dimension: string;
        currentValue: number;
        projectedValue: number;
        projectedTotalScore: number;
      }[];
    };
  };
  confidenceSource: string;
  summary: string;
  insights: {
    text: string;
    icon: string;
    whyItMatters: string;
    businessImpact: string;
  }[];
  metrics: {
    label: string;
    score: number;
    color: string;
  }[];
  opportunities: {
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    priority: string;
  }[];
  competitorContext?: {
    summary: string;
    competitors: {
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
      finalScore?: number;
      tier?: 'Tier 1' | 'Tier 2' | 'Tier 3' | null;
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
    }[];
    strongestGaps: {
      gapType: string;
      title: string;
      whyItMatters: string;
      confidenceScore: number;
      impactScore: number;
      leadingCompetitors: string[];
    }[];
  };
  seoExecutiveSummary?: {
    overallHealthScore: number;
    primaryProblem: {
      title: string;
      impactedArea: 'technical_seo' | 'content' | 'keywords' | 'backlinks' | 'visibility';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: {
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }[];
    growthOpportunity: {
      title: string;
      estimatedUpside: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  geoAeoExecutiveSummary?: {
    overallAiVisibilityScore: number;
    primaryGap: {
      title: string;
      type: 'answer_gap' | 'entity_gap' | 'structure_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: {
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      linkedVisual: 'radar' | 'matrix' | 'funnel' | 'crawl';
      reasoning: string;
    }[];
    visibilityOpportunity: {
      title: string;
      estimatedAiExposure: string;
      basedOn: string;
    } | null;
    confidence: 'high' | 'medium' | 'low';
  };
  unifiedIntelligenceSummary?: {
    unifiedScore: number;
    marketContextSummary: string;
    dominantGrowthChannel: 'seo' | 'geo_aeo' | 'balanced';
    primaryConstraint: {
      title: string;
      source: 'seo' | 'geo_aeo';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3UnifiedActions: {
      actionTitle: string;
      source: 'seo' | 'geo_aeo';
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }[];
    growthDirection: {
      shortTermFocus: string;
      longTermFocus: string;
    };
    confidence: 'high' | 'medium' | 'low';
  };
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
  strategicScore?: {
    value: number;
    label: 'strong strategic position' | 'developing position' | 'constrained position';
    strategic_score_change: number | null;
    movement: 'improving' | 'declining' | 'stable';
    primary_driver: string;
    interpretation: string;
    confidence: 'high' | 'medium' | 'low';
    strategic_score_breakdown: {
      position: { state: 'below market' | 'at parity' | 'ahead'; score: number; weight: number };
      growth: { state: 'improving' | 'stable' | 'declining'; score: number; weight: number };
      risk: { state: 'high' | 'medium' | 'low'; score: number; weight: number };
      positioning: { state: 'weak' | 'moderate' | 'strong'; score: number; weight: number };
    };
  };
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
  competitorMovementComparison?: {
    previous_report_id: string;
    current_report_id: string;
    competitors: {
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
    }[];
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
  timelineComparison?: {
    snapshots: {
      report_id: string;
      created_at: string;
      unified_score: number | null;
      competitor: {
        domain: string;
        score: number;
      } | null;
      delta_from_previous: number | null;
    }[];
    meta: {
      trend: 'improving' | 'declining' | 'stable';
      total_change: number | null;
      data_points: number;
      data_status: 'complete' | 'partial' | 'insufficient';
    };
  } | null;
  competitorVisuals?: {
    competitorPositioningRadar: {
      competitors: {
        name: string;
        domain: string;
        content_score: number;
        keyword_coverage_score: number;
        authority_score: number;
        technical_score: number;
        ai_answer_presence_score: number;
      }[];
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
    competitorExplanation: string;
    primaryGap: {
      title: string;
      type: 'keyword_gap' | 'authority_gap' | 'answer_gap';
      severity: 'critical' | 'moderate' | 'low';
      reasoning: string;
    };
    top3Actions: {
      actionTitle: string;
      priority: 'high' | 'medium' | 'low';
      expectedImpact: 'high' | 'medium' | 'low';
      effort: 'low' | 'medium' | 'high';
      reasoning: string;
    }[];
    competitivePosition: 'leader' | 'competitive' | 'lagging';
    confidence: 'high' | 'medium' | 'low';
  } | null;
  seoVisuals?: {
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
      opportunities: {
        keyword: string;
        opportunity_score: number;
        coverage_score: number;
        opportunity_value_score?: number | null;
        priority_bucket?: 'quick_win' | 'strategic' | 'low_priority' | null;
        confidence: 'high' | 'medium' | 'low';
      }[];
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
      queries: {
        query: string;
        coverage: 'full' | 'partial' | 'missing';
        answer_quality_score: number;
      }[];
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
      entities: {
        entity: string;
        relevance_score: number;
        coverage_score: number;
      }[];
      confidence: 'high' | 'medium' | 'low';
    };
  };
  topPriorities: {
    title: string;
    whyNow: string;
    expectedOutcome: string;
    expectedUpside: string;
    effortLevel: 'low' | 'medium' | 'high';
    priorityType: 'quick_win' | 'high_impact' | 'strategic';
    priorityWhy: string;
    impactScore: number;
    confidenceScore: number;
    impactLabel: string;
    timeToImpact: string;
  }[];
  nextSteps: {
    action: string;
    description: string;
    steps: string[];
    expectedOutcome: string;
    expectedUpside: string;
    effortLevel: 'low' | 'medium' | 'high';
    priorityType: 'quick_win' | 'high_impact' | 'strategic';
    priorityWhy: string;
  }[];
}

export function isSnapshotReport(data: ReportData): boolean {
  return data.reportType === 'snapshot';
}
export default function ReportViewTypesPage() {
  return null;
}
