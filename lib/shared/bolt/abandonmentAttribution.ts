/**
 * BOLT abandonment attribution authority.
 *
 * Single, dependency-free home for deriving the failure-analytics
 * attribution tags (`campaign_type`, `pipeline_mode`) from a BOLT run
 * payload. Lives here — NOT in boltPipelineFailurePersistence — so the
 * sweepers (inline / cron / operator-script) can reuse the EXACT same
 * derivation without pulling in the heavy persistence dependency chain
 * (supabase client, user-friendly resolver, classifier).
 *
 * `deriveBoltCampaignType` is re-exported from boltPipelineFailurePersistence
 * for back-compat, so `persistPipelineFailure` and these helpers always
 * agree on the tag. There is exactly ONE derivation system — this one.
 *
 * Phase 6I-3 — abandonment attribution hardening.
 */

export type BoltPipelineMode = 'week_plan' | 'daily_plan' | 'schedule' | 'campaign_schedule' | 'repurpose' | string;
export type BoltCampaignType = 'bolt-text' | 'bolt-creator' | 'bolt-combined' | string;

/**
 * Derive the campaign-type tag from the execution config. Pure helper —
 * mirrors the value persistPipelineFailure stamps on thrown failures so
 * abandoned runs are attributable to the same surface vocabulary.
 */
export function deriveBoltCampaignType(executionConfig: Record<string, unknown> | undefined | null): BoltCampaignType {
  const mode = String(executionConfig?.campaign_mode ?? '').toLowerCase().trim();
  if (mode === 'creator') return 'bolt-creator';
  if (mode === 'combined') return 'bolt-combined';
  return 'bolt-text';
}

/**
 * Derive the pipeline-mode tag from the run payload. Matches the inline
 * authority used by executeBoltPipelineRuntime
 * (`pipelineMode = outcomeView ?? 'week_plan'`). A missing / blank
 * outcomeView collapses to 'week_plan' — same as the live pipeline.
 */
export function deriveBoltPipelineMode(payload: Record<string, unknown> | undefined | null): BoltPipelineMode {
  const ov = payload && typeof payload === 'object' ? (payload as { outcomeView?: unknown }).outcomeView : undefined;
  return typeof ov === 'string' && ov.trim() ? ov : 'week_plan';
}

/**
 * Resolve BOTH attribution tags from a run payload in one call. Used by
 * the abandonment sweepers to stamp `campaign_type` + `pipeline_mode` on
 * a swept run so failure analytics can slice abandoned runs by surface
 * (bolt-text / bolt-creator / bolt-combined). Never throws.
 */
export function deriveAbandonmentAttribution(
  payload: Record<string, unknown> | undefined | null,
): { campaign_type: BoltCampaignType; pipeline_mode: BoltPipelineMode } {
  const ec =
    payload && typeof payload === 'object'
      ? ((payload as { executionConfig?: Record<string, unknown> | null }).executionConfig ?? null)
      : null;
  return {
    campaign_type: deriveBoltCampaignType(ec),
    pipeline_mode: deriveBoltPipelineMode(payload),
  };
}
