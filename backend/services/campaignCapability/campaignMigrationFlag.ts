/**
 * campaignMigrationFlag.ts — reversible Campaign Planner migration flag (PMF-005 §10).
 *
 * Follows the repo's env `*_RUNTIME` convention (CONTENT_WRITER_RUNTIME,
 * LONG_FORM_RUNTIME, CREATOR_RUNTIME). Selects which runtime serves campaign
 * planning; reversible with a single env change — no code/schema change. DEFAULT is
 * 'legacy'; the platform path becomes default only after parity is validated.
 *
 *   legacy   — the existing planner path only (unchanged behavior).
 *   platform — execute through the Campaign Planner AIA agent (AIA orchestration +
 *              AIC execution + CKC knowledge), the existing planner engine preserved
 *              as the inference backend.
 *   dual     — run the platform path; on ANY failure fall back to legacy (serve the
 *              legacy plan) for parity validation with zero risk.
 */

export type CampaignRuntimeMode = 'legacy' | 'platform' | 'dual';

const VALID = new Set<CampaignRuntimeMode>(['legacy', 'platform', 'dual']);

export function getCampaignRuntimeMode(): CampaignRuntimeMode {
  const raw = String(process.env.CAMPAIGN_PLANNER_RUNTIME ?? '').trim().toLowerCase();
  return VALID.has(raw as CampaignRuntimeMode) ? (raw as CampaignRuntimeMode) : 'legacy';
}

/** Whether the platform (agent) path should execute for a mode. */
export function shouldRunPlatform(mode: CampaignRuntimeMode = getCampaignRuntimeMode()): boolean {
  return mode === 'platform' || mode === 'dual';
}

/** Whether legacy is the guaranteed served/fallback path (legacy + dual). */
export function legacyIsSafetyNet(mode: CampaignRuntimeMode = getCampaignRuntimeMode()): boolean {
  return mode === 'legacy' || mode === 'dual';
}
