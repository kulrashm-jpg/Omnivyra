/**
 * Execution Guarantee Layer.
 * Ensures ONLY the validated blueprint is used for execution.
 * No scoring, sequencing, generation, or validation logic changes.
 * Routing + execution safety only.
 */

import type { CampaignBlueprint } from './recommendationBlueprintService';
import { validateCampaignBlueprint } from './recommendationBlueprintValidationService';

/** Recommendation engine result shape (minimal for resolver) */
export type RecommendationResultLike = {
  campaign_blueprint_validated?: CampaignBlueprint | null;
  campaign_blueprint?: CampaignBlueprint | null;
};

/** Safe failure when execution blueprint is missing or invalid */
export type ExecutionBlueprintGuardFailure = {
  status: 'no_execution_blueprint';
  reason: 'campaign blueprint missing or invalid';
};

export const EXECUTION_SOURCE_VALIDATED = 'validated_blueprint' as const;

/**
 * Resolves the execution-safe blueprint from a recommendation result.
 * Rules:
 * 1. If campaign_blueprint_validated exists → return it.
 * 2. Else if campaign_blueprint exists → run validation, return corrected_blueprint.
 * 3. Else return null.
 *
 * Guarantees safe execution even for old cached results (backward compatible).
 */
export function resolveExecutionBlueprint(
  result: RecommendationResultLike | null | undefined
): CampaignBlueprint | null {
  if (!result) return null;

  if (result.campaign_blueprint_validated != null) {
    return result.campaign_blueprint_validated;
  }

  if (result.campaign_blueprint != null) {
    const validation = validateCampaignBlueprint(result.campaign_blueprint);
    return validation.corrected_blueprint;
  }

  return null;
}

/**
 * Hard guard: returns safe failure when execution blueprint is missing or invalid.
 * Use before execution begins.
 * Does NOT throw.
 */
export function checkExecutionBlueprintGuard(
  blueprint: CampaignBlueprint | null | undefined
): { ok: true; blueprint: CampaignBlueprint } | { ok: false; failure: ExecutionBlueprintGuardFailure } {
  if (blueprint == null) {
    return {
      ok: false,
      failure: {
        status: 'no_execution_blueprint',
        reason: 'campaign blueprint missing or invalid',
      },
    };
  }
  const plan = blueprint.weekly_plan;
  if (!Array.isArray(plan) || plan.length === 0) {
    return {
      ok: false,
      failure: {
        status: 'no_execution_blueprint',
        reason: 'campaign blueprint missing or invalid',
      },
    };
  }
  return { ok: true, blueprint };
}

/**
 * Resolves execution blueprint and runs the guard.
 * Returns either the safe blueprint or the deterministic failure.
 */
export function resolveAndGuardExecutionBlueprint(
  result: RecommendationResultLike | null | undefined
):
  | { ok: true; blueprint: CampaignBlueprint; execution_source: typeof EXECUTION_SOURCE_VALIDATED }
  | { ok: false; failure: ExecutionBlueprintGuardFailure } {
  const resolved = resolveExecutionBlueprint(result);
  const guard = checkExecutionBlueprintGuard(resolved);
  if (guard.ok) {
    return {
      ok: true,
      blueprint: guard.blueprint,
      execution_source: EXECUTION_SOURCE_VALIDATED,
    };
  }
  return { ok: false, failure: guard.failure };
}
