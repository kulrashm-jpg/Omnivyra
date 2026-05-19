/**
 * ActivityCardAIAsset — Phase-2 Step-21, made LIVE in Step-22.
 *
 * Hydrates the REAL `ai_asset` projection INTO a legacy activity card,
 * reusing the existing card body/badge zone — NO layout redesign. Now
 * backed by the Step-22 scoped live store (real-time refresh on mutation /
 * focus, no reload, no polling) and wired to the REAL orchestration
 * mutation endpoint for Remove / Restore.
 *
 * Fail-soft by construction: missing data / error → renders null so the
 * legacy card is byte-identical to before. Video / manual / text →
 * ai_asset null upstream → renders nothing (video workflow untouched).
 */

import { useAIAssetLiveHydration } from '../live/useAIAssetLiveHydration';
import { useAIAssetMutation } from '../live/useAIAssetMutation';
import { AIAssetPreview, type AIAssetProjectionLike } from '../AIAssetPreview';
import { activityCardAiDiagnostics } from './ActivityCardAIAssetDiagnostics';

/**
 * Step-21 public name preserved (ActivityCardAIAssetState / -Fallback
 * import it). Now delegates to the Step-22 live store: same signature,
 * live behavior, single shared fetch per campaign.
 */
export function useCardAIAsset(
  campaignId?: string | null,
  executionId?: string | null,
  inlineBlob?: Record<string, unknown> | null,
): AIAssetProjectionLike | null | undefined {
  return useAIAssetLiveHydration(campaignId, executionId, inlineBlob);
}

export function ActivityCardAIAsset({
  campaignId,
  executionId,
  inlineBlob,
  size = 'sm',
  onUpload,
  onReplace,
}: {
  campaignId?: string | null;
  executionId?: string | null;
  inlineBlob?: Record<string, unknown> | null;
  size?: 'sm' | 'md';
  /** Host-supplied upload/replace (existing workspace pipeline). */
  onUpload?: () => void;
  onReplace?: () => void;
}) {
  const ai = useCardAIAsset(campaignId, executionId, inlineBlob);
  const { removeAi, restoreAi } = useAIAssetMutation(campaignId, executionId);

  if (!ai) return null; // loading (undefined) or none/video/manual (null)

  activityCardAiDiagnostics.preview({
    campaign_id: campaignId ?? null,
    execution_id: executionId ?? null,
    asset_state: ai.asset_state ?? null,
    asset_origin: ai.asset_origin ?? null,
    preview_visible: Boolean(ai.generated_preview?.preview_url),
    fallback_active: ai.fallback_mode === true,
    failsoft_active: false,
  });

  return (
    <span className="inline-flex" data-orch-ai-card="1">
      <AIAssetPreview
        aiAsset={ai}
        campaignId={campaignId}
        executionId={executionId}
        size={size}
        onUpload={onUpload}
        onReplace={onReplace}
        onRemoveAi={() => { void removeAi(); }}
        onRestoreAi={() => { void restoreAi(); }}
      />
    </span>
  );
}
