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
  ScoreState,
  SystemMaturityClass,
} from './reportViewTypes';
import type { CanonicalReport } from '../../../backend/services/canonicalReport/canonicalReportTypes';
import type { SnapshotReport } from '../../../backend/services/snapshotReportTypes';

export type CanonicalReportPayload = CanonicalReport;

// GAP-01 — the Report 1 payload carried alongside `canonical`.
//
// `canonical` owns scores, pillars, playbook and evidence trace. These five fields are the
// Report 1 surfaces the canonical builder does NOT own: they are produced by the Phase 3/4
// modules and by `digitalSnapshotAssembly`, and were previously dropped between the stored
// report and the renderer. Types are re-used from the producer verbatim.
export type ReportViewDigitalSnapshot = NonNullable<SnapshotReport['digital_snapshot']>;
export type ReportViewEvidenceCoverage = NonNullable<SnapshotReport['evidence_coverage']>;
export type ReportViewDigitalExperience = NonNullable<SnapshotReport['digital_experience']>;
export type ReportViewPerformanceEvidence = NonNullable<SnapshotReport['performance']>;
export type ReportViewCompetitiveTables = NonNullable<SnapshotReport['competitive_tables']>;
export type ReportViewEvidenceAcquisition = NonNullable<SnapshotReport['evidence_acquisition']>;
export type ReportViewSearchVisibility = NonNullable<SnapshotReport['search_visibility']>;
export type ReportViewCompanyIdentity = NonNullable<SnapshotReport['company_identity']>;

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
  overallScoreState: ScoreState;
  systemMaturity: SystemMaturityClass;
  // Canonical Architecture Consolidation (Phase 2): single source of truth that
  // replaces the seo_executive_summary / geo_aeo_executive_summary /
  // unified_intelligence_summary / competitor_intelligence_summary / decision_snapshot
  // surfaces. New UI consumes only `canonical`.
  canonical: CanonicalReportPayload | null;
  // GAP-01 — Report 1 surfaces carried beside `canonical`. `null` means the stored report did
  // not produce this surface; the renderer omits the section rather than rendering an empty one.
  digitalSnapshot: ReportViewDigitalSnapshot | null;
  evidenceCoverage: ReportViewEvidenceCoverage | null;
  digitalExperience: ReportViewDigitalExperience | null;
  performanceEvidence: ReportViewPerformanceEvidence | null;
  competitiveTables: ReportViewCompetitiveTables | null;
  evidenceAcquisition: ReportViewEvidenceAcquisition | null;
  searchVisibility: ReportViewSearchVisibility | null;
  companyIdentity: ReportViewCompanyIdentity | null;
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
  seoExecutiveSummary?: ReportViewSeoExecutiveSummary;
  seoVisuals?: ReportViewSeoVisuals;
  geoAeoVisuals?: ReportViewGeoAeoVisuals;
  geoAeoExecutiveSummary?: ReportViewGeoAeoExecutiveSummary;
  unifiedIntelligenceSummary?: ReportViewUnifiedIntelligenceSummary;
  competitorVisuals?: ReportViewCompetitorVisuals;
  competitorIntelligenceSummary?: ReportViewCompetitorIntelligenceSummary;
  competitiveSnapshot?: {
    competitors: Array<{
      name: string;
      tier: 'Tier 1' | 'Tier 2' | 'Tier 3';
      threatLevel: 'low' | 'medium' | 'high';
      differentiation: string;
    }>;
    summary: {
      topThreat: string;
      immediatePositioningAngle: string;
      action: string;
    };
  } | null;
  competitivePressureAnalysis?: {
    competitors: Array<{
      name: string;
      tier: 'Tier 1' | 'Tier 2' | 'Tier 3';
      threatLevel: 'low' | 'medium' | 'high';
      authorityScore: number;
      pressureOn: string[];
      action: string;
    }>;
    summary: {
      highestPressure: string;
      primaryRisk: string;
      nextAction: string;
    };
  } | null;
  competitiveStrategyMap?: {
    tierBreakdown: {
      tier1: Array<{ name: string; tier: 'Tier 1'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
      tier2: Array<{ name: string; tier: 'Tier 2'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
      tier3: Array<{ name: string; tier: 'Tier 3'; threatLevel: 'low' | 'medium' | 'high'; differentiation: string }>;
    };
    opportunityMap: {
      whitespaceOpportunities: string[];
      underexploitedIcpSegments: string[];
      weakCompetitorAreas: string[];
    };
    strategicActions: {
      howToBeatTier1: string;
      howToDifferentiateFromTier2: string;
      howToIgnoreTier3: string;
    };
  } | null;
  strategicPosition?: {
    positioningStatement: string;
    primaryBattlefield: string;
    avoidanceZone: string;
    messagingAngle: string;
  } | null;
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
