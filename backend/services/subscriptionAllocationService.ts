/**
 * Subscription monthly credit allocation engine.
 *
 * Grants each plan's monthly credits into the PLAN / monthly pool (the `free`
 * credit category — consumed first) — NEVER into the top-up pool (`paid`,
 * never-expiring). Idempotent: a deterministic idempotency key per
 * (org, plan, billing period) means re-running a cycle never double-grants
 * (createCredit no-ops on the UNIQUE idempotency_key).
 *
 * Scope: allocation only. No payment gateway, no checkout, no subscription
 * purchase flow. Assumes a valid subscription (plan assignment) already exists.
 */
import { createCredit } from './creditExecutionService';
import { SYSTEM_USER_ID } from './auditActorService';
import { supabase } from '../db/supabaseClient';

/** SECTION A — plan credit rules. Monthly grant per plan_key. */
export const PLAN_MONTHLY_CREDITS: Record<string, number> = {
  starter: 300,
  growth: 700,
  business: 1400,
};

export const ALLOCATION_REFERENCE_TYPE = 'subscription_allocation';

export function getMonthlyCreditsForPlan(planKey: string | null | undefined): number | null {
  if (!planKey) return null;
  return PLAN_MONTHLY_CREDITS[planKey.toLowerCase()] ?? null;
}

/**
 * Billing-period start (UTC, YYYY-MM-DD) for the cycle containing `now`,
 * anchored to `anchorDay` (clamped to 1..28 to avoid short-month drift).
 */
export function computePeriodStart(now: Date, anchorDay = 1): string {
  const clamped = Math.min(Math.max(1, Math.floor(anchorDay)), 28);
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  if (now.getUTCDate() < clamped) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  return new Date(Date.UTC(y, m, clamped)).toISOString().slice(0, 10);
}

