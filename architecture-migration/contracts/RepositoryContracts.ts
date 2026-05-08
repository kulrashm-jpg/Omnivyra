import type { CampaignPlan } from './CampaignContracts';
import type { ContentGenerationResult } from './ContentGenerationContracts';
import type { Recommendation } from './RecommendationContracts';
import type { ScheduleCommand, ScheduleResult } from './ScheduleContracts';

export type RepositoryWriteResult<TId extends string = string> = {
  id: TId;
  fingerprint?: string;
  created: boolean;
};

export interface CampaignRepositoryContract {
  savePlan(plan: CampaignPlan): Promise<RepositoryWriteResult>;
}

export interface ScheduleRepositoryContract {
  createScheduledPost(command: ScheduleCommand): Promise<ScheduleResult>;
}

export interface ContentRepositoryContract {
  saveGeneratedContent(result: ContentGenerationResult): Promise<RepositoryWriteResult>;
}

export interface RecommendationRepositoryContract {
  saveSnapshot(recommendation: Recommendation): Promise<RepositoryWriteResult>;
}

export interface CommunityActionRepositoryContract {
  updateActionState(command: {
    actionId: string;
    organizationId: string;
    state: string;
    metadata?: Record<string, unknown>;
  }): Promise<RepositoryWriteResult>;
}
