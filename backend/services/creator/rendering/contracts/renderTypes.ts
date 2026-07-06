/**
 * Creator Rendering — Phase-2/6 render spec + projector contracts.
 * ──────────────────────────────────────────────────────────────────────────
 * R0 foundation only. PURE TYPES + the contract for the future
 * RenderRequestProjector. NO projector implementation, NO rendering.
 *
 * The RenderSpec is the IMMUTABLE, provider-agnostic, serialization-safe
 * unit of render intent. It is derived from a CreatorWorkspaceTask via a
 * render-safe ALLOWLIST projection (the inverse of the Step-7/8
 * scheduler FORBIDDEN-keys discipline): strategic / continuity /
 * scheduler / governance fields NEVER enter a RenderSpec. The spec
 * carries a `deterministic_input_hash` so an identical render intent is
 * idempotent (the render analogue of Step-12 deterministic
 * reconstruction — see deterministicHash.ts for the documented strategy).
 */

import type { CanonicalAssetFamily } from '../../intelligence/canonical';

export type RenderModality = 'image' | 'video';

/**
 * Render-safe projection of the blueprint/production context. ONLY
 * production-direction fields — no emotional_goal, no creative_objective,
 * no continuity, no scheduler_row. Mirrors the workspace
 * production_context but frozen + minimized for a provider.
 */
export interface RenderBlueprintProjection {
  asset_family: CanonicalAssetFamily;
  /** Storyboard the provider renders from (slides | scenes | frame). */
  storyboard: ReadonlyArray<Readonly<Record<string, unknown>>>;
  overlays: ReadonlyArray<string>;
  pacing_guidance: string;
  scene_direction: string;
  /** Visual prompt seed (image) — already strategy-stripped upstream. */
  visual_prompt: string;
  /** Optional style-reference image URL (curated template showcase). Present ONLY
   *  when CREATOR_IMAGE_REFERENCE_MODE='edit'; a reference-capable provider
   *  conditions on it (img2img). Absent by default → hash + output unchanged. */
  reference_image_url?: string | null;
}

/** Marketing copy that may be burned in / used as caption guidance.
 *  Constraint-shaped subset only; never the full packaging object. */
export interface RenderPackagingProjection {
  caption: string;
  overlay_text: ReadonlyArray<string>;
}

/** Per-platform render targeting (aspect/spec), platform key only. */
export interface RenderPlatformProjection {
  platform: string;
  aspect_ratio: string;
  resolution: { w: number; h: number };
}

/** Provider-agnostic knobs. Deterministic: a seed (not a clock/RNG). */
export interface RenderParameters {
  modality: RenderModality;
  /** Optional deterministic seed; omitted ⇒ provider default (still
   *  recorded on the attempt for reproducibility). */
  seed?: number;
  duration_sec?: number;          // video only
  quality_tier?: 'draft' | 'standard' | 'high';
  variant_count?: number;         // batch
}

/** Pre-render moderation INPUT context (the gate consumes this). */
export interface RenderModerationContext {
  canonical_asset_key: string;
  /** Text-like assets are policy-blocked from rendering (carried so the
   *  pre-render gate can fail closed without re-deriving governance). */
  is_text_like: boolean;
  /** The prompt/overlay surface the classifier inspects. */
  moderated_text: ReadonlyArray<string>;
}

/**
 * PHASE-2 canonical RenderSpec. IMMUTABLE (all readonly) +
 * serialization-safe (plain JSON-able) + provider-agnostic. The
 * `deterministic_input_hash` is computed over every field EXCEPT itself
 * and `spec_id` (see deterministicHash.ts).
 */
export interface RenderSpec {
  /** Stable identity = `render:${deterministic_input_hash}` (no UUID,
   *  no clock) so identical intent → identical spec_id (idempotent). */
  readonly spec_id: string;
  readonly canonical_asset_family: CanonicalAssetFamily;
  readonly render_modality: RenderModality;
  readonly blueprint_projection: Readonly<RenderBlueprintProjection>;
  readonly packaging_projection: Readonly<RenderPackagingProjection>;
  readonly platform_projection: Readonly<RenderPlatformProjection>;
  readonly rendering_parameters: Readonly<RenderParameters>;
  readonly moderation_context: Readonly<RenderModerationContext>;
  /** Order-independent, timestamp-free content hash (see strategy doc). */
  readonly deterministic_input_hash: string;
}

/** A produced, immutable, content-addressed output reference. */
export interface RenderOutputRef {
  output_id: string;
  /** Content address — dedupe + tamper-evidence (Step-14 Phase-8). */
  content_sha256: string;
  storage_ref: string;            // opaque; signed-URL resolved at read
  modality: RenderModality;
  mime_type: string;
  byte_size: number;
  /** Monotonic version; supersession via a NEW ref, never overwrite. */
  version: number;
  derived_from_output_id?: string | null;
}

export type RenderAttemptOutcome =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

/** Immutable record of ONE provider call (financial-evidential — joins
 *  to the credit ledger via billing_operation_id). */
export interface RenderAttemptResult {
  attempt_id: string;
  render_variant_id: string;
  provider: string;
  attempt_no: number;
  outcome: RenderAttemptOutcome;
  idempotency_key: string;
  billing_operation_id: string | null;
  output?: RenderOutputRef | null;
  error_code?: string | null;
  provider_metadata?: Readonly<Record<string, unknown>>;
}

/**
 * PHASE-6 RenderRequestProjector — CONTRACT ONLY (no implementation in
 * R0). The future pure implementation projects a CreatorWorkspaceTask
 * into a RenderSpec using the allowlist below, fail-closed if a
 * required render-safe field is missing or a forbidden field appears.
 */
export interface RenderRequestProjector {
  /**
   * Pure: identical task → byte-identical RenderSpec. MUST NOT read the
   * DB/clock/RNG and MUST NOT copy any non-allowlisted field.
   * `taskLike` is intentionally loose here (the concrete
   * CreatorWorkspaceTask import would couple R0 to the workspace layer;
   * the implementation in a later step narrows it).
   */
  project(taskLike: unknown, platform: string): RenderSpec;
}

/**
 * The render-safe ALLOWLIST. The projector copies ONLY these logical
 * fields; anything else (emotional_goal / creative_objective /
 * continuity_context / scheduler_row / planning_context / governance
 * ids) is structurally excluded — the inverse of the Step-7/8
 * FORBIDDEN_SCHEDULER_KEYS guard. Declared as data so the future
 * implementation + its tests derive the boundary from ONE place.
 */
export const RENDER_SAFE_FIELDS = Object.freeze([
  'asset_family',
  'storyboard',
  'overlays',
  'pacing_guidance',
  'scene_direction',
  'visual_prompt',
  'reference_image_url',
  'caption',
  'overlay_text',
  'platform',
  'aspect_ratio',
  'resolution',
] as const);

/** Fields that must NEVER appear in a RenderSpec (defense-in-depth;
 *  reuses the established scheduler/strategic forbidden set). */
export const RENDER_FORBIDDEN_FIELDS = Object.freeze([
  'scheduler_row',
  'emotional_goal',
  'creative_objective',
  'core_message',
  'continuity_context',
  'planning_context',
  'adaptation_context',
  'packaging_strategy',
  'workspace_meta',
] as const);
