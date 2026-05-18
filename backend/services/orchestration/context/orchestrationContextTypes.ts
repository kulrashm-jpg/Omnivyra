/**
 * Unified Orchestration Context — canonical contract (Phase-2 Step-6).
 *
 * ONE resolved context that execution generation (weekly/daily/AI/theme/
 * finalize) reads instead of fragmented raw sources. Read-only; loose nested
 * types by design (heterogeneous legacy sources must never throw).
 */

export interface UnifiedStrategyContext {
  strategy_id?: string;
  objective?: string;
  audiences?: unknown[];
  messaging?: unknown[];
  themes?: unknown[];
  pillars?: unknown[];
  owned_content?: unknown[];
}

export interface UnifiedSkeletonContext {
  weeks?: unknown[];
  frequency?: Record<string, unknown> | null;
  platforms?: unknown[];
  content_mix?: unknown;
  slot_distribution?: unknown;
}

export interface UnifiedExecutionContext {
  routing_defaults?: Record<string, unknown> | null;
  execution_preferences?: Record<string, unknown> | null;
  scheduling_preferences?: Record<string, unknown> | null;
  /** Reconciled canonical execution items (count + lightweight projection). */
  item_count?: number;
}

export interface UnifiedOwnedContentContext {
  reusable_assets?: unknown[];
  external_sources?: unknown[];
  upload_sources?: unknown[];
}

export interface UnifiedPlatformContext {
  enabled_platforms?: unknown[];
  platform_rules?: unknown[];
  publishing_constraints?: unknown[];
}

export interface UnifiedOrchestrationStateContext {
  readiness?: unknown;
  blockers?: string[];
  execution_summary?: unknown;
}

export interface UnifiedContextMetadata {
  resolution_source: string[];
  hydrated_from: string[];
  generated_at: string;
  strategy_presence: boolean;
  skeleton_presence: boolean;
  owned_content_count: number;
  /** 'strategy-first' | 'skeleton-first' | 'converged' | 'empty' */
  flow_shape: string;
}

export interface UnifiedCampaignOrchestrationContext {
  campaign_id: string;
  strategy_context: UnifiedStrategyContext;
  skeleton_context: UnifiedSkeletonContext;
  execution_context: UnifiedExecutionContext;
  owned_content_context: UnifiedOwnedContentContext;
  platform_context: UnifiedPlatformContext;
  orchestration_state: UnifiedOrchestrationStateContext;
  metadata: UnifiedContextMetadata;
}

export interface UnifiedCampaignReadiness {
  ready: boolean;
  readiness_score: number;
  components: {
    strategy: { score: number; blockers: string[] };
    execution: { score: number; blockers: string[] };
    scheduling: { score: number; blockers: string[] };
    owned_content: { score: number; blockers: string[] };
    platform: { score: number; blockers: string[] };
  };
  blocking_reasons: string[];
  generated_at: string;
}
