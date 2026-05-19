/**
 * aiAssetGenerationFallback — Phase-2 Step-19.
 *
 * Pure. Translates a real generation outcome (runtime summary OR a thrown
 * error OR a per-row persisted state) into the Step-18
 * AiAssetDegradationSignals vocabulary so the hydrator/projector recompute
 * readiness and flip provenance to GENERATION_FAILED + upload-first WITHOUT
 * any new state machine. Video/manual never reach here (runtime skips them
 * internally — the bridge only ever asks for RENDER_ONLY of Group-A).
 */

import type { AiAssetDegradationSignals } from '../assets/aiAssetFallback';

export type RuntimeFinalStatus =
  | 'render_ready'
  | 'guidance_ready'
  | 'awaiting_media_upload'
  | 'partially_rendered'
  | 'partially_schedulable'
  | 'render_failed';

export interface GenerationOutcome {
  ok: boolean;
  final_status?: RuntimeFinalStatus | null;
  rendered_count?: number;
  failed_count?: number;
  error?: string | null;
}

/**
 * Campaign-level: when generation produced zero rendered assets and the
 * aggregate is a failure, every AI-creatable card degrades to upload-first.
 * A partial render is NOT a campaign-wide failure — per-row state
 * (resolveRowGenerationSignals) is authoritative for individual cards.
 */
export function mapOutcomeToSignals(o: GenerationOutcome): AiAssetDegradationSignals {
  if (!o.ok) return { generation_failed: true };
  if (o.final_status === 'render_failed' && (o.rendered_count ?? 0) === 0) {
    return { generation_failed: true };
  }
  return {};
}

/**
 * Per-row: read the state the REAL runtime persisted into
 * daily_content_plans.content (content_status / creator_lifecycle_state).
 * This is what makes a single failed card fall back without dragging the
 * rest of the campaign with it.
 */
export function resolveRowGenerationSignals(blob: Record<string, unknown>): AiAssetDegradationSignals {
  const status = String(blob.content_status ?? '').toLowerCase();
  const lifecycle = String(blob.creator_lifecycle_state ?? '').toLowerCase();
  if (status === 'render_failed' || lifecycle === 'render_failed') {
    return { generation_failed: true };
  }
  return {};
}

/**
 * Step-22: read the additive `ai_asset_override` block that the
 * ai-asset-mutation endpoint writes via the canonical orchestration write
 * layer (no DB migration — mirrors the creator_lifecycle content-blob
 * pattern). This is what makes Remove / Restore / Upload / Replace REAL:
 * the projection reflects the override deterministically on next hydrate.
 *
 *   state USER_REMOVED  → user_removed  (upload-first)
 *   state USER_UPLOADED → user_uploaded
 *   state USER_REPLACED → user_removed (replaced ⇒ AI no longer primary)
 *   absent / restored   → {} (AI projection resumes — restore = clear)
 */
export function resolveOverrideSignals(blob: Record<string, unknown>): AiAssetDegradationSignals {
  const o = blob.ai_asset_override;
  const ov = o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  const state = String(ov?.state ?? '').toUpperCase();
  if (state === 'USER_REMOVED') return { user_removed: true };
  if (state === 'USER_UPLOADED') return { user_uploaded: true };
  if (state === 'USER_REPLACED') return { user_removed: true };
  return {};
}
