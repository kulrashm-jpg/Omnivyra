import { ownedDbTable } from '../db/writeOwner';
/**
 * Org Control Service
 *
 * Runtime enforcement layer for per-org guardrails:
 *   - is_blocked           → reject every action
 *   - is_high_risk + cost  → reject actions above HIGH_RISK_CREDIT_CAP
 *   - daily_credit_limit   → reject when today's credit usage would exceed
 *
 * Called pre-flight from creditExecutionService.executeWithCredits. Also
 * owns the auto-flagging pathway: when a request's api_cost exceeds the
 * Phase 4 threshold, this service flips the org to is_high_risk=true so the
 * NEXT request is gated.
 */

import { supabase } from '../db/supabaseClient';
import { createAlert } from './alertService';
import { logger } from './logger';

const CACHE_TTL_MS = 30_000;

const HIGH_RISK_CREDIT_CAP = Number(process.env.HIGH_RISK_CREDIT_CAP ?? '50');

interface ControlsRow {
  organization_id:    string;
  is_blocked:         boolean;
  blocked_reason:     string | null;
  is_high_risk:       boolean;
  daily_credit_limit: number | null;
}

const _cache = new Map<string, { row: ControlsRow | null; fetchedAt: number }>();

async function loadControls(orgId: string): Promise<ControlsRow | null> {
  const cached = _cache.get(orgId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.row;

  try {
    const { data, error } = await ownedDbTable('org_controls')
      .select('organization_id, is_blocked, blocked_reason, is_high_risk, daily_credit_limit')
      .eq('organization_id', orgId)
      .maybeSingle();
    if (error) throw error;
    const row = (data as ControlsRow | null) ?? null;
    _cache.set(orgId, { row, fetchedAt: Date.now() });
    return row;
  } catch (err: any) {
    logger.warn('org_controls_load_failed', { orgId, message: err?.message });
    // Fail-open: if we can't read controls, permit the action. A writable
    // outage on this table shouldn't silently gate every request.
    return null;
  }
}

export function invalidateOrgControlsCache(orgId: string): void {
  _cache.delete(orgId);
}

// ── Pre-flight enforcement ────────────────────────────────────────────────

export type PreflightVerdict =
  | { allowed: true }
  | { allowed: false; code: 'ORG_BLOCKED' | 'HIGH_RISK_ACTION_GATED' | 'DAILY_LIMIT_EXCEEDED'; reason: string };

/**
 * Check whether an org can execute an action of a given credit cost right now.
 * Never throws. If the org_controls table is unreachable, returns allowed=true
 * (fail-open — alerting covers the observability gap).
 */
export async function preflightCheck(
  orgId: string,
  creditsRequired: number,
): Promise<PreflightVerdict> {
  const controls = await loadControls(orgId);
  if (!controls) return { allowed: true };

  if (controls.is_blocked) {
    return {
      allowed: false,
      code:    'ORG_BLOCKED',
      reason:  controls.blocked_reason ?? 'Organization is blocked.',
    };
  }

  if (controls.is_high_risk && creditsRequired > HIGH_RISK_CREDIT_CAP) {
    return {
      allowed: false,
      code:    'HIGH_RISK_ACTION_GATED',
      reason:  `Action requires ${creditsRequired} credits; high-risk org is capped at ${HIGH_RISK_CREDIT_CAP}.`,
    };
  }

  if (controls.daily_credit_limit != null) {
    const usedToday = await getCreditsUsedToday(orgId);
    if (usedToday + creditsRequired > controls.daily_credit_limit) {
      return {
        allowed: false,
        code:    'DAILY_LIMIT_EXCEEDED',
        reason:  `Daily limit ${controls.daily_credit_limit} would be exceeded (used ${usedToday} + ${creditsRequired}).`,
      };
    }
  }

  return { allowed: true };
}

async function getCreditsUsedToday(orgId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  try {
    const { data } = await ownedDbTable('unified_transactions')
      .select('credits_charged')
      .eq('organization_id', orgId)
      .eq('final_attempt', true)
      .not('credits_charged', 'is', null)
      .gte('created_at', dayStart.toISOString())
      .limit(10_000);
    let sum = 0;
    for (const r of (data ?? []) as Array<{ credits_charged: number | null }>) {
      sum += Number(r.credits_charged ?? 0);
    }
    return sum;
  } catch {
    return 0;  // fail-open for the limit check
  }
}

// ── Auto-block (immediate hard stop) ───────────────────────────────────────

/**
 * Immediately set is_blocked=true on org_controls. Called by the settlement
 * underfunded path — when a charge exceeds what the wallet can cover, we
 * restrict the org from placing further credit-consuming calls until a human
 * reviews. preflightCheck will return ORG_BLOCKED for any subsequent call.
 *
 * Admins can lift the block via applyOrgControl({block:false, ...}).
 */
export async function autoBlockLlm(
  orgId: string,
  reason: string,
): Promise<void> {
  try {
    await ownedDbTable('org_controls')
      .upsert(
        {
          organization_id: orgId,
          is_blocked:      true,
          blocked_reason:  reason,
          blocked_at:      new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
    invalidateOrgControlsCache(orgId);
    await createAlert({
      type:           'org_blocked',
      organizationId: orgId,
      severity:       'critical',
      message:        `Org auto-blocked: ${reason}`,
      dedupKey:       `auto_block:${new Date().toISOString().slice(0, 10)}`,
    });
    logger.error('org_auto_blocked', { orgId, reason });
  } catch (err: any) {
    logger.error('auto_block_llm_failed', { orgId, message: err?.message });
  }
}

// ── Auto-flag high-risk ────────────────────────────────────────────────────

/**
 * Upsert org_controls so is_high_risk=true with the supplied reason. Used by
 * the cost-threshold anomaly path — when a single request's cost exceeds the
 * per-request threshold, flag the org so the NEXT high-cost action is
 * pre-flight-rejected. Also files an alert.
 */
export async function autoFlagHighRisk(
  orgId: string,
  reason: string,
): Promise<void> {
  try {
    await ownedDbTable('org_controls')
      .upsert(
        {
          organization_id:  orgId,
          is_high_risk:     true,
          high_risk_reason: reason,
          high_risk_set_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
    invalidateOrgControlsCache(orgId);
    await createAlert({
      type:           'high_cost',
      organizationId: orgId,
      severity:       'critical',
      message:        `Org auto-flagged high_risk: ${reason}`,
      dedupKey:       `auto_high_risk:${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (err: any) {
    logger.error('auto_flag_high_risk_failed', { orgId, message: err?.message });
  }
}

// ── Admin-surface writer ───────────────────────────────────────────────────

export interface ApplyOrgControlOpts {
  organizationId:    string;
  block?:            boolean;
  blockedReason?:    string;
  dailyCreditLimit?: number | null;
  highRisk?:         boolean;
  highRiskReason?:   string;
  notes?:            string;
  actorUserId:       string;
}

export async function applyOrgControl(opts: ApplyOrgControlOpts): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    organization_id:    opts.organizationId,
    updated_by_user_id: opts.actorUserId,
  };

  if (opts.block !== undefined) {
    patch.is_blocked         = opts.block;
    patch.blocked_reason     = opts.block ? (opts.blockedReason ?? 'blocked by admin') : null;
    patch.blocked_by_user_id = opts.block ? opts.actorUserId : null;
    patch.blocked_at         = opts.block ? now : null;
  }
  if (opts.dailyCreditLimit !== undefined) {
    patch.daily_credit_limit = opts.dailyCreditLimit;
  }
  if (opts.highRisk !== undefined) {
    patch.is_high_risk     = opts.highRisk;
    patch.high_risk_reason = opts.highRisk ? (opts.highRiskReason ?? 'flagged by admin') : null;
    patch.high_risk_set_at = opts.highRisk ? now : null;
  }
  if (opts.notes !== undefined) patch.notes = opts.notes;

  const { error } = await ownedDbTable('org_controls')
    .upsert(patch, { onConflict: 'organization_id' });

  if (error) throw error;

  invalidateOrgControlsCache(opts.organizationId);

  if (opts.block === true) {
    await createAlert({
      type:           'org_blocked',
      organizationId: opts.organizationId,
      severity:       'critical',
      message:        `Org blocked by admin: ${opts.blockedReason ?? 'no reason given'}`,
    });
  }
}
