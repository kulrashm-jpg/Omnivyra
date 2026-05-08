import type { CampaignPlan } from '../contracts/CampaignContracts';
import type { RepositoryWriteResult } from '../contracts/RepositoryContracts';

export interface CampaignRepository {
  savePlan(plan: CampaignPlan): Promise<RepositoryWriteResult>;
}
