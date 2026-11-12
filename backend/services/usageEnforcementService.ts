/**
 * Plan-based hard enforcement (feature-flagged).
 * Uses usage_meter_monthly and resolveOrganizationPlanLimits. No ledger/alert coupling.
 */

import { supabase } from '../db/supabaseClient';
import { resolveOrganizationPlanLimits } from './planResolutionService';

/** A20: one reserved execution (usage_execution_reserve, migration 20270217000021). */
export type UsageReservation = { id: string; organization_id: string };

export type EnforcementResult =
  | {
      allowed: true;
      /**
       * Set only when the caller asked to `reserve` and the plan is limited: the execution is counted
       * against the plan from NOW. The caller must release it (releaseUsageReservation) once the
       * meter counts the send, or when the send did not happen; otherwise it counts until its TTL.
       */
      reservation?: UsageReservation;
    }
  | {
      allowed: false;
      resource_key: string;
      limit: number;
      current_usage: number;
      allowed_until: number;
      grace_percent: number;
      /** Set when the usage could not be read and the caller asked to fail closed (numbers are 0). */
      reason?: 'usage_unverifiable';
    };

/**
 * A20: how long an unreleased reservation keeps counting. A send that may have acted but is not
 * metered by the executor (a browser dispatch, a deferred RPA run, an uncertain outcome) is never
 * released, so it counts for this long - erring toward refusing, never toward a second grant.
 */
const RESERVATION_TTL_SECONDS = 24 * 60 * 60;

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function getMeterUsage(
  meterRow: { llm_total_tokens?: number | null; external_api_calls?: number | null; automation_executions?: number | null } | null,
  resourceKey: string
): number {
  if (!meterRow) return 0;
  switch (resourceKey) {
    case 'llm_tokens':
      return Number(meterRow.llm_total_tokens ?? 0);
    case 'external_api_calls':
      return Number(meterRow.external_api_calls ?? 0);
    case 'automation_executions':
      return Number(meterRow.automation_executions ?? 0);
    default:
      return 0;
  }
}

function getLimit(limits: { llm_tokens: number | null; external_api_calls: number | null; automation_executions: number | null }, resourceKey: string): number | null {
  switch (resourceKey) {
    case 'llm_tokens':
      return limits.llm_tokens;
    case 'external_api_calls':
      return limits.external_api_calls;
    case 'automation_executions':
      return limits.automation_executions;
    default:
      return null;
  }
}

