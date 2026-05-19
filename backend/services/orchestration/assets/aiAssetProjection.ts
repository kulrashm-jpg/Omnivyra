/**
 * aiAssetProjection — Phase-2 Step-18 canonical AI-asset projection.
 *
 * HONEST CONTRACT: this records a concrete AI-asset *generation record*
 * (state + origin + lineage + provenance + override + fallback). A real
 * rendered `preview_url`/`thumbnail_url` is populated ONLY when an actual
 * persisted creator_asset exists on the row. When none exists the asset is
 * AI_GENERATED-intent with `preview_pending: true` (NOT a fabricated URL) —
 * pixel rendering requires the creator generation runtime, out of scope of
 * this additive orchestration step. Video/Group-B → unchanged passthrough.
 */

export type AIAssetState =
  | 'AI_READY'
  | 'AI_GENERATED'
  | 'USER_REPLACED'
  | 'USER_UPLOADED'
  | 'USER_REMOVED'
  | 'GENERATION_FAILED';

export type AIAssetOrigin = 'AI_GENERATED' | 'USER_UPLOADED' | 'HYBRID';

export interface AIAssetGeneratedPreview {
  asset_id?: string;
  preview_url?: string;
  thumbnail_url?: string;
  asset_family?: string;
  /** True when the asset is AI-generatable but no rendered media exists yet. */
  preview_pending?: boolean;
}

export interface AIAssetProjection {
  asset_state: AIAssetState;
  asset_origin: AIAssetOrigin;
  generated_preview?: AIAssetGeneratedPreview;
  upload_override_available: boolean;
  fallback_mode?: boolean;
  generation_metadata?: Record<string, unknown>;
}

export const AI_CREATABLE_FAMILIES = ['image', 'carousel', 'banner', 'infographic', 'pdf', 'slider'];

export function isAiCreatableRouting(routing: { execution_type?: string; workflow_type?: string } | null): boolean {
  return String(routing?.execution_type) === 'BOLT_CREATOR' && String(routing?.workflow_type) === 'AUTONOMOUS';
}
