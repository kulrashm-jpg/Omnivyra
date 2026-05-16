export const REPLAY_TARGET_KINDS = [
  'projection',
  'execution_failure',
  'moderation_block',
  'alert',
] as const;
export type ReplayTargetKind = (typeof REPLAY_TARGET_KINDS)[number];

export const REPLAY_STATUSES = [
  'requested',
  'previewed',
  'approved',
  'executing',
  'complete',
  'failed',
  'cancelled',
] as const;
export type ReplayStatus = (typeof REPLAY_STATUSES)[number];

export const REPLAY_MAX_BATCH_SIZE = 100 as const;

export type ReplayOperation = {
  id: string;
  organization_id: string;
  target_kind: ReplayTargetKind;
  status: ReplayStatus;
  requested_items: string[];
  batch_size: number;
  preview_summary: Record<string, unknown> | null;
  result_summary: Record<string, unknown> | null;
  approved_at: string | null;
  approved_by: string | null;
  executed_at: string | null;
  executed_by: string | null;
  failure_reason: string | null;
  requested_by: string | null;
  created_at: string;
};
