import type { CampaignPlan, CampaignPlanningInput } from '../contracts/CampaignContracts';

export type CreatorCampaignAdapterConfig = {
  source: 'creator';
  assetProfile: string;
};

export interface CreatorCampaignAdapter {
  toCoreInput(config: CreatorCampaignAdapterConfig, input: Record<string, unknown>): CampaignPlanningInput;
  fromCorePlan(config: CreatorCampaignAdapterConfig, plan: CampaignPlan): Record<string, unknown>;
}
