import type { CampaignPlan, CampaignPlanningInput } from '../contracts/CampaignContracts';

export type BoltCampaignAdapterConfig = {
  source: 'bolt';
  executionProfile: string;
};

export interface BoltCampaignAdapter {
  toCoreInput(config: BoltCampaignAdapterConfig, input: Record<string, unknown>): CampaignPlanningInput;
  fromCorePlan(config: BoltCampaignAdapterConfig, plan: CampaignPlan): Record<string, unknown>;
}