/** Next allocation date = period start + 1 month. */
export function computeNextAllocationDate(periodStart: string): string {
  const d = new Date(`${periodStart}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

export function buildAllocationKey(orgId: string, planKey: string | null, periodStart: string): string {
  return `monthly_alloc:${orgId}:${planKey ?? 'none'}:${periodStart}`;
}

export type AllocationStatusKind = 'allocated' | 'dry_run' | 'no_plan' | 'not_billable';

export interface AllocationResult {
  status: AllocationStatusKind;
  orgId: string;
  planKey: string | null;
  credits: number;
  periodStart: string;
  nextAllocationDate: string;
  idempotencyKey: string;
  referenceType: string;
}

async function resolvePlanKey(orgId: string): Promise<string | null> {
  const { data: assignment } = await supabase
    .from('organization_plan_assignments')
    .select('plan_id')
    .eq('organization_id', orgId)
    .maybeSingle();
  const planId = (assignment as { plan_id?: string } | null)?.plan_id;
  if (!planId) return null;
  const { data: plan } = await supabase.from('pricing_plans').select('plan_key').eq('id', planId).maybeSingle();
  return (plan as { plan_key?: string } | null)?.plan_key ?? null;
}

/**
 * SECTION B — allocate the current cycle's monthly credits into the plan pool,
 * idempotently. `dryRun` computes the result without granting (validation/preview).
 */
export async function allocateMonthlyCreditsForOrg(params: {
  orgId: string;
  planKey?: string | null;
  now?: Date;
  anchorDay?: number;
  performedBy?: string;
  dryRun?: boolean;
}): Promise<AllocationResult> {
  const { orgId } = params;
  const now = params.now ?? new Date();
  const planKey = params.planKey ?? (await resolvePlanKey(orgId));
  const credits = getMonthlyCreditsForPlan(planKey);
  const periodStart = computePeriodStart(now, params.anchorDay ?? 1);
  const nextAllocationDate = computeNextAllocationDate(periodStart);
  const idempotencyKey = buildAllocationKey(orgId, planKey, periodStart);
  const base = { orgId, planKey, periodStart, nextAllocationDate, idempotencyKey, referenceType: ALLOCATION_REFERENCE_TYPE };

  if (!planKey) return { ...base, status: 'no_plan', credits: 0 };
  if (!credits) return { ...base, status: 'not_billable', credits: 0 };
  if (params.dryRun) return { ...base, status: 'dry_run', credits };

  await createCredit({
    orgId,
    amount: credits,
    category: 'free', // PLAN / monthly pool — consumed first; NEVER 'paid' (top-up)
    referenceType: ALLOCATION_REFERENCE_TYPE,
    performedBy: params.performedBy ?? SYSTEM_USER_ID,
    idempotencyKey, // deterministic per (org, plan, period) → duplicate cycles are no-ops
    note: `Monthly ${planKey} allocation (${periodStart})`,
  });

  return { ...base, status: 'allocated', credits };
}

export interface AllocationSweepSummary {
  processed: number;
  allocated: number;
  skipped: number;
  dryRun: boolean;
  results: AllocationResult[];
}

/**
 * SECTION B (driver) — sweep active subscriptions and allocate the current
 * cycle. Idempotent end-to-end: safe to run daily; only the first run per cycle
 * grants. Pass `orgIds` to scope; omit to sweep all plan-assigned orgs.
 */
export async function runMonthlyAllocationSweep(params?: {
  orgIds?: string[];
  now?: Date;
  dryRun?: boolean;
}): Promise<AllocationSweepSummary> {
  const now = params?.now ?? new Date();
  const dryRun = params?.dryRun ?? false;

  let orgIds = params?.orgIds;
  if (!orgIds) {
    const { data } = await supabase.from('organization_plan_assignments').select('organization_id');
    orgIds = Array.from(new Set((data ?? []).map((r: { organization_id?: string }) => r.organization_id).filter(Boolean) as string[]));
  }

  const results: AllocationResult[] = [];
  for (const orgId of orgIds) {
    try {
      results.push(await allocateMonthlyCreditsForOrg({ orgId, now, dryRun }));
    } catch {
      /* per-org failure must not abort the sweep */
    }
  }
  const allocated = results.filter((r) => r.status === 'allocated' || r.status === 'dry_run').length;
  return { processed: results.length, allocated, skipped: results.length - allocated, dryRun, results };
}

/** SECTION D/E — allocation history + cycle status for the Billing Center. */
export interface AllocationHistoryRow {
  date: string;
  credits: number;
  cycle: string;
  referenceId: string | null;
}

export interface AllocationStatus {
  planKey: string | null;
  monthlyCredits: number | null;
  lastAllocationDate: string | null;
  nextAllocationDate: string | null;
  creditsGrantedThisCycle: number;
  history: AllocationHistoryRow[];
}

export async function getAllocationStatus(orgId: string, now: Date = new Date()): Promise<AllocationStatus> {
  const planKey = await resolvePlanKey(orgId);
  const monthlyCredits = getMonthlyCreditsForPlan(planKey);
  const periodStart = computePeriodStart(now);

  const { data } = await supabase
    .from('credit_transactions')
    .select('credits_delta, created_at, idempotency_key, reference_id')
    .eq('organization_id', orgId)
    .eq('reference_type', ALLOCATION_REFERENCE_TYPE)
    .gt('credits_delta', 0)
    .order('created_at', { ascending: false })
    .limit(24);

  const rows = (data ?? []) as Array<{ credits_delta: number; created_at: string; idempotency_key: string | null; reference_id: string | null }>;
  const cycleOf = (key: string | null) => String(key ?? '').split(':').pop() ?? '';

  const creditsGrantedThisCycle = rows
    .filter((r) => cycleOf(r.idempotency_key) === periodStart)
    .reduce((s, r) => s + Math.max(0, Number(r.credits_delta ?? 0)), 0);

  return {
    planKey,
    monthlyCredits,
    lastAllocationDate: rows[0]?.created_at ?? null,
    nextAllocationDate: computeNextAllocationDate(periodStart),
    creditsGrantedThisCycle,
    history: rows.map((r) => ({
      date: r.created_at,
      credits: Math.max(0, Number(r.credits_delta ?? 0)),
      cycle: cycleOf(r.idempotency_key),
      referenceId: r.reference_id ?? null,
    })),
  };
}
