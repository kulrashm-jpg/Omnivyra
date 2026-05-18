/**
 * Execution Routing — canonical contract (Phase-2 Step-2).
 *
 * ONE deterministic decision shape. Every NEW routing decision (text vs
 * creator vs video, asset expectation, scheduling/publish readiness) must be
 * produced by resolveExecutionRouting() and consumed — never re-derived
 * independently.
 */

export type ExecutionType =
  | 'BOLT_TEXT'
  | 'BOLT_CREATOR'
  | 'VIDEO_WORKFLOW'
  | 'MANUAL'
  | 'HYBRID';

export type RoutingActivityType =
  | 'TEXT_ONLY'
  | 'ASSET_ONLY'
  | 'TEXT_PLUS_ASSET'
  | 'EMBEDDED_TEXT_ASSET'
  | 'OWNED_CONTENT';

export type RoutingWorkflowType =
  | 'AUTONOMOUS'
  | 'ASSISTED'
  | 'MANUAL_UPLOAD'
  | 'EXTERNAL_REFERENCE';

export type AssetRequirement = 'NONE' | 'OPTIONAL' | 'REQUIRED';

export type SchedulingReadiness =
  | 'READY'
  | 'PENDING_ASSET'
  | 'PENDING_APPROVAL'
  | 'BLOCKED';

export type PublishReadiness =
  | 'READY'
  | 'MISSING_ASSET'
  | 'MISSING_COPY'
  | 'PENDING_APPROVAL'
  | 'INVALID_CONFIGURATION';

export interface ExecutionRoutingInput {
  platform?: string | null;
  content_type?: string | null;
  asset_type?: string | null;
  source_type?: string | null;
  creator_packaging?: Record<string, unknown> | null;
  has_external_content?: boolean;
  has_uploaded_asset?: boolean;
  has_text?: boolean;
  requires_video?: boolean;
  /** Loose; e.g. { approval_status, campaign_id, execution_id }. */
  campaign_context?: Record<string, unknown> | null;
}

export interface ExecutionRoutingDecision {
  execution_type: ExecutionType;
  activity_type: RoutingActivityType;
  workflow_type: RoutingWorkflowType;
  asset_requirement: AssetRequirement;
  creator_requirement: boolean;
  scheduling_readiness: SchedulingReadiness;
  publish_readiness: PublishReadiness;
  routing_source: string;
  reasoning: string[];
  diagnostics: Record<string, unknown>;
}
