/**
 * ActivityCardAIAssetFallback — Phase-2 Step-21.
 *
 * Inline remove/replace/restore/upload visibility for a legacy card's
 * EXISTING upload zone. Shown only when the asset is in a fallback/override
 * state (GENERATION_FAILED / fallback_mode / user override). Mutation is
 * host-delegated (callbacks) — this owns NO write path, so orchestration /
 * creator / strategy lineage continuity is preserved by the existing
 * pipeline. Fail-soft → null when no projection.
 */

import { useCardAIAsset } from './ActivityCardAIAsset';
import { activityCardAiDiagnostics } from './ActivityCardAIAssetDiagnostics';

export function ActivityCardAIAssetFallback({
  campaignId,
  executionId,
  inlineBlob,
  onUpload,
  onReplace,
  onRemoveAi,
  onRestoreAi,
}: {
  campaignId?: string | null;
  executionId?: string | null;
  inlineBlob?: Record<string, unknown> | null;
  onUpload?: () => void;
  onReplace?: () => void;
  onRemoveAi?: () => void;
  onRestoreAi?: () => void;
}) {
  const ai = useCardAIAsset(campaignId, executionId, inlineBlob);
  if (!ai) return null;

  const failed = String(ai.asset_state ?? '').toUpperCase() === 'GENERATION_FAILED';
  const override = ai.fallback_mode === true || failed;
  if (!override) return null;

  const hasAi = Boolean(ai.generated_preview?.preview_url);
  activityCardAiDiagnostics.fallback({
    campaign_id: campaignId ?? null,
    execution_id: executionId ?? null,
    asset_state: ai.asset_state ?? null,
    asset_origin: ai.asset_origin ?? null,
    preview_visible: hasAi,
    fallback_active: true,
    failsoft_active: false,
  });

  const Btn = ({ label, fn, kind, ev }: { label: string; fn?: () => void; kind: string; ev: 'replace' | 'restore' }) =>
    fn ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          activityCardAiDiagnostics[ev]({
            campaign_id: campaignId ?? null,
            execution_id: executionId ?? null,
            asset_origin: ai.asset_origin ?? null,
          });
          fn();
        }}
        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${kind}`}
      >
        {label}
      </button>
    ) : (
      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${kind} opacity-70`}>{label}</span>
    );

  return (
    <span className="inline-flex items-center gap-1" aria-label="AI asset override (upload-first)">
      <Btn label="Upload asset" fn={onUpload} kind="bg-indigo-50 text-indigo-700" ev="replace" />
      <Btn label="Replace" fn={onReplace} kind="bg-gray-100 text-gray-600" ev="replace" />
      {hasAi && <Btn label="Remove AI asset" fn={onRemoveAi} kind="bg-red-50 text-red-700" ev="replace" />}
      {hasAi && <Btn label="Restore AI asset" fn={onRestoreAi} kind="bg-emerald-50 text-emerald-700" ev="restore" />}
    </span>
  );
}
