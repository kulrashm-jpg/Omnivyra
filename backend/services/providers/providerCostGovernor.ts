/**
 * Canonical Provider Cost Governor
 * --------------------------------
 * THE single authorization gate for external-provider calls. Every paid provider
 * call passes through `authorizeProviderCall` before dispatch and reports through
 * `recordProviderUsage` after. Wired into the universal provider HTTP primitive
 * (intelligence/productionPrimitives.fetchProduction) so no intelligence provider
 * can bypass it. LLM CHAT COMPLETIONS are governed separately by aiGateway (its
 * own tuned budget/rate stack) — this governor does not double-gate that path;
 * it governs the provider-adapter/visibility layer.
 *
 * Controls:
 *   • Emergency kill switch — global + per-provider (env, hard, instant)
 *   • Dry-run mode — global (env): authorization is refused so no real paid call
 *     fires; the intended call is logged instead
 *   • Per-provider daily + monthly unit budgets (env ceilings)
 *   • Usage logging — structured log always; delegated to the canonical
 *     costGovernanceService (cost_events) when a tenant is in scope
 *
 * SAFE BY CONSTRUCTION: kill-switch and dry-run are deterministic env reads.
 * Budget accounting is best-effort and FAIL-OPEN — a governor/store error never
 * blocks a real provider call (only an explicit kill/dry-run/exceeded-budget
 * does). This prevents the cost layer from becoming an availability risk.
 */

import { getProviderDescriptor } from './providerCatalog';
import { recordCost } from '../costGovernanceService';

const truthy = (v: string | undefined): boolean =>
  v === '1' || v === 'true' || v === 'on' || v === 'yes';

const envSuffix = (providerId: string): string => providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');

export function isGlobalKill(): boolean {
  return truthy(process.env.PROVIDER_GOVERNOR_KILL_SWITCH);
}

export function isProviderKilled(providerId: string): boolean {
  if (isGlobalKill()) return true;
  return truthy(process.env[`PROVIDER_KILL_${envSuffix(providerId)}`]);
}

export function isDryRun(): boolean {
  return truthy(process.env.PROVIDER_GOVERNOR_DRY_RUN);
}

interface Ceilings {
  daily: number | null;
  monthly: number | null;
}

function ceilingsFor(providerId: string): Ceilings {
  const s = envSuffix(providerId);
  const daily = Number(process.env[`PROVIDER_BUDGET_${s}_DAILY`]);
  const monthly = Number(process.env[`PROVIDER_BUDGET_${s}_MONTHLY`]);
  return {
    daily: Number.isFinite(daily) && daily > 0 ? daily : null,
    monthly: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
  };
}

// ── Lightweight in-process spend counters (per-instance) ─────────────────────
// Cluster-global windowed accounting is delegated to costGovernanceService when
// a tenant is in scope; the orgless HTTP-primitive path uses these per-instance
// counters as a best-effort backstop (documented limitation).
interface Counter {
  dayKey: string;
  dayUnits: number;
  monthKey: string;
  monthUnits: number;
}
const counters = new Map<string, Counter>();

