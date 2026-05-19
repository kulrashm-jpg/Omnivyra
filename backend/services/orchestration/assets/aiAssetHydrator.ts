/**
 * aiAssetHydrator — Phase-2 Step-18 orchestrator.
 *
 * Turns AI-creatable activities from a semantic AI_READY flag into a
 * concrete AI_GENERATED record with lineage + provenance + override +
 * fallback. Real preview/thumbnail URLs come ONLY from an actually
 * persisted creator_asset on the row; otherwise preview_pending:true (no
 * fabricated media). Returns null for non-AI-creatable (video/manual/text)
 * so the existing workflow is preserved EXACTLY (video exception).
 */

import {
  isAiCreatableRouting,
  type AIAssetProjection,
} from './aiAssetProjection';
import { evaluateAiAssetFallback, type AiAssetDegradationSignals } from './aiAssetFallback';
import { aiAssetDiagnostics } from './aiAssetDiagnostics';
// Step-19: resolve REAL persisted runtime media + per-row failure signals.
import {
  resolveRenderedMedia,
  resolveRowGenerationSignals,
  resolveOverrideSignals,
} from '../asset-generation';

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function hydrateAiAsset(input: {
  campaignId: string;
  executionId: string;
  contentType: string;
  routing: { execution_type?: string; workflow_type?: string; asset_requirement?: string } | null;
  blob: Record<string, unknown>;
  signals?: AiAssetDegradationSignals;
}): AIAssetProjection | null {
  const { campaignId, executionId, contentType, routing, blob } = input;
  if (!isAiCreatableRouting(routing)) return null; // video / manual / text — untouched

  // Step-19/22: merge persisted runtime failure state (render_failed) +
  // Step-22 user override (remove/restore/upload/replace) with any explicit
  // caller signals; explicit caller signals win on conflict.
  const override = obj(blob.ai_asset_override);
  const overrideState = str(override?.state).toUpperCase();
  const signals: AiAssetDegradationSignals = {
    ...resolveRowGenerationSignals(blob),
    ...resolveOverrideSignals(blob),
    ...(input.signals ?? {}),
  };
  const assetFamily =
    /carousel|slide/.test(contentType) ? 'carousel'
    : /banner/.test(contentType) ? 'banner'
    : /infographic/.test(contentType) ? 'infographic'
    : /pdf/.test(contentType) ? 'pdf'
    : 'image';
  const assetId = `aiasset-${campaignId}-${executionId}`;

  // Lineage / provenance continuity (do not fabricate — read what exists).
  const provenance = obj(blob.provenance);
  const creatorMeta = obj(blob.creator_projection) ?? obj(blob.creator_metadata);
  const generation_metadata = {
    prompt_seed: str(blob.title || blob.objective),
    asset_family: assetFamily,
    routing_lineage: {
      execution_type: routing?.execution_type ?? null,
      workflow_type: routing?.workflow_type ?? null,
    },
    orchestration_lineage: provenance
      ? {
          generation_source: provenance.generation_source ?? null,
          generation_mode: provenance.generation_mode ?? null,
          originating_strategy_id: (obj(provenance.lineage)?.originating_strategy_id) ?? null,
          originating_week_id: (obj(provenance.lineage)?.originating_week_id) ?? null,
        }
      : null,
    creator_guidance: creatorMeta?.creator_guidance ?? null,
  };

  // 0. Step-22 user override wins over generation (deterministic, lineage-
  //    preserving). `prior` carries the AI lineage so Restore is lossless.
  const hasPrior = override != null && override.prior != null;
  if (overrideState === 'USER_REMOVED') {
    const projection: AIAssetProjection = {
      asset_state: 'USER_REMOVED',
      asset_origin: 'HYBRID',
      upload_override_available: true,
      fallback_mode: true,
      generation_metadata: { ...generation_metadata, override_state: 'USER_REMOVED', ai_lineage_preserved: hasPrior },
    };
    aiAssetDiagnostics.replaced({ campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily, asset_origin: 'HYBRID', fallback_mode: true, generation_state: 'USER_REMOVED' });
    return projection;
  }
  if (overrideState === 'USER_UPLOADED' || overrideState === 'USER_REPLACED') {
    const url = str(override?.url) || (Array.isArray(override?.files) ? str((override!.files as unknown[])[0]) : '');
    const projection: AIAssetProjection = {
      asset_state: overrideState as 'USER_UPLOADED' | 'USER_REPLACED',
      asset_origin: 'USER_UPLOADED',
      generated_preview: url
        ? { asset_id: str(override?.asset_id) || assetId, preview_url: url, thumbnail_url: str(override?.thumbnail) || undefined, asset_family: assetFamily, preview_pending: false }
        : { asset_id: assetId, asset_family: assetFamily, preview_pending: false },
      upload_override_available: true,
      fallback_mode: false,
      generation_metadata: { ...generation_metadata, override_state: overrideState, ai_lineage_preserved: hasPrior },
    };
    aiAssetDiagnostics.hydrated({ campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily, asset_origin: 'USER_UPLOADED', preview_available: Boolean(url), generation_state: overrideState, fallback_mode: false });
    return projection;
  }
  // overrideState absent / 'RESTORED' → fall through: AI projection resumes
  // (Restore = clear the override; lineage continuity intact).

  // 1. Real persisted runtime media wins (Step-19): rendered_asset (the
  //    autonomous renderer write) → asset_payload.media_bundle → explicit
  //    creator_asset attachment. This is the change that flips
  //    preview_pending → a REAL preview once the generation runtime has run.
  const media = resolveRenderedMedia(blob);
  if (media) {
    const ca = obj(blob.creator_asset);
    const userTouched = signals.user_uploaded || signals.user_removed;
    const isUserAsset =
      userTouched || (media.source === 'creator_asset' && str(ca?.origin) === 'USER_UPLOADED');
    const projection: AIAssetProjection = {
      asset_state: isUserAsset ? 'USER_UPLOADED' : 'AI_GENERATED',
      asset_origin: isUserAsset ? 'USER_UPLOADED' : 'AI_GENERATED',
      generated_preview: {
        asset_id: media.asset_id || assetId,
        preview_url: media.preview_url || undefined,
        thumbnail_url: media.thumbnail_url || undefined,
        asset_family: assetFamily,
        preview_pending: false,
      },
      upload_override_available: true,
      fallback_mode: false,
      generation_metadata: { ...generation_metadata, media_source: media.source },
    };
    aiAssetDiagnostics.hydrated({ campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily, asset_origin: projection.asset_origin, preview_available: true, generation_state: projection.asset_state, fallback_mode: false });
    aiAssetDiagnostics.preview({ campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily, preview_available: true });
    return projection;
  }

  // 2. Real degradation → upload fallback.
  const fb = evaluateAiAssetFallback(signals);
  if (fb.fallback_mode) {
    const failed = signals.generation_failed === true;
    const projection: AIAssetProjection = {
      asset_state: failed ? 'GENERATION_FAILED' : signals.user_uploaded ? 'USER_UPLOADED' : signals.user_removed ? 'USER_REMOVED' : 'GENERATION_FAILED',
      asset_origin: signals.user_uploaded ? 'USER_UPLOADED' : 'HYBRID',
      upload_override_available: true,
      fallback_mode: true,
      generation_metadata: { ...generation_metadata, fallback_reason: fb.reason },
    };
    (failed
      ? aiAssetDiagnostics.generationFailed
      : signals.user_uploaded || signals.user_removed
        ? aiAssetDiagnostics.replaced
        : aiAssetDiagnostics.uploadFallback)({
      campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily,
      asset_origin: projection.asset_origin, fallback_mode: true, generation_state: projection.asset_state,
    });
    return projection;
  }

  // 3. Generatable, no rendered media yet → concrete AI_GENERATED record
  //    (preview_pending) — NOT a fabricated URL, NOT semantic-only.
  const projection: AIAssetProjection = {
    asset_state: 'AI_GENERATED',
    asset_origin: 'AI_GENERATED',
    generated_preview: { asset_id: assetId, asset_family: assetFamily, preview_pending: true },
    upload_override_available: true,
    fallback_mode: false,
    generation_metadata,
  };
  aiAssetDiagnostics.generated({ campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily, asset_origin: 'AI_GENERATED', preview_available: false, generation_state: 'AI_GENERATED', fallback_mode: false });
  aiAssetDiagnostics.hydrated({ campaign_id: campaignId, execution_id: executionId, asset_type: assetFamily, asset_origin: 'AI_GENERATED', preview_available: false, generation_state: 'AI_GENERATED', fallback_mode: false });
  return projection;
}
