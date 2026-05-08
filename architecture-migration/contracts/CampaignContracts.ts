export type CampaignPlanningHorizon = {
  startDate: string;
  durationWeeks: number;
};

export type CampaignObjective = {
  name: string;
  audience?: string;
  businessGoal?: string;
  primaryCta?: string;
};

export type CampaignContentRequest = {
  platform: string;
  contentType: string;
  quantity: number;
};

export type CampaignPlanningInput = {
  organizationId: string;
  companyId: string;
  userId?: string;
  objective: CampaignObjective;
  horizon: CampaignPlanningHorizon;
  contentRequests: CampaignContentRequest[];
  constraints?: Record<string, unknown>;
};

export type CampaignDailyPlanItem = {
  id: string;
  weekNumber: number;
  dayIndex: number;
  platform: string;
  contentType: string;
  topic: string;
  title?: string;
  intent?: Record<string, unknown>;
};

export type CampaignWeeklyPlan = {
  weekNumber: number;
  objective: string;
  items: CampaignDailyPlanItem[];
};

export type CampaignPlan = {
  campaignId?: string;
  companyId: string;
  weeks: CampaignWeeklyPlan[];
  fingerprint: string;
};

export interface CampaignEngineContract {
  plan(input: CampaignPlanningInput): Promise<CampaignPlan>;
}