export async function checkUsageBeforeExecution(params: {
  organization_id: string;
  resource_key: 'llm_tokens' | 'external_api_calls' | 'automation_executions';
  projected_increment?: number;
  /**
   * CLASS-2 A20 (e9 sweep): when the plan or the meter cannot be read, REFUSE instead of allowing.
   * Opt-in per caller: the engagement send path (a real reply / DM) asks for it. The LLM gateway and
   * the external API keep the historical allow-on-error behaviour until their owner decides.
   */
  failClosed?: boolean;
  /**
   * CLASS-2 A20 (e9 sweep): RESERVE the execution atomically instead of only reading the meter.
   * Reading allowed N concurrent sends to each see the same meter and all send (the meter is
   * incremented only after a send). With `reserve`, usage_execution_reserve counts the meter + live
   * reservations under a per (organization, month) lock and writes a reservation within the limit.
   * Only for resource 'automation_executions', projected_increment 1.
   */
  reserve?: { action_id: string; ttl_seconds?: number };
}): Promise<EnforcementResult> {
  if (params.reserve && (params.resource_key !== 'automation_executions' || (params.projected_increment ?? 1) !== 1)) {
    throw new Error('checkUsageBeforeExecution: reserve is only for automation_executions with projected_increment 1');
  }
  // ALLOW-ON-ERROR, MEASURED (owner ruling via e9, 2026-11-12): callers that did not opt into
  // failClosed (the LLM gateway, the external API) are still allowed when usage cannot be read - but
  // never silently. Every such allow logs at ERROR with ONE stable marker, so how often the accepted
  // fail-open fires can be counted (05: "accepted" and "never seen" are different claims).
  const allowedUnverified = (why: string): EnforcementResult => {
    console.error('USAGE_ENFORCEMENT_FAIL_OPEN', { organization_id: params.organization_id, resource_key: params.resource_key, why });
    return { allowed: true };
  };
  const unverifiable = (why: string): EnforcementResult => {
    console.error('[usageEnforcement] usage unverifiable; refusing (fail closed)', { organization_id: params.organization_id, resource_key: params.resource_key, why });
    return { allowed: false, resource_key: params.resource_key, limit: 0, current_usage: 0, allowed_until: 0, grace_percent: 0, reason: 'usage_unverifiable' };
  };
  try {
    const resolved = await resolveOrganizationPlanLimits(params.organization_id);
    const limit = getLimit(resolved.limits, params.resource_key);

    if (resolved.plan_key == null || limit == null) {
      return { allowed: true };
    }

    const { data: assignment, error: assignmentError } = await supabase
      .from('organization_plan_assignments')
      .select('plan_id')
      .eq('organization_id', params.organization_id)
      .maybeSingle();
    if (assignmentError) return params.failClosed ? unverifiable(`plan assignment: ${assignmentError.message}`) : allowedUnverified(`plan assignment: ${assignmentError.message}`);

    if (!assignment?.plan_id) return { allowed: true };

    const { data: planRow, error: planError } = await supabase
      .from('pricing_plans')
      .select('enforcement_enabled, allow_overage, grace_percent')
      .eq('id', assignment.plan_id)
      .maybeSingle();
    if (planError) return params.failClosed ? unverifiable(`plan: ${planError.message}`) : allowedUnverified(`plan: ${planError.message}`);

    const enforcementEnabled = planRow?.enforcement_enabled === true;
    const allowOverage = planRow?.allow_overage === true;
    const gracePercent = Number(planRow?.grace_percent ?? 0) || 0;

    if (!enforcementEnabled) return { allowed: true };

    const { year, month } = currentYearMonth();
    const { data: meterRow, error: meterError } = await supabase
      .from('usage_meter_monthly')
      .select('llm_total_tokens, external_api_calls, automation_executions')
      .eq('organization_id', params.organization_id)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle();
    if (meterError) return params.failClosed ? unverifiable(`meter: ${meterError.message}`) : allowedUnverified(`meter: ${meterError.message}`);

    const currentUsage = getMeterUsage(meterRow, params.resource_key);
    const projected = params.projected_increment ?? 0;
    const allowedUntil = limit * (1 + gracePercent / 100);

    if (allowOverage) {
      return { allowed: true };
    }

    if (params.reserve) {
      const { data, error } = await supabase.rpc('usage_execution_reserve', {
        p_org:           params.organization_id,
        p_year:          year,
        p_month:         month,
        p_action_id:     params.reserve.action_id,
        p_allowed_until: allowedUntil,
        p_ttl_seconds:   params.reserve.ttl_seconds ?? RESERVATION_TTL_SECONDS,
      });
      if (error) return params.failClosed ? unverifiable(`reserve: ${error.message}`) : allowedUnverified(`reserve: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as { granted?: unknown; reservation_id?: unknown; used?: unknown } | null;
      // A null error is not an answer (postgrest-js can answer a blank response with error: null).
      if (!row || typeof row.granted !== 'boolean' || (row.granted && typeof row.reservation_id !== 'string')) {
        return params.failClosed ? unverifiable('reserve: no answer') : allowedUnverified('reserve: no answer');
      }
      if (row.granted) {
        return { allowed: true, reservation: { id: row.reservation_id as string, organization_id: params.organization_id } };
      }
      return {
        allowed: false,
        resource_key: params.resource_key,
        limit,
        current_usage: Number(row.used ?? currentUsage),
        allowed_until: allowedUntil,
        grace_percent: gracePercent,
      };
    }

    if (currentUsage + projected <= allowedUntil) {
      return { allowed: true };
    }

    return {
      allowed: false,
      resource_key: params.resource_key,
      limit,
      current_usage: currentUsage,
      allowed_until: allowedUntil,
      grace_percent: gracePercent,
    };
  } catch (error: any) {
    if (params.failClosed) return unverifiable(error?.message ?? String(error));
    return allowedUnverified(error?.message ?? String(error));
  }
}

/**
 * A20: release THE live reservation of an action whose send finished elsewhere (the browser path: the
 * extension's action-result route knows the action, not the reservation id). Nothing live -> false.
 * A failed read or release is logged by name and the reservation counts until its TTL. Never throws.
 */
export async function releaseUsageReservationForAction(organizationId: string, actionId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('usage_execution_reservations')
      .select('id')
      .eq('action_id', actionId)
      .eq('organization_id', organizationId)
      .is('released_at', null)
      .maybeSingle();
    if (error) {
      console.error('USAGE_RESERVATION_RELEASE_FAILED', { action_id: actionId, organization_id: organizationId, error: error.message });
      return false;
    }
    const id = (data as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return false;
    return await releaseUsageReservation({ id, organization_id: organizationId });
  } catch (error: any) {
    console.error('USAGE_RESERVATION_RELEASE_FAILED', { action_id: actionId, organization_id: organizationId, error: error?.message ?? String(error) });
    return false;
  }
}

/**
 * A20: release a reservation - the meter now counts the send, or the send did not happen. A failed
 * release is logged (USAGE_RESERVATION_RELEASE_FAILED) and the reservation counts until its TTL:
 * erring toward refusing, never toward a second grant. Never throws.
 */
export async function releaseUsageReservation(reservation: UsageReservation): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('usage_execution_release', {
      p_reservation_id: reservation.id,
      p_org:            reservation.organization_id,
    });
    if (error) {
      console.error('USAGE_RESERVATION_RELEASE_FAILED', { reservation_id: reservation.id, organization_id: reservation.organization_id, error: error.message });
      return false;
    }
    return data === true;
  } catch (error: any) {
    console.error('USAGE_RESERVATION_RELEASE_FAILED', { reservation_id: reservation.id, organization_id: reservation.organization_id, error: error?.message ?? String(error) });
    return false;
  }
}
