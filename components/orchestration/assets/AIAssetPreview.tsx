/**
 * AIAssetPreview — Phase-2 Step-20.
 *
 * READ-ONLY consumer of the Step-18/19 `ai_asset` projection. Renders the
 * real generated preview (thumbnail/image) + state badge + fallback
 * affordance inside whatever zone the host gives it — it owns NO layout,
 * NO card structure (no planner/calendar redesign). Returns null for
 * non-AI-creatable inputs (video/manual → unchanged).
 *
 * Honest contract: it renders an <img> ONLY when a real preview_url exists
 * (written by the generation runtime). preview_pending → "Generating…"
 * badge (visible, not hidden, not a fake image).
 */

import { AIAssetBadge } from './AIAssetBadge';
import { AIAssetFallbackState } from './AIAssetFallbackState';
import { aiPreviewDiagnostics, type PreviewState } from './AIAssetDiagnostics';

export interface AIAssetProjectionLike {
  asset_state?: string;
  asset_origin?: string;
  fallback_mode?: boolean;
  generated_preview?: {
    asset_id?: string;
    preview_url?: string;
    thumbnail_url?: string;
    asset_family?: string;
    preview_pending?: boolean;
  } | null;
}

function resolvePreviewState(ai: AIAssetProjectionLike): PreviewState {
  const s = String(ai.asset_state ?? '').toUpperCase();
  if (s === 'GENERATION_FAILED') return 'GENERATION_FAILED';
  if (s === 'USER_REMOVED') return 'USER_REMOVED';
  if (s === 'USER_UPLOADED') return 'USER_UPLOADED';
  if (s === 'USER_REPLACED') return 'USER_REPLACED';
  if (ai.generated_preview?.preview_pending) return 'PREVIEW_PENDING';
  if (ai.generated_preview?.preview_url) return 'AI_GENERATED';
  return 'PREVIEW_PENDING';
}

export function AIAssetPreview({
  aiAsset,
  campaignId,
  executionId,
  size = 'sm',
  onUpload,
  onReplace,
  onRemoveAi,
  onRestoreAi,
}: {
  aiAsset?: AIAssetProjectionLike | null;
  campaignId?: string | null;
  executionId?: string | null;
  size?: 'sm' | 'md';
  onUpload?: () => void;
  onReplace?: () => void;
  onRemoveAi?: () => void;
  onRestoreAi?: () => void;
}) {
  if (!aiAsset) return null; // non-AI-creatable / not hydrated → unchanged

  const state = resolvePreviewState(aiAsset);
  const gp = aiAsset.generated_preview ?? null;
  const family = gp?.asset_family ?? null;
  const previewUrl = gp?.preview_url || gp?.thumbnail_url || '';
  const dim = size === 'md' ? 'h-16 w-16' : 'h-10 w-10';

  aiPreviewDiagnostics.render({
    campaign_id: campaignId ?? null,
    execution_id: executionId ?? null,
    asset_type: family,
    asset_origin: aiAsset.asset_origin ?? null,
    preview_state: state,
    fallback_state: aiAsset.fallback_mode ? 'upload_first' : 'none',
    render_success: Boolean(previewUrl),
  });

  const fallbackVisible = state === 'GENERATION_FAILED' || aiAsset.fallback_mode === true;

  if (state === 'PREVIEW_PENDING') {
    aiPreviewDiagnostics.pending({ campaign_id: campaignId ?? null, execution_id: executionId ?? null, asset_type: family });
  } else if (previewUrl) {
    aiPreviewDiagnostics.visible({ campaign_id: campaignId ?? null, execution_id: executionId ?? null, asset_type: family, render_success: true });
  }

  return (
    <span className="inline-flex items-center gap-1.5 align-middle" aria-label="AI asset preview (read-only)">
      {previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt={family ? `AI ${family} preview` : 'AI asset preview'}
          className={`${dim} object-cover rounded border border-gray-200 bg-gray-50`}
          loading="lazy"
          onError={() =>
            aiPreviewDiagnostics.fallback({
              campaign_id: campaignId ?? null,
              execution_id: executionId ?? null,
              preview_state: state,
              fallback_state: 'image_load_failed',
            })
          }
        />
      ) : (
        <span className={`${dim} grid place-items-center rounded border border-dashed border-gray-300 bg-gray-50 text-[8px] text-gray-400`}>
          {state === 'PREVIEW_PENDING' ? '…' : 'no preview'}
        </span>
      )}
      <span className="inline-flex flex-col gap-0.5">
        <AIAssetBadge state={state} assetFamily={family} />
        {fallbackVisible && (
          <AIAssetFallbackState
            state={state}
            campaignId={campaignId}
            executionId={executionId}
            hasAiAsset={Boolean(gp?.preview_url) || Boolean(onRestoreAi)}
            onUpload={onUpload}
            onReplace={onReplace}
            onRemoveAi={onRemoveAi}
            onRestoreAi={onRestoreAi}
          />
        )}
      </span>
    </span>
  );
}
