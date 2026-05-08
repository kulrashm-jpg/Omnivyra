export type RecommendationSignal = {
  signalId: string;
  organizationId: string;
  companyId: string;
  source: string;
  payload: Record<string, unknown>;
};

export type RecommendationEngineInput = {
  organizationId: string;
  companyId: string;
  engineVersion: string;
  signals: RecommendationSignal[];
};

export type Recommendation = {
  id?: string;
  signalId: string;
  normalizedRecommendationKey: string;
  title: string;
  rationale: string;
  score: number;
  fingerprint: string;
};

export type RecommendationEngineResult = {
  recommendations: Recommendation[];
};

export interface RecommendationEngineContract {
  generate(input: RecommendationEngineInput): Promise<RecommendationEngineResult>;
}
