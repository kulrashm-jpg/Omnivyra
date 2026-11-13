/**
 * e9 2026-11-13 (BLOCKING at the flip) - the company-profile AI refine is ONE billed unit ('profile_refine', 046).
 *
 * The refine ran unpriced on three paths: onboarding's eager refine, the manual /api/company-profile/refine, and -
 * the widest - getProfile's staleness-driven auto-refine, which (with the profile-cache flag off, the default) runs
 * for EVERY getProfile read that does not pass autoRefine:false. This module bills the AUTO path inside getProfile, so
 * every caller is covered at one point. The manual route bills through wirePhase2Route.
 *
 * DOUBLY DARK: billed only when getCreditEconomyExecutionMode is 'enforce'; otherwise the refine runs exactly as before.
 *
 * A READ MUST NEVER FAIL BECAUSE OF BILLING. The auto refine is an optional enrichment of a read: when the org cannot
 * pay (insufficient / no account / blocked), or the unit for this staleness window was already charged by a
 * concurrent read, the refine is SKIPPED and the caller gets the unrefined profile (`null` from this function). A
 * refine that THROWS still throws (unchanged behaviour), after its exposure is released.
 *
 * Identity: one unit per company per staleness window (the stored last_refined_at), so concurrent stale reads charge
 * once; a failed (released) attempt moves to the next slot `:r<n>` so the window is not stuck unrefined.
 */
import { executeWithEntryConsumption, makeIdempotencyKey } from '../creditExecutionService';
import { getCreditEconomyExecutionMode } from './creditEconomyActivation';
import { logger } from '../logger';

export const PROFILE_REFINE_ACTION = 'profile_refine';
export const PROFILE_REFINE_SURFACE = 'profile.auto-refine';
/** One refine unit: up to 4 profileExtraction + 2 profileEnrichment calls (046 header). */
export const PROFILE_REFINE_UNIT_CALLS = 6;
export const MAX_PROFILE_REFINE_SLOTS = 5;

export function profileRefineIdentity(companyId: string, lastRefinedAt: string | null | undefined): string {
  return `profile_refine:auto:${companyId}:${lastRefinedAt ?? 'never'}`;
}

/** Runs `refine` as a billed unit when enforced. Returns its result, or null when the refine was skipped. */
export async function runAutoRefineBilled<T>(args: {
  companyId: string;
  lastRefinedAt: string | null | undefined;
  refine: () => Promise<T>;
}): Promise<T | null> {
  const mode = await getCreditEconomyExecutionMode({ organizationId: args.companyId, surface: PROFILE_REFINE_SURFACE });
  if (mode !== 'enforce') return args.refine();

  const identity = profileRefineIdentity(args.companyId, args.lastRefinedAt);
  for (let n = 0; n < MAX_PROFILE_REFINE_SLOTS; n++) {
    const referenceId = n === 0 ? identity : `${identity}:r${n}`;
    const r = await executeWithEntryConsumption<T>({
      userId:              args.companyId,
      orgId:               args.companyId,
      action:              PROFILE_REFINE_ACTION,
      referenceType:       'profile_refine',
      referenceId,
      idempotencyKey:      makeIdempotencyKey(args.companyId, PROFILE_REFINE_ACTION, referenceId),
      validateMembership:  false,
      llmPricing: {
        provider: 'openai',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        actionKey: PROFILE_REFINE_ACTION,
        maxInputTokens: 8000 * PROFILE_REFINE_UNIT_CALLS,
        maxOutputTokens: 1500 * PROFILE_REFINE_UNIT_CALLS,
      },
      collectViaCollector: true,
      executor:            args.refine,
    });
    if (r.status === 'executed') return r.result as T;
    if (r.status === 'already_released') continue;
    // already_settled (a concurrent read was charged for this window), insufficient, no account, blocked: SKIP the
    // refine - never re-run for free, never fail the read.
    logger.info('profile_auto_refine_skipped', { companyId: args.companyId, reason: r.status, referenceId });
    return null;
  }
  logger.warn('profile_auto_refine_skipped', { companyId: args.companyId, reason: 'reclaim_cap', identity });
  return null;
}
