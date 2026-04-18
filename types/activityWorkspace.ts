// Shared types for the Activity Workspace domain

export type ScheduleItem = {
  id: string;
  platform: string;
  contentType: string;
  date?: string;
  time?: string;
  status?: string;
  description?: string;
  title?: string;
  /** Execution ID — may differ from primary when cross-week platforms are included */
  executionId?: string;
  /** Week number this schedule belongs to */
  weekNumber?: number;
  /** Whether this is the primary (current) execution */
  isPrimary?: boolean;
  /** Scheduled datetime from scheduled_posts */
  scheduledFor?: string | null;
  /** 1-based index in the distribution list for this topic */
  sequence_index?: number;
  /** Total number of distributions for this topic */
  total_distributions?: number;
};
