/**
 * Phase 2 — Monitoring orchestration contract.
 *
 * Pure scheduling / validation primitives. Nothing in this module starts a
 * worker, fires a cron, or initiates a network call. A future Phase 3
 * orchestrator will use these primitives to decide whether to enqueue a
 * scan; today they only:
 *   • compute the next planned run timestamp for a configuration,
 *   • evaluate whether a planned run is permitted to fire (consent fresh,
 *     scope sufficient, budget not exhausted, cooldown respected, no
 *     duplicate in-flight, daily ceiling not exceeded),
 *   • record the resulting `monitoring_runs` row (planned | blocked |
 *     skipped) so observability has full state.
 *
 * No autonomous activation. Calling `planNextRun` writes a `planned` row;
 * an explicit Phase 3 caller must transition it to `running` and only then
 * does any actual monitoring happen.
 */

import { ownedDbTable } from '../db/writeOwner';
import { buildCapabilityAggregate } from './capabilityAggregationService';
import { evaluateMonitoringEligibility } from './monitoringEligibilityService';
import type {
  ListeningConfiguration,
  ListeningMode,
} from '../types/listeningConfiguration';
import { FREQUENCY_INTERVAL_HOURS } from '../types/listeningConfiguration';
import type {
  MonitoringBlockReason,
  MonitoringRun,
  MonitoringRunStatus,
} from '../types/monitoringRun';

const SECONDS_PER_DAY = 24 * 60 * 60;

export type OrchestrationDecision =
  | { action: 'plan'; planned_at: string }
  | { action: 'block'; reason: MonitoringBlockReason; detail: string };

/**
 * Compute the next planned run timestamp for a configuration. Deterministic;
 * given identical inputs always returns the same string. Returns null for
 * `manual_only` mode (no planned runs).
 */
export function computeNextPlannedRun(
  config: ListeningConfiguration,
  referenceTime: Date = new Date(),
): string | null {
  if (config.mode === 'manual_only') return null;
  const intervalMs = FREQUENCY_INTERVAL_HOURS[config.mode] * 60 * 60 * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const base = config.last_run_at ? new Date(config.last_run_at).getTime() : referenceTime.getTime();
  const next = new Date(base + intervalMs);
  // Floor to the minute so duplicate-planning detection (UNIQUE on
  // (org, planned_at)) doesn't drift on sub-second jitter.
  next.setSeconds(0, 0);
  return next.toISOString();
}

/**
 * Validate whether a planned run is permitted to fire. Pure read-only
 * check against the capability aggregate + the rolling 24-hour run window.
 * Returns either `action: 'plan'` (safe to record + later execute) or
 * `action: 'block'` with a structured reason.
 */
