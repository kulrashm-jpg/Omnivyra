export type ScheduleExecutionMode = 'text' | 'creator' | 'combined' | 'strategy';

export type ScheduleFingerprintInput = {
  organizationId: string;
  campaignId: string;
  contentBlockId: string;
  platform: string;
  scheduledAt: string;
  executionMode: ScheduleExecutionMode;
};

export type ScheduleCommand = ScheduleFingerprintInput & {
  userId: string;
  contentType: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type ScheduleResult = {
  scheduledPostId: string;
  fingerprint: string;
  deduped: boolean;
};

export interface ScheduleCommandServiceContract {
  schedule(command: ScheduleCommand): Promise<ScheduleResult>;
}
