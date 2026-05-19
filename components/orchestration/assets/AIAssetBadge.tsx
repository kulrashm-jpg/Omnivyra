/**
 * AIAssetBadge — Phase-2 Step-20.
 *
 * READ-ONLY visual-state badge for an AI-creatable asset. Reuses the exact
 * chip/pill pattern already used by PlannerOrchestrationStrip /
 * CalendarOrchestrationStrip (no new design language, no layout change).
 *
 * Distinguishes: AI_GENERATED · USER_UPLOADED · USER_REPLACED ·
 * GENERATION_FAILED · PREVIEW_PENDING, plus the asset-family indicator.
 */

import type { PreviewState } from './AIAssetDiagnostics';

const TONE: Record<PreviewState, string> = {
  AI_GENERATED: 'bg-emerald-50 text-emerald-700',
  USER_UPLOADED: 'bg-indigo-50 text-indigo-700',
  USER_REPLACED: 'bg-indigo-50 text-indigo-700',
  USER_REMOVED: 'bg-amber-50 text-amber-700',
  GENERATION_FAILED: 'bg-red-50 text-red-700',
  PREVIEW_PENDING: 'bg-amber-50 text-amber-700',
};

const LABEL: Record<PreviewState, string> = {
  AI_GENERATED: 'AI generated',
  USER_UPLOADED: 'Uploaded',
  USER_REPLACED: 'Replaced',
  USER_REMOVED: 'AI removed — upload',
  GENERATION_FAILED: 'Generation failed',
  PREVIEW_PENDING: 'Generating…',
};

export function AIAssetBadge({
  state,
  assetFamily,
}: {
  state: PreviewState;
  assetFamily?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${TONE[state]}`}>
        {LABEL[state]}
      </span>
      {assetFamily && (
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
          {assetFamily}
        </span>
      )}
    </span>
  );
}
