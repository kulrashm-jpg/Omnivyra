/**
 * ActivityCardAIAssetState — Phase-2 Step-21.
 *
 * Badge-ONLY variant for a legacy card's existing badge strip (no
 * thumbnail, smallest possible footprint). Distinguishes AI_GENERATED /
 * USER_UPLOADED / USER_REPLACED / GENERATION_FAILED / PREVIEW_PENDING
 * inside the card itself. Fail-soft → null when no projection.
 */

import { AIAssetBadge } from '../AIAssetBadge';
import type { PreviewState } from '../AIAssetDiagnostics';
import { useCardAIAsset } from './ActivityCardAIAsset';
import { activityCardAiDiagnostics } from './ActivityCardAIAssetDiagnostics';

function toState(ai: { asset_state?: string; generated_preview?: { preview_url?: string; preview_pending?: boolean } | null }): PreviewState {
  const s = String(ai.asset_state ?? '').toUpperCase();
  if (s === 'GENERATION_FAILED') return 'GENERATION_FAILED';
  if (s === 'USER_REMOVED') return 'USER_REMOVED';
  if (s === 'USER_UPLOADED') return 'USER_UPLOADED';
  if (s === 'USER_REPLACED') return 'USER_REPLACED';
  if (ai.generated_preview?.preview_pending) return 'PREVIEW_PENDING';
  if (ai.generated_preview?.preview_url) return 'AI_GENERATED';
  return 'PREVIEW_PENDING';
}

export function ActivityCardAIAssetState({
  campaignId,
  executionId,
  inlineBlob,
}: {
  campaignId?: string | null;
  executionId?: string | null;
  inlineBlob?: Record<string, unknown> | null;
}) {
  const ai = useCardAIAsset(campaignId, executionId, inlineBlob);
  if (!ai) return null;

  const state = toState(ai);
  activityCardAiDiagnostics.state({
    campaign_id: campaignId ?? null,
    execution_id: executionId ?? null,
    asset_state: ai.asset_state ?? null,
    asset_origin: ai.asset_origin ?? null,
    preview_visible: Boolean(ai.generated_preview?.preview_url),
    fallback_active: ai.fallback_mode === true,
    failsoft_active: false,
  });

  return <AIAssetBadge state={state} assetFamily={ai.generated_preview?.asset_family ?? null} />;
}
