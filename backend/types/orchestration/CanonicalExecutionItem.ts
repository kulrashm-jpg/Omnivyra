/**
 * CanonicalExecutionItem — the single normalized orchestration object.
 *
 * Phase-2 Step-1 (canonical execution model unification). This is the ONE
 * shape that planner, weekly/daily cards, activity workspace, scheduler,
 * publishing, creator + BOLT-text workflows all read through (via
 * backend/services/orchestration/canonicalExecutionAdapter).
 *
 * It is a READ contract first: it is reconciled from the two legacy
 * persistence targets (campaign_week_plan.blueprint execution items and
 * daily_content_plans rows). Nothing here removes or rewrites those tables.
 *
 * Flexible nested payloads are intentionally typed loosely (Record/unknown)
 * so this contract does not couple to any one subsystem's internal shape.
 */

export type CanonicalExecutionType = 'text' | 'creator' | 'hybrid' | 'unknown';

/** Build/handoff bucket (mirrors lib/shared/contentTypeClassification). */
export type CanonicalWorkflowType =
  | 'bolt_text'
  | 'creator_autonomous'
  | 'video_brief'
  | 'unsupported';

export type CanonicalActivityType = 'post' | 'asset' | 'post_with_asset' | 'brief';

export type CanonicalSourceType =
  | 'planner'
  | 'recommendation'
  | 'board'
  | 'manual'
  | 'ai'
  | 'unknown';

export type CanonicalStatus =
  | 'planned'
  | 'generating'
  | 'ready'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'unknown';

export type CanonicalApprovalStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'reapproval_required';

export type CanonicalSchedulingStatus =
  | 'unscheduled'
  | 'schedulable'
  | 'scheduled'
  | 'blocked'
  | 'published';

/** Which legacy source(s) the canonical item was reconciled from. */
export type CanonicalResolutionStrategy =
  | 'row_enriched'      // daily_content_plans row (preferred)
  | 'row_only'          // row present but not enriched
  | 'blueprint'         // blueprint execution_items / daily_execution_items
  | 'blueprint_fallback'
  | 'reconciled'        // both row + blueprint merged
  | 'not_found';

export interface CanonicalSourceReference {
  /** Stable composite the workspace deep-link uses. */
  campaign_id: string;
  execution_id: string;
  /** Blueprint locus (when sourced/confirmed from blueprint). */
  blueprint_week_index?: number | null;
  /** daily_content_plans.id (when a row exists). */
  daily_content_plan_id?: string | null;
  /** scheduled_posts.id back-reference (when scheduled). */
  scheduled_post_id?: string | null;
}

export interface CanonicalAssetRequirements {
  /** True for Group-B (video/reel/short): user must produce & upload. */
  media_upload_required: boolean;
  /** True for Group-A (image/carousel/...): Omnivyra renders it. */
  autonomous_renderable: boolean;
  canonical_asset_family: string | null;
}

export interface CanonicalExecutionItem {
  // Identity / locus
  execution_id: string;
  campaign_id: string;
  week_id: string;            // e.g. "wk{n}"
  day_id: string;             // day name or YYYY-MM-DD
  platform: string;
  /** platform + content_type (+ repurpose) — unique per scheduled variant. */
  platform_variant_key: string;
  content_type: string;

  // Classification
  execution_type: CanonicalExecutionType;
  activity_type: CanonicalActivityType;
  source_type: CanonicalSourceType;
  workflow_type: CanonicalWorkflowType;

  // Brief / strategy surface
  title: string;
  objective: string;
  theme: string;
  intent: Record<string, unknown> | null;

  // Lifecycle
  status: CanonicalStatus;
  approval_status: CanonicalApprovalStatus;
  scheduling_status: CanonicalSchedulingStatus;
  creator_lifecycle_state: string | null;
  publish_readiness: 'ready' | 'blocked' | 'unknown';
  scheduled_at: string | null;

  // Content / asset payloads (loose by design)
  asset_requirements: CanonicalAssetRequirements;
  asset_payload: Record<string, unknown> | null;
  writer_content_brief: Record<string, unknown> | null;
  creator_workspace: Record<string, unknown> | null;

  // Strategy ↔ execution linkage (Phase-2 Step-5; additive, optional —
  // read-derived via the strategy execution-context feed for now).
  strategy_link?: import('../strategy/CampaignStrategy').ExecutionStrategyLink | null;

  // Provenance / observability
  source_reference: CanonicalSourceReference;
  resolution_strategy: CanonicalResolutionStrategy;
  metadata: Record<string, unknown>;

  created_at: string | null;
  updated_at: string | null;
}
