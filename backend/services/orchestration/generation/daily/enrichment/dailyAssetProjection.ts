/**
 * dailyAssetProjection — Phase-2 Step-17. AI-asset-ready semantics.
 *
 * AI-creatable (Group-A autonomous) assets initialize AI_READY with an
 * AI_GENERATED origin and an upload-override available. Video / Group-B
 * (media_upload_required) stays upload-first / PENDING_UPLOAD — UNCHANGED.
 * Pure, no I/O. Routing decision (centralized) is consumed, not re-derived.
 */

export type DailyAssetState = 'NONE' | 'AI_READY' | 'PENDING_UPLOAD' | 'UPLOADED';
export type DailyAssetOrigin = 'AI_GENERATED' | 'USER_UPLOAD' | null;

export interface DailyAssetProjection {
  ai_creatable: boolean;
  asset_state: DailyAssetState;
  asset_origin: DailyAssetOrigin;
  upload_override_available: boolean;
  /** True only when generation failed / user removed / workflow switched. */
  upload_required: boolean;
}

export function projectDailyAsset(
  routing: { execution_type?: string; workflow_type?: string; asset_requirement?: string } | null,
  opts: { has_uploaded_asset?: boolean; generation_failed?: boolean; user_removed?: boolean; workflow_switched?: boolean } = {},
): DailyAssetProjection {
  const exec = String(routing?.execution_type ?? '');
  const wf = String(routing?.workflow_type ?? '');
  const requiresAsset = routing?.asset_requirement === 'REQUIRED';

  // Text → no asset.
  if (!requiresAsset && exec !== 'VIDEO_WORKFLOW') {
    return { ai_creatable: false, asset_state: 'NONE', asset_origin: null, upload_override_available: false, upload_required: false };
  }

  const isVideoOrManual = exec === 'VIDEO_WORKFLOW' || wf === 'MANUAL_UPLOAD';
  const aiCreatable = exec === 'BOLT_CREATOR' && wf === 'AUTONOMOUS';

  if (opts.has_uploaded_asset) {
    return { ai_creatable: aiCreatable, asset_state: 'UPLOADED', asset_origin: 'USER_UPLOAD', upload_override_available: true, upload_required: false };
  }

  // Video / manual → upload-first, unchanged.
  if (isVideoOrManual && !aiCreatable) {
    return { ai_creatable: false, asset_state: 'PENDING_UPLOAD', asset_origin: null, upload_override_available: false, upload_required: true };
  }

  // AI-creatable Group-A → AI_READY unless explicitly degraded.
  if (aiCreatable) {
    const degraded = opts.generation_failed === true || opts.user_removed === true || opts.workflow_switched === true;
    return degraded
      ? { ai_creatable: true, asset_state: 'PENDING_UPLOAD', asset_origin: null, upload_override_available: true, upload_required: true }
      : { ai_creatable: true, asset_state: 'AI_READY', asset_origin: 'AI_GENERATED', upload_override_available: true, upload_required: false };
  }

  // Fallback: asset required but not classified autonomous → upload-first.
  return { ai_creatable: false, asset_state: 'PENDING_UPLOAD', asset_origin: null, upload_override_available: false, upload_required: true };
}
