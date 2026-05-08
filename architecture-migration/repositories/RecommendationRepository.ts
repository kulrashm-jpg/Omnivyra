import type { Recommendation } from '../contracts/RecommendationContracts';
import type { RepositoryWriteResult } from '../contracts/RepositoryContracts';

export interface RecommendationRepository {
  saveSnapshot(recommendation: Recommendation): Promise<RepositoryWriteResult>;
}