export async function evaluateOrchestrationDecision(args: {
  organizationId: string;
  configuration: ListeningConfiguration;
  referenceTime?: Date;
}): Promise<OrchestrationDecision> {
  const now = args.referenceTime ?? new Date();

  if (args.configuration.mode === 'manual_only') {
    return { action: 'block', reason: 'mode_manual_only', detail: 'configuration mode is manual_only' };
  }

  // Cooldown: refuse if the most recent run finished within cooldown_minutes.
  const cooldownMs = args.configuration.cooldown_minutes * 60 * 1000;
  if (args.configuration.last_run_at) {
    const last = new Date(args.configuration.last_run_at).getTime();
    if (now.getTime() - last < cooldownMs) {
      return {
        action: 'block',
        reason: 'cooldown_blocked',
        detail: `cooldown active for another ${Math.ceil((cooldownMs - (now.getTime() - last)) / 60000)} minute(s)`,
      };
    }
  }

  // Daily run ceiling: count today's runs (any status that consumed a slot).
  const dayStart = new Date(now.getTime() - SECONDS_PER_DAY * 1000).toISOString();
  const { count, error } = await ownedDbTable('monitoring_runs')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', args.organizationId)
    .gt('planned_at', dayStart)
    .in('status', ['planned', 'running', 'completed']);
  if (error) {
    return { action: 'block', reason: 'runaway_protection', detail: `daily count read failed: ${error.message}` };
  }
  const dailyCount = count ?? 0;
  if (dailyCount >= args.configuration.daily_run_ceiling) {
    return {
      action: 'block',
      reason: 'runaway_protection',
      detail: `daily_run_ceiling (${args.configuration.daily_run_ceiling}) reached`,
    };
  }

  // Per-platform eligibility — bypass the TTL cache for activation/orchestration.
  const aggregate = await buildCapabilityAggregate(args.organizationId);
  const offendingPlatforms: string[] = [];
  let consentBlocked = false;
  let scopeBlocked = false;
  let sourceNotReady = false;
  let capabilityDisabled = false;

  for (const platform of args.configuration.platforms) {
    const decision = evaluateMonitoringEligibility(aggregate, platform);
    if (decision.eligible) continue;
    offendingPlatforms.push(platform);
    for (const blocker of decision.blockers) {
      if (blocker.code === 'consent_not_active' || blocker.code === 'consent_stale') consentBlocked = true;
      else if (blocker.code === 'scope_insufficient') scopeBlocked = true;
      else if (blocker.code === 'no_ready_source') sourceNotReady = true;
      else if (blocker.code === 'listen_capability_not_enabled') capabilityDisabled = true;
    }
  }

  if (offendingPlatforms.length > 0) {
    const reason: MonitoringBlockReason =
      consentBlocked ? 'consent_blocked'
      : scopeBlocked ? 'scope_blocked'
      : sourceNotReady ? 'source_not_ready'
      : capabilityDisabled ? 'capability_disabled'
      : 'consent_blocked';
    return {
      action: 'block',
      reason,
      detail: `${offendingPlatforms.length} platform(s) ineligible: ${offendingPlatforms.join(',')}`,
    };
  }

  // Budget ceiling: if monthly_credit_ceiling > 0 and the rolling 30-day
  // spend already meets it, block. Phase 3 will tighten this against
  // actual ledger entries; Phase 2 reads what monitoring_runs has recorded.
  if (args.configuration.monthly_credit_ceiling > 0) {
    const monthStart = new Date(now.getTime() - 30 * SECONDS_PER_DAY * 1000).toISOString();
    const { data: monthly, error: monthErr } = await ownedDbTable('monitoring_runs')
      .select('credit_spent')
      .eq('organization_id', args.organizationId)
      .gt('planned_at', monthStart)
      .in('status', ['running', 'completed']);
    if (monthErr) {
      return { action: 'block', reason: 'runaway_protection', detail: `monthly spend read failed: ${monthErr.message}` };
    }
    const monthlySpend = (monthly ?? []).reduce(
      (sum, r) => sum + ((r as { credit_spent?: number }).credit_spent ?? 0),
      0,
    );
    if (monthlySpend + args.configuration.estimated_credits_per_run > args.configuration.monthly_credit_ceiling) {
      return {
        action: 'block',
        reason: 'budget_blocked',
        detail: `next-run estimate would exceed monthly ceiling (${monthlySpend}/${args.configuration.monthly_credit_ceiling} used)`,
      };
    }
  }

  // Permitted. Round planned_at to the minute to align with the unique
  // (org, planned_at) constraint used for duplicate-run protection.
  const plannedAt = new Date(now);
  plannedAt.setSeconds(0, 0);
  return { action: 'plan', planned_at: plannedAt.toISOString() };
}

/**
 * Record a monitoring_runs row reflecting an orchestration decision. For
 * `plan` decisions inserts status='planned'; for `block` decisions inserts
 * status='blocked' with the structured block_reason. Idempotency: the
 * (org, planned_at) UNIQUE constraint blocks duplicate inserts at the same
 * minute. On collision returns the existing row.
 */
