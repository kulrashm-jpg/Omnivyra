import type { CampaignPlan, CampaignPlanningInput } from '../contracts/CampaignContracts';

export type StrategyCampaignAdapterConfig = {
  source: 'strategy';
  strategyProfile: string;
};

export interface StrategyCampaignAdapter {
  toCoreInput(config: StrategyCampaignAdapterConfig, input: Record<string, unknown>): CampaignPlanningInput;
  fromCorePlan(config: StrategyCampaignAdapterConfig, plan: CampaignPlan): Record<string, unknown>;
}
