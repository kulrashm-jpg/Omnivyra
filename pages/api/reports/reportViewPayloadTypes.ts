import type {
  ReportViewCompetitorIntelligenceSummary,
  ReportViewCompetitorMovementComparison,
  ReportViewCompetitorVisuals,
  ReportViewGeoAeoExecutiveSummary,
  ReportViewGeoAeoVisuals,
  ReportViewInsight,
  ReportViewMetric,
  ReportViewNextStep,
  ReportViewOpportunity,
  ReportViewProgressComparison,
  ReportViewSeoExecutiveSummary,
  ReportViewSeoVisuals,
  ReportViewStrategicScore,
  ReportViewTimelineComparison,
  ReportViewTopPriority,
  ReportViewUnifiedIntelligenceSummary,
} from './reportViewTypes';

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