function windowKeys(now: Date): { day: string; month: string } {
  const iso = now.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

function currentSpend(providerId: string, now: Date): { daily: number; monthly: number } {
  const { day, month } = windowKeys(now);
  const c = counters.get(providerId);
  if (!c) return { daily: 0, monthly: 0 };
  return {
    daily: c.dayKey === day ? c.dayUnits : 0,
    monthly: c.monthKey === month ? c.monthUnits : 0,
  };
}

function addSpend(providerId: string, units: number, now: Date): void {
  const { day, month } = windowKeys(now);
  const c = counters.get(providerId) ?? { dayKey: day, dayUnits: 0, monthKey: month, monthUnits: 0 };
  c.dayUnits = c.dayKey === day ? c.dayUnits + units : units;
  c.dayKey = day;
  c.monthUnits = c.monthKey === month ? c.monthUnits + units : units;
  c.monthKey = month;
  counters.set(providerId, c);
}

export interface AuthorizeInput {
  providerId: string;
  /** Tenant, when the caller has it (enables cost_events accounting). */
  organizationId?: string | null;
  /** Estimated cost units for this call (default 1). */
  estimatedUnits?: number;
  operation?: string;
}

export interface GovernorDecision {
  allowed: boolean;
  killed: boolean;
  dryRun: boolean;
  reason: string;
  remaining: { daily: number | null; monthly: number | null };
}

/**
 * Authorize a provider call. Returns allowed=false when killed, in dry-run, or
 * over budget. Never throws.
 */
export function authorizeProviderCall(input: AuthorizeInput): GovernorDecision {
  const units = input.estimatedUnits && input.estimatedUnits > 0 ? input.estimatedUnits : 1;
  try {
    if (isProviderKilled(input.providerId)) {
      return { allowed: false, killed: true, dryRun: false, reason: 'kill_switch', remaining: { daily: 0, monthly: 0 } };
    }
    if (isDryRun()) {
      return { allowed: false, killed: false, dryRun: true, reason: 'dry_run', remaining: { daily: null, monthly: null } };
    }
    const ceilings = ceilingsFor(input.providerId);
    if (ceilings.daily === null && ceilings.monthly === null) {
      // No ceiling configured → no spend read (hot path stays allocation-free).
      return { allowed: true, killed: false, dryRun: false, reason: 'allowed', remaining: { daily: null, monthly: null } };
    }
    const now = new Date();
    const spend = currentSpend(input.providerId, now);
    const remainingDaily = ceilings.daily === null ? null : Math.max(0, ceilings.daily - spend.daily);
    const remainingMonthly = ceilings.monthly === null ? null : Math.max(0, ceilings.monthly - spend.monthly);
    if (ceilings.daily !== null && spend.daily + units > ceilings.daily) {
      return { allowed: false, killed: false, dryRun: false, reason: 'daily_budget_exceeded', remaining: { daily: remainingDaily, monthly: remainingMonthly } };
    }
    if (ceilings.monthly !== null && spend.monthly + units > ceilings.monthly) {
      return { allowed: false, killed: false, dryRun: false, reason: 'monthly_budget_exceeded', remaining: { daily: remainingDaily, monthly: remainingMonthly } };
    }
    return { allowed: true, killed: false, dryRun: false, reason: 'allowed', remaining: { daily: remainingDaily, monthly: remainingMonthly } };
  } catch {
    // Fail-open: a governor bug must never take providers offline.
    return { allowed: true, killed: false, dryRun: false, reason: 'governor_error_fail_open', remaining: { daily: null, monthly: null } };
  }
}

// ── Per-provider outcome tracker (last success / last failure) ───────────────
// In-process (per-instance) last-outcome timestamps surfaced by the canonical
// health service. Fail-soft, no I/O.
interface Outcome {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}
const outcomes = new Map<string, Outcome>();

/** Record a provider call's terminal outcome (success/failure). Never throws. */
export function recordProviderOutcome(providerId: string, ok: boolean, reason?: string): void {
  try {
    const nowIso = new Date().toISOString();
    const cur = outcomes.get(providerId) ?? { lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null };
    if (ok) cur.lastSuccessAt = nowIso;
    else {
      cur.lastFailureAt = nowIso;
      cur.lastFailureReason = reason ?? null;
    }
    outcomes.set(providerId, cur);
  } catch {
    /* fail-soft */
  }
}

export function getProviderOutcome(providerId: string): Outcome {
  return outcomes.get(providerId) ?? { lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null };
}

export interface RecordInput {
  providerId: string;
  organizationId?: string | null;
  units?: number;
  costUsd?: number | null;
  operation?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record a provider call's usage. Never throws. Structured log always; the
 * canonical cost_events ledger when a tenant is in scope (best-effort).
 */
export async function recordProviderUsage(input: RecordInput): Promise<void> {
  const units = input.units && input.units > 0 ? input.units : 1;
  try {
    addSpend(input.providerId, units, new Date());
    const descriptor = getProviderDescriptor(input.providerId);
    // Canonical structured usage log (always emitted; grep [PROVIDER-GOVERNOR]).
    console.log(
      `[PROVIDER-GOVERNOR] ${JSON.stringify({
        provider: input.providerId,
        units,
        cost_usd: input.costUsd ?? null,
        operation: input.operation ?? null,
        organization_id: input.organizationId ?? null,
      })}`,
    );
    // Delegate windowed accounting to the canonical ledger when we have a tenant.
    if (input.organizationId && descriptor) {
      await recordCost({
        organizationId: input.organizationId,
        category: descriptor.costCategory,
        units,
        decision: 'allowed',
        attributionKind: 'provider',
        attributionRef: input.providerId,
        metadata: { operation: input.operation ?? null, cost_usd: input.costUsd ?? null, ...(input.metadata ?? {}) },
      });
    }
  } catch {
    /* fail-soft: usage logging must never break the caller */
  }
}
