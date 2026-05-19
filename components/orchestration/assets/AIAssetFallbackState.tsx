/**
 * AIAssetFallbackState — Phase-2 Step-20.
 *
 * READ-ONLY upload-first fallback affordance shown when generation failed
 * or the user removed/replaced the AI asset. Surfaces the override actions
 * (Upload / Replace / Restore AI) WITHOUT owning mutation: callbacks are
 * optional and delegated to the host card's existing upload handlers so
 * orchestration/creator/strategy lineage continuity is preserved by the
 * existing pipeline (this component invents no new write path).
 *
 * If no handlers are provided it renders as a non-interactive status hint
 * (still visible — never hidden), preserving the "no UI redesign" rule.
 */

import { aiPreviewDiagnostics, type PreviewState } from './AIAssetDiagnostics';

export function AIAssetFallbackState({
  state,
  campaignId,
  executionId,
  hasAiAsset,
  onUpload,
  onReplace,
  onRemoveAi,
  onRestoreAi,
}: {
  state: PreviewState;
  campaignId?: string | null;
  executionId?: string | null;
  /** true when an AI asset exists to restore back to. */
  hasAiAsset?: boolean;
  onUpload?: () => void;
  onReplace?: () => void;
  onRemoveAi?: () => void;
  onRestoreAi?: () => void;
}) {
  aiPreviewDiagnostics.fallback({
    campaign_id: campaignId ?? null,
    execution_id: executionId ?? null,
    preview_state: state,
    fallback_state: 'upload_first',
  });

  const Btn = ({ label, fn, kind }: { label: string; fn?: () => void; kind: string }) =>
    fn ? (
      <button
        type="button"
        onClick={() => {
          if (label.startsWith('Restore')) {
            aiPreviewDiagnostics.restored({ campaign_id: campaignId ?? null, execution_id: executionId ?? null });
          } else {
            aiPreviewDiagnostics.replaced({ campaign_id: campaignId ?? null, execution_id: executionId ?? null, preview_state: state });
          }
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
    <span className="inline-flex items-center gap-1" aria-label="AI asset fallback (upload-first)">
      <Btn label="Upload asset" fn={onUpload} kind="bg-indigo-50 text-indigo-700" />
      <Btn label="Replace" fn={onReplace} kind="bg-gray-100 text-gray-600" />
      {hasAiAsset && onRemoveAi && <Btn label="Remove AI asset" fn={onRemoveAi} kind="bg-red-50 text-red-700" />}
      {hasAiAsset && <Btn label="Restore AI asset" fn={onRestoreAi} kind="bg-emerald-50 text-emerald-700" />}
    </span>
  );
}
