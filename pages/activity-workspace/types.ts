export type ScheduleItem = {
  id: string;
  platform: string;
  contentType: string;
  date?: string;
  time?: string;
  status?: string;
  description?: string;
  title?: string;
  executionId?: string;
  weekNumber?: number;
  isPrimary?: boolean;
  scheduledFor?: string | null;
  sequence_index?: number;
  total_distributions?: number;
};

export type MasterContentDocumentPayload = {
  master_title: string;
  source_execution_id: string;
  platforms: string[];
  platform_variants: Record<string, { execution_id: string; status: 'PENDING' | 'GENERATED'; content?: string }>;
};

export type WorkspacePayloadWeekLike = {
  planning_adjustments_summary?: unknown;
  momentum_adjustments?: {
    momentum_transfer_strength?: string;
    narrative_recovery?: boolean;
    absorbed_from_week?: unknown;
    [key: string]: unknown;
  } | null;
  distribution_strategy?: string | null;
  week_extras?: { recovered_topics?: unknown[] } | null;
};

export type WorkspacePayload = WorkspacePayloadWeekLike & {
  campaignId?: string | null;
  companyId?: string | null;
  weekNumber?: number;
  day?: string;
  activityId?: string;
  title?: string;
  topic?: string;
  description?: string;
  dailyExecutionItem?: Record<string, unknown> | null;
  source?: 'daily' | 'weekly';
  schedules?: ScheduleItem[];
  repurposing_context?: unknown;
  master_content_document?: MasterContentDocumentPayload | null;
};

export type RefineChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ActivityTabKey = 'content' | 'community_responses' | 'discussion';

export type CommunitySignal = {
  id: string;
  author?: string | null;
  content?: string | null;
  platform: string;
  signal_type: string;
  engagement_score: number;
  detected_at: string;
  conversation_url?: string | null;
};

export type WorkspaceNotice = {
  type: 'success' | 'error' | 'info';
  message: string;
} | null;
