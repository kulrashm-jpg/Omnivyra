/**
 * aiAssetFallback — Phase-2 Step-18.
 * Decides upload-fallback / generation-failure handling for AI-creatable
 * assets. Pure. Video/manual never reach here (handled upstream).
 */

export interface AiAssetDegradationSignals {
  generation_failed?: boolean;
  user_removed?: boolean;
  user_uploaded?: boolean;
  workflow_switched?: boolean;
  /** No creator generation runtime/result available in this environment. */
  generation_unavailable?: boolean;
}

export interface AiAssetFallbackDecision {
  fallback_mode: boolean;
  reason: string | null;
  upload_first: boolean;
}

export function evaluateAiAssetFallback(s: AiAssetDegradationSignals): AiAssetFallbackDecision {
  if (s.generation_failed) return { fallback_mode: true, reason: 'generation_failed', upload_first: true };
  if (s.user_removed) return { fallback_mode: true, reason: 'user_removed', upload_first: true };
  if (s.user_uploaded) return { fallback_mode: true, reason: 'user_uploaded', upload_first: true };
  if (s.workflow_switched) return { fallback_mode: true, reason: 'workflow_switched', upload_first: true };
  if (s.generation_unavailable) return { fallback_mode: true, reason: 'generation_runtime_unavailable', upload_first: true };
  return { fallback_mode: false, reason: null, upload_first: false };
}
