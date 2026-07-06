/**
 * Creator Workspace — consumption contracts + domain separation.
 * ──────────────────────────────────────────────────────────────────────────
 * TYPES ONLY. No runtime, no DB, no scheduler, no rendering, no UI.
 *
 * Phase-1 domain separation (architecture, expressed as contracts):
 *
 *   TextActivityWorkspace            CreatorActivityWorkspace
 *   ───────────────────────          ─────────────────────────────
 *   domain: 'text'                   domain: 'creator'
 *   writer / repurposing flows       blueprint / production flows
 *   owns: drafts, variants,          owns: blueprint, storyboard,
 *     tone, repurpose angles           scene_sequence, overlays,
 *   persists: text content rows        production notes, creator assets
 *   orchestration: writer engine     orchestration: creator planning
 *
 * The two workspaces NEVER share mutable state. The ONLY object that
 * crosses from the Creator workspace toward persistence/scheduling is
 * the flat `CreatorSchedulerRow` (Step-6/7 contract) — never the rich
 * blueprint/strategic context. This module makes that boundary a typed
 * contract, not a convention.
 *
 * Runtime-inert: nothing in pages/ or backend/queue/ imports this. This
 * step is architecturally ADDITIVE — it changes no existing flow.
 */

import type {
  CreatorSchedulerRow,
  CreatorReuseClassification,
} from '../planning/creatorCardTypes';
import type {
  CreatorAssetFamily,
  CreatorContinuityContext,
  CreatorBrandGrounding,
} from '../types';
import type { ContentBlueprint } from '../blueprintTypes';

/** Hard domain marker. A workspace task is exactly one domain; the
 *  separation layer refuses to mix them (Phase-1 / Validation-8). */
export type CreatorWorkspaceDomain = 'creator' | 'text';

/**
 * Phase-5 human-production lifecycle. image/carousel are
 * scheduler-eligible immediately (constraint-valid row exists);
 * reel/video/short require an external human/agency production pass and
 * an uploaded asset before they become schedulable. NO rendering is
 * implied by any state — these are tracking states only.
 */
export type CreatorProductionStatus =
  | 'draft'
  | 'awaiting_human_production'
  | 'in_production'
  | 'asset_uploaded'
  | 'approval_ready'
  | 'ready_for_scheduling'
  | 'scheduled';

/** Strategic planning context (Week-Plan layer). Workspace-visible,
 *  NEVER scheduler-visible. */
export interface WorkspacePlanningContext {
  card_id: string;
  week_index: number;
  reuse_classification: CreatorReuseClassification;
  creative_objective: string;
  core_message: string;
  audience_intent: string;
  emotional_goal: { pain_point: string; outcome_promise: string; tone: string };
  continuity_context: CreatorContinuityContext;
  brand_grounding: CreatorBrandGrounding;
}

/**
 * Rich production context the editor/creator works from. The shape is
 * asset-family discriminated but kept open so a future render pipeline
 * can read it unchanged (Phase-7). NONE of this reaches the scheduler.
 */
export interface WorkspaceProductionContext {
  asset_family: CreatorAssetFamily | null;
  /** The full adapter blueprint when one was produced (flag-gated
   *  upstream); null when only card-derived guidance exists. */
  blueprint: ContentBlueprint | null;
  /** Storyboard / scene guidance (reel: scene_sequence; carousel:
   *  slides; image: a single visual_descriptor frame). */
  storyboard: unknown[];
  overlays: string[];
  pacing_guidance: string;
  scene_direction: string;
  production_notes: string[];
  creator_notes: string[];
  /** Optional img2img style-reference image URL (curated template showcase).
   *  Populated only when CREATOR_IMAGE_REFERENCE_MODE='edit'; threaded to the
   *  RenderSpec's blueprint_projection so a reference-capable provider can use it. */
  reference_image_url?: string | null;
}

/** Per-platform delivery context (Phase-6 variant editing). */
export interface WorkspacePlatformContext {
  platform: string;
  adaptation_note: string;
  platform_strategy: string;
  hook_angle: string;
  pacing: string;
}

/** Marketing packaging the workspace can edit before it is projected
 *  back into a scheduler row. */
export interface WorkspacePackagingContext {
  caption: string;
  hashtags: string[];
  keywords: string[];
  meta_description: string;
  cta: string;
  [extra: string]: unknown;
}

/** Shared-vs-unique adaptation context (Phase-6). */
export interface WorkspaceAdaptationContext {
  classification: CreatorReuseClassification;
  /** True when this task is one variant of a shared creative core. */
  is_shared_core_variant: boolean;
  /** blueprint_id of the shared core (identical across variants of a
   *  shared/hybrid card); null for platform-native. */
  shared_core_id: string | null;
  /** Editable per-platform override layer (hybrid model). */
  override_layer: Record<string, unknown>;
}

