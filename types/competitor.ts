export interface CompetitorDimensionScores {
  productServiceFit: number;
  workflowFit: number;
  icpFit: number;
  customerEvaluationFit: number;
  useCaseFit: number;

  revenueScaleFit: number;
  employeeScaleFit: number;
  geographyFit: number;
  seoIntentFit: number;
}

export type CompetitorDiscoverySource =
  | 'manual'
  | 'stored'
  | 'provider'
  | 'serp'
  | 'ai-inferred'
  | 'ecosystem';

export type CompetitorCategory =
  | 'direct'
  | 'workflow-alternative'
  | 'enterprise'
  | 'emerging'
  | 'regional'
  | 'adjacent';

export type CompetitorIntelligenceTier =
  | 'core'
  | 'strong'
  | 'adjacent'
  | 'strategic';

export type CompetitorCapabilityVector = Record<string, number>;

export interface CompetitorScoreCard {
  overallScore: number;
  category: CompetitorCategory;
  tier?: CompetitorIntelligenceTier;

  dimensions: CompetitorDimensionScores;

  reasoning?: string[];

  confidence?: number;

  discoverySources?: CompetitorDiscoverySource[];

  capabilityVector?: CompetitorCapabilityVector;
}

export interface DebugCompetitorScoring {
  rejected: Array<{
    company: string;
    score: number;
    failedDimensions: string[];
  }>;
}
