/**
 * schedulerAuthorityEnforcer — Phase-2 Step-32.
 *
 * Promotes the Step-31 publishing projection from DIFF-ONLY to ENFORCING:
 * under AUTHORITATIVE cutover the canonical projection decides scheduler
 * eligibility; otherwise the legacy decision governs (fallback-only).
 *
 * SAFETY (STRICT RULES 4/5/6/7/8):
 *  - SHADOW (default) / LEGACY / rollback / projection-invalid / any
 *    exception ⇒ `enforced:false` ⇒ caller keeps the legacy decision
 *    byte-identically.
 *  - Never throws. Never blocks scheduler runtime.
 *  - Parity with legacy semantics: legacy gate rejects a run when ANY row
 *    is ineligible; canonical mirrors that with `blocked_count > 0 ⇒
 *    rejected`. WAITING_* rows do not hard-reject the run (deferred), the
 *    same way the legacy text path leaves non-ready rows for downstream.
 */

import { evaluateAuthoritativePublishing } from './authoritativePublishingResolver';

const LOG = (tag: string, payload: Record<string, unknown>) => {
  try {
    // eslint-disable-next-line no-console
    console.log(`[${tag}]`, JSON.stringify(payload));
  } catch {
    /* never throw from a diagnostic */
  }
};

export type SchedulerDecision = 'schedulable' | 'deferred' | 'rejected' | 'legacy';

export interface SchedulerEnforcementResult {
  /** Effective cutover mode for this run. */
  mode: 'AUTHORITATIVE' | 'SHADOW' | 'LEGACY';
  /** true ⇒ canonical decision governs; false ⇒ caller keeps legacy. */
  enforced: boolean;
  /** The eligibility the caller should act on. */
  eligible: boolean;
  decision: SchedulerDecision;
  blocking_reasons: string[];
  fallback_active: boolean;
  canonical: {
    schedulable_count: number;
    blocked_count: number;
    waiting_count: number;
    authoritative_eligible: boolean;
    fidelity: boolean;
  } | null;
}

/**
 * Resolve the effective scheduler eligibility. `legacyEligible` is the
 * existing `evaluateScheduleEligibility(...).eligible` verdict — used as
 * the fallback AND as the diff baseline.
 */
export async function enforceSchedulerEligibility(
  campaignId: string,
  legacyEligible: boolean,
): Promise<SchedulerEnforcementResult> {
  const legacyResult: SchedulerEnforcementResult = {
    mode: 'LEGACY',
    enforced: false,
    eligible: legacyEligible,
    decision: 'legacy',
    blocking_reasons: [],
    fallback_active: true,
    canonical: null,
  };

  try {
    const canonical = await evaluateAuthoritativePublishing(campaignId, legacyEligible);
    const mode =
      canonical.mode === 'AUTHORITATIVE'
        ? 'AUTHORITATIVE'
        : canonical.mode === 'LEGACY'
          ? 'LEGACY'
          : 'SHADOW';

    LOG('SCHEDULER_CANONICAL_STATE', {
      campaign_id: campaignId,
      scheduler_mode: mode,
      schedulable: canonical.schedulable_count,
      blocked: canonical.blocked_count,
      waiting: canonical.waiting_count,
      authoritative_eligible: canonical.authoritative_eligible,
    });

    // Decision mismatch visibility (SHADOW validation extension).
    const canonicalEligible = canonical.blocked_count === 0;
    if (canonicalEligible !== legacyEligible) {
      LOG('SCHEDULER_DECISION_DIFF', {
        campaign_id: campaignId,
        scheduler_mode: mode,
        legacy_eligible: legacyEligible,
        canonical_eligible: canonicalEligible,
        blocked_reason: canonical.blocked_count > 0 ? 'canonical_blocked' : null,
      });
    }

    // ENFORCE only under AUTHORITATIVE with a usable projection.
    const projectionUsable =
      canonical.schedulable_count + canonical.blocked_count + canonical.waiting_count > 0;
    if (mode === 'AUTHORITATIVE' && projectionUsable) {
      const decision: SchedulerDecision =
        canonical.blocked_count > 0
          ? 'rejected'
          : canonical.schedulable_count > 0
            ? 'schedulable'
            : 'deferred';
      LOG('SCHEDULER_AUTHORITY', {
        campaign_id: campaignId,
        scheduler_mode: 'AUTHORITATIVE',
        canonical_scheduler_state: decision,
        schedulable: decision === 'schedulable',
        blocked_reason: decision === 'rejected' ? 'canonical_blocked' : null,
        enforcement_source: 'publishing_projection',
        fallback_active: false,
      });
      LOG('SCHEDULER_ENFORCEMENT', {
        campaign_id: campaignId,
        scheduler_mode: 'AUTHORITATIVE',
        canonical_scheduler_state: decision,
        eligible: decision !== 'rejected',
        enforcement_source: 'publishing_projection',
      });
      return {
        mode: 'AUTHORITATIVE',
        enforced: true,
        eligible: decision !== 'rejected',
        decision,
        blocking_reasons: canonical.blocked_count > 0 ? ['CANONICAL_BLOCKED'] : [],
        fallback_active: false,
        canonical,
      };
    }

    // SHADOW / LEGACY / unusable projection ⇒ legacy governs (diff logged).
    LOG('SCHEDULER_FALLBACK', {
      campaign_id: campaignId,
      scheduler_mode: mode,
      reason:
        mode === 'AUTHORITATIVE' ? 'projection_unusable' : `mode_${mode.toLowerCase()}`,
      fallback_active: true,
      enforcement_source: 'legacy',
    });
    return { ...legacyResult, mode, canonical };
  } catch (e) {
    LOG('SCHEDULER_ROLLBACK', {
      campaign_id: campaignId,
      scheduler_mode: 'LEGACY',
      reason: `enforcement_exception:${(e as Error)?.message ?? 'unknown'}`,
      fallback_active: true,
      enforcement_source: 'legacy',
    });
    return legacyResult;
  }
}
