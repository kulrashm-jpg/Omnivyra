/**
 * Orchestration State Synchronization — canonical projection types.
 * Phase-2 Step-4.
 *
 * ExecutionStateProjection is the ONE derived readiness/state shape that
 * planner, calendar, campaign overview and diagnostics read. It is computed
 * (never hand-set) by projectExecutionState() and persisted additively into
 * daily_content_plans.content.orchestration_state (no schema change).
 */

export type ContentState = 'EMPTY' | 'PARTIAL' | 'READY';
export type AssetState = 'NONE' | 'PENDING' | 'UPLOADED' | 'READY';
export type WorkflowState =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'READY_FOR_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'FAILED';
export type OrchestrationState = 'BLOCKED' | 'ACTIVE' | 'READY' | 'COMPLETE';
export type SchedulingState = 'UNSCHEDULED' | 'READY' | 'SCHEDULED' | 'FAILED';
export type PublishState = 'NOT_READY' | 'READY' | 'PUBLISHED' | 'FAILED';

export interface ExecutionStateDerivedFlags {
  has_copy: boolean;
  has_asset: boolean;
  has_schedule: boolean;
  requires_asset: boolean;
  requires_approval: boolean;
  is_creator_flow: boolean;
  is_video_flow: boolean;
}

export interface ExecutionStateProjection {
  execution_id: string;
  content_state: ContentState;
  asset_state: AssetState;
  workflow_state: WorkflowState;
  orchestration_state: OrchestrationState;
  scheduling_state: SchedulingState;
  publish_state: PublishState;
  readiness_score: number; // 0..100, deterministic
  blocking_reasons: string[];
  derived_flags: ExecutionStateDerivedFlags;
  updated_at: string;
}

/** Aggregated week/campaign rollups for the planner/calendar feed. */
export interface ExecutionStateRollup {
  total: number;
  ready: number;
  blocked: number;
  scheduled: number;
  published: number;
  failed: number;
  average_readiness: number;
  blocking_reasons: Record<string, number>;
}

export interface WeekExecutionState {
  week_number: number;
  week_id: string;
  rollup: ExecutionStateRollup;
  items: ExecutionStateProjection[];
}

export interface CampaignExecutionState {
  campaign_id: string;
  rollup: ExecutionStateRollup;
  weeks: WeekExecutionState[];
  resolved_at: string;
}
