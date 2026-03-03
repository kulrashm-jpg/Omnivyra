/**
 * Activity Side Panel — shared types.
 * No migration required. Activity may extend with approval_status, approved_by, approved_at.
 * Message model: activity_id, user_id, sender_role, message_type, message_text, action_metadata?, created_at.
 */

export const ACTIVITY_STAGES = [
  'PLAN',
  'CREATE',
  'REPURPOSE',
  'SCHEDULE',
  'SHARE',
] as const;

export type ActivityStage = (typeof ACTIVITY_STAGES)[number];

export const STAGE_COLORS: Record<ActivityStage, string> = {
  PLAN: 'blue',
  CREATE: 'purple',
  REPURPOSE: 'orange',
  SCHEDULE: 'teal',
  SHARE: 'green',
};

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'request_changes';

export type Activity = {
  id: string;
  title: string;
  content_type: string;
  stage: ActivityStage;
  approval_status: ApprovalStatus;
  owner_id?: string;
  owner_name?: string;
  /** Execution context: platforms, due dates, metadata */
  platforms?: string[];
  due_date?: string;
  due_time?: string;
  metadata?: Record<string, unknown>;
  approved_by?: string;
  approved_at?: string;
  /** Optional link to existing execution/workspace payload */
  execution_id?: string;
  campaign_id?: string;
  week_number?: number;
  day?: string;
  /** When set, ownership border accent is applied (additive over stage colors). */
  execution_mode?: string;
  /** Creator brief for one-line preview (optional). */
  creator_instruction?: Record<string, unknown>;
};

export const MESSAGE_TYPES = [
  'COMMENT',
  'UPDATE',
  'APPROVAL',
  'REJECTION',
  'REQUEST_CHANGES',
  'SYSTEM',
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export type SenderRole = 'COMPANY_ADMIN' | 'CAMPAIGN_CONTENT_MANAGER' | 'CONTENT_CREATOR' | 'SYSTEM' | 'AI';

export type ActivityMessage = {
  id: string;
  activity_id: string;
  user_id: string;
  sender_name: string;
  sender_role: SenderRole;
  message_type: MessageType;
  message_text: string;
  action_metadata?: Record<string, unknown>;
  created_at: string;
};

/** Tailwind accent classes for message borders/backgrounds by sender role */
export const ROLE_ACCENT_CLASSES: Record<SenderRole, string> = {
  COMPANY_ADMIN: 'bg-blue-50 border-blue-200 text-blue-900',
  CAMPAIGN_CONTENT_MANAGER: 'bg-purple-50 border-purple-200 text-purple-900',
  CONTENT_CREATOR: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  SYSTEM: 'bg-gray-100 border-gray-200 text-gray-700',
  AI: 'bg-gray-100 border-gray-200 text-gray-700',
};