/**
 * Phase-7 future-rendering attach point. Declared NOW so an AI render
 * pipeline / video synthesis / asset queue can bind later WITHOUT a
 * contract redesign. Intentionally inert: `render_ready` is always
 * false and there is no render logic anywhere.
 */
export interface WorkspaceRenderEnvelope {
  render_ready: false;
  render_target: null;
  /** A future queue keys off these without needing the rich context. */
  attach_ref: { task_id: string; blueprint_id: string | null };
}

/**
 * Step-9 Phase-4 lightweight workspace versioning. NOT a full audit
 * system — just enough to make round-trip edits traceable and
 * deterministic. `updated_at` / `last_editor` / `change_source` are
 * caller-supplied (the pure layer has no clock); `uploaded_asset_ref`
 * carries an EXTERNAL human-production asset reference WITHOUT changing
 * any scheduler contract (Phase-5).
 */
export interface CreatorWorkspaceMeta {
  workspace_revision: number;
  updated_at: string;
  last_editor: string;
  change_source: string;
  /** External uploaded asset URL/ref for human-production formats.
   *  Never enters the scheduler row — lifecycle metadata only. */
  uploaded_asset_ref: string | null;
  /** Step-12 Phase-4 override provenance. Records, per packaging/
   *  production field, that this variant has a PLATFORM-SPECIFIC
   *  override which shared-core synchronization must NOT clobber.
   *  Survives reload + persistence (carried in creator_workspace_meta).
   *  Optional ⇒ Step-9/10/11 paths unchanged (purely additive). */
  override_provenance?: Record<
    string,
    { by: string; at: string; source: string }
  >;
  /** Step-12 Phase-3: the shared_core revision this variant was last
   *  synchronized from (collaboration lineage). null = never synced. */
  synced_from_core_revision?: number | null;
}

/**
 * PHASE-2 canonical Creator workspace task. What a future Creator-native
 * workspace consumes. Carries rich context for the editor AND a frozen,
 * scheduler-safe projection — the two are deliberately separated so the
 * Phase-3/4 boundary cannot be violated downstream.
 */
export interface CreatorWorkspaceTask {
  domain: 'creator';
  task_id: string;
  blueprint_id: string | null;
  asset_family: CreatorAssetFamily | null;

  planning_context: WorkspacePlanningContext;
  production_context: WorkspaceProductionContext;
  platform_context: WorkspacePlatformContext;
  packaging_context: WorkspacePackagingContext;
  adaptation_context: WorkspaceAdaptationContext;

  production_status: CreatorProductionStatus;
  requires_human_production: boolean;
  scheduler_eligible: boolean;

  /** Phase-3/4 isolation: the ONLY thing that may cross to the
   *  scheduler. Frozen copy — editing the workspace contexts above does
   *  not mutate this until an explicit re-projection step. */
  scheduler_row: CreatorSchedulerRow;

  render_envelope: WorkspaceRenderEnvelope;

  /** Step-9: present once a task has been reconstructed from / persisted
   *  to a row. Optional so the Step-8 in-memory construction path is
   *  unchanged (purely additive). */
  workspace_meta?: CreatorWorkspaceMeta;
}

/**
 * Phase-6 bundle: a shared creative core fanned out into editable
 * per-platform variants. For platform-native content `shared_core` is
 * null and every variant is independent.
 */
export interface CreatorWorkspaceBundle {
  card_id: string;
  week_index: number;
  classification: CreatorReuseClassification;
  /** Present for shared_content / hybrid_content; null for
   *  platform_native_content. */
  shared_core: CreatorWorkspaceTask | null;
  variants: CreatorWorkspaceTask[];
  /** Step-12 Phase-1: which packaging/production fields are
   *  platform-overridden, keyed by platform. Drives override
   *  indicators + synchronization exclusion. */
  override_layers?: Record<string, string[]>;
  /** Step-12 Phase-1: bundle synchronization state. `in_sync` is true
   *  when every non-overridden variant matches the shared core's
   *  synced revision. */
  synchronization?: {
    core_revision: number;
    variant_revisions: Record<string, number>;
    in_sync: boolean;
  };
}

/** Step-12 Phase-5 conflict surface — returned instead of throwing so
 *  the UI can present a merge/conflict affordance. */
export interface CreatorWorkspaceConflict {
  conflict: true;
  task_id: string;
  platform: string;
  expected_revision: number;
  current_revision: number;
  last_editor: string;
}
