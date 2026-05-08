export type QueuePayloadEnvelope<TPayload> = {
  jobId: string;
  organizationId: string;
  payloadVersion: string;
  idempotencyKey: string;
  payload: TPayload;
};

export type CampaignPlanningJobPayload = QueuePayloadEnvelope<{
  campaignId: string;
  companyId: string;
}>;

export type ContentGenerationJobPayload = QueuePayloadEnvelope<{
  campaignId?: string;
  contentBlockId: string;
  platform: string;
  contentType: string;
}>;

export type SchedulingJobPayload = QueuePayloadEnvelope<{
  campaignId: string;
  contentBlockId: string;
  platform: string;
  scheduledAt: string;
}>;

export type RecommendationJobPayload = QueuePayloadEnvelope<{
  companyId: string;
  signalIds: string[];
  engineVersion: string;
}>;
