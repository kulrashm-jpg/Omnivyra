/**
 * GenerationExecutionContext — the authoritative composed generation input.
 * Phase-2 Step-8.
 *
 * Composes (does not re-derive): unified orchestration context (Step-6) +
 * routing engine (Step-2) + readiness (Step-4/6) + canonical strategy
 * (Step-5). This is the ONE object generation should read; legacy inline
 * derivations remain as the execution fallback (compatibility-first).
 */

import type {
  UnifiedCampaignOrchestrationContext,
  UnifiedCampaignReadiness,
} from '../context/orchestrationContextTypes';
import type { ExecutionRoutingDecision } from '../routing/executionRoutingTypes';

export type GenerationMode =
  | 'STRATEGY_FIRST'
  | 'SKELETON_FIRST'
  | 'CONVERGED'
  | 'EMPTY';

export interface GenerationRouteEntry {
  execution_id: string | null;
  platform: string;
  content_type: string;
  week_id: string;
  routing: ExecutionRoutingDecision;
}

export type OwnedContentDirectiveKind =
  | 'derive_posts_from_blog'
  | 'derive_snippets_from_document'
  | 'video_placeholder_workflow'
  | 'distribution_from_asset'
  | 'prioritize_reuse';

export interface OwnedContentDirective {
  source_id: string;
  source_type: string;
  directive: OwnedContentDirectiveKind;
  reusable: boolean;
}

export type ReadinessDirective =
  | 'minimal_skeleton_safe'      // missing strategy
  | 'pending_upload_workflow'    // missing required assets
  | 'approval_gated'             // missing approval
  | 'restrict_scope'             // no platform config
  | 'prioritize_reuse'           // owned content present
  | 'proceed';                   // ready

export interface GenerationExecutionContext {
  campaign_id: string;
  generation_mode: GenerationMode;
  /** Authoritative resolved inputs (do not re-parse raw sources). */
  unified: UnifiedCampaignOrchestrationContext;
  readiness: UnifiedCampaignReadiness;
  /** Per-slot centralized routing decisions (no inline creator/text/video branching). */
  routes: GenerationRouteEntry[];
  owned_content_directives: OwnedContentDirective[];
  readiness_directives: ReadinessDirective[];
  fallbacks: string[];
  metadata: {
    entrypoint: string;
    resolution_sources: string[];
    flow_shape: string;
    route_count: number;
    owned_content_count: number;
    generated_at: string;
  };
}
