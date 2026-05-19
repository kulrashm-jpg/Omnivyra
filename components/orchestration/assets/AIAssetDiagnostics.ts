/**
 * AIAssetDiagnostics — Phase-2 Step-20 (client, read-only).
 *
 * Preview-visibility observability. No mutation, never throws. Distinct
 * tag namespace from Step-19 runtime logs (AI_ASSET_*) and Step-15 UI logs
 * (PLANNER/CALENDAR_UI_*).
 *
 * NOTE: repo has no `frontend/` root; per-spec the layer is created under
 * the existing `components/orchestration/` tree (the Step-15 rendering zone)
 * so it is actually reachable instead of dead code.
 */

function log(tag: string, payload: Record<string, unknown>): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a UI log */
  }
}

export type PreviewState =
  | 'AI_GENERATED'
  | 'USER_UPLOADED'
  | 'USER_REPLACED'
  | 'USER_REMOVED'
  | 'GENERATION_FAILED'
  | 'PREVIEW_PENDING';

export const aiPreviewDiagnostics = {
  render: (p: Record<string, unknown>) => log('AI_PREVIEW_RENDER', p),
  visible: (p: Record<string, unknown>) => log('AI_PREVIEW_VISIBLE', p),
  fallback: (p: Record<string, unknown>) => log('AI_PREVIEW_FALLBACK', p),
  replaced: (p: Record<string, unknown>) => log('AI_PREVIEW_REPLACED', p),
  restored: (p: Record<string, unknown>) => log('AI_PREVIEW_RESTORED', p),
  pending: (p: Record<string, unknown>) => log('AI_PREVIEW_PENDING', p),
};