export async function recordMonitoringRunDecision(args: {
  organizationId: string;
  configurationId: string;
  decision: OrchestrationDecision;
  referenceTime?: Date;
}): Promise<MonitoringRun> {
  const plannedAt =
    args.decision.action === 'plan'
      ? args.decision.planned_at
      : (args.referenceTime ?? new Date()).toISOString();

  const status: MonitoringRunStatus = args.decision.action === 'plan' ? 'planned' : 'blocked';
  const blockReason: MonitoringBlockReason | null =
    args.decision.action === 'block' ? args.decision.reason : null;

  const payload = {
    organization_id: args.organizationId,
    configuration_id: args.configurationId,
    planned_at: plannedAt,
    status,
    block_reason: blockReason,
    metadata: args.decision.action === 'block' ? { detail: args.decision.detail } : {},
  };

  const { data, error } = await ownedDbTable('monitoring_runs')
    .insert(payload)
    .select('*')
    .single();

  if (!error && data) return data as MonitoringRun;

  // Duplicate-run protection — the UNIQUE (org, planned_at) constraint
  // raised. Return the existing row so callers get deterministic behaviour.
  if (error?.code === '23505') {
    const { data: existing, error: lookupErr } = await ownedDbTable('monitoring_runs')
      .select('*')
      .eq('organization_id', args.organizationId)
      .eq('planned_at', plannedAt)
      .single();
    if (lookupErr || !existing) {
      throw new Error(`Duplicate-run protection triggered but existing row not found: ${lookupErr?.message ?? 'no data'}`);
    }
    return existing as MonitoringRun;
  }

  throw new Error(`Failed to record monitoring run decision: ${error?.message ?? 'unknown'}`);
}

/**
 * Operational diagnostics: counts of runs by status and block reason over
 * a rolling window. Powers the UI's "monitoring activity" surface.
 */
export type MonitoringStatusSnapshot = {
  organization_id: string;
  window_hours: number;
  generated_at: string;
  totals_by_status: Record<MonitoringRunStatus, number>;
  totals_by_block_reason: Record<string, number>;
  next_planned_run_at: string | null;
  last_completed_run_at: string | null;
};

export async function getMonitoringStatusSnapshot(
  organizationId: string,
  windowHours = 24 * 7,
): Promise<MonitoringStatusSnapshot> {
  const generatedAt = new Date();
  const windowStart = new Date(
    generatedAt.getTime() - windowHours * 60 * 60 * 1000,
  ).toISOString();

  const [runsResp, configResp] = await Promise.all([
    ownedDbTable('monitoring_runs')
      .select('status, block_reason, completed_at')
      .eq('organization_id', organizationId)
      .gt('planned_at', windowStart),
    ownedDbTable('listening_configurations')
      .select('next_planned_run_at')
      .eq('organization_id', organizationId)
      .maybeSingle(),
  ]);

  const runs = (runsResp.data ?? []) as Array<{
    status: MonitoringRunStatus;
    block_reason: string | null;
    completed_at: string | null;
  }>;

  const totals_by_status: Record<MonitoringRunStatus, number> = {
    planned: 0,
    blocked: 0,
    skipped: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  const totals_by_block_reason: Record<string, number> = {};
  let lastCompletedAt: string | null = null;

  for (const r of runs) {
    totals_by_status[r.status] = (totals_by_status[r.status] ?? 0) + 1;
    if (r.block_reason) {
      totals_by_block_reason[r.block_reason] = (totals_by_block_reason[r.block_reason] ?? 0) + 1;
    }
    if (r.status === 'completed' && r.completed_at) {
      if (!lastCompletedAt || r.completed_at > lastCompletedAt) {
        lastCompletedAt = r.completed_at;
      }
    }
  }

  return {
    organization_id: organizationId,
    window_hours: windowHours,
    generated_at: generatedAt.toISOString(),
    totals_by_status,
    totals_by_block_reason,
    next_planned_run_at: (configResp.data as { next_planned_run_at?: string | null } | null)?.next_planned_run_at ?? null,
    last_completed_run_at: lastCompletedAt,
  };
}

/**
 * Helper used by the activation flow. Computes whether the configuration
 * should be classified as "scheduled" for UI purposes. Useful so the panel
 * does not need to re-derive scheduling logic.
 */
export function isScheduledMode(mode: ListeningMode): boolean {
  return mode !== 'manual_only';
}
