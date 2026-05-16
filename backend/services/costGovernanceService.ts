/**
 * Phase 8 — Cost governance.
 *
 * Per-category budgets with soft / hard ceilings. Callers consult
 * `evaluateCost` BEFORE spending, then `recordCost` AFTER. Threshold
 * alerts fire via the realtime publisher (best-effort).
 *
 * Hard guarantees:
 *   • Deterministic decision: same (window spend, ceilings, incoming
 *     units) → same (decision, reasons).
 *   • Overage approvals are recorded as cost_events with
 *     `decision = 'overage_approved'` and require an explicit operator
 *     action — no auto-approval loop.
 *   • Tenant-scoped throughout.
 *   • Anomaly detection is rolling-window standard deviation; bounded.
 */

import { ownedDbTable } from '../db/writeOwner';
import type {
  CostBudget,
  CostCategory,
  CostDecision,
  CostEvent,
} from '../types/costGovernance';
import { COST_BUDGET_WINDOW_MS } from '../types/costGovernance';

async function loadBudget(
  organizationId: string,
  category: CostCategory,
): Promise<CostBudget | null> {
  const { data } = await ownedDbTable('cost_budgets')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('category', category)
    .maybeSingle();
  return (data as CostBudget | null) ?? null;
}

async function rollingSpend(
  organizationId: string,
  category: CostCategory,
): Promise<number> {
  const since = new Date(Date.now() - COST_BUDGET_WINDOW_MS).toISOString();
  const { data } = await ownedDbTable('cost_events')
    .select('units')
    .eq('organization_id', organizationId)
    .eq('category', category)
    .gt('created_at', since)
    .in('decision', ['allowed', 'overage_approved']);
  return ((data ?? []) as Array<{ units: number }>).reduce(
    (acc, r) => acc + Math.max(0, r.units),
    0,
  );
}

export type CostDecisionResult = {
  decision: CostDecision;
  reasons: string[];
  budget: CostBudget | null;
  current_spend: number;
  projected_spend: number;
  alert_triggered: boolean;
};

export async function evaluateCost(args: {
  organizationId: string;
  category: CostCategory;
  units: number;
}): Promise<CostDecisionResult> {
  if (args.units <= 0) {
    return {
      decision: 'allowed',
      reasons: ['zero_or_negative_units'],
      budget: null,
      current_spend: 0,
      projected_spend: 0,
      alert_triggered: false,
    };
  }
  const budget = await loadBudget(args.organizationId, args.category);
  const current = await rollingSpend(args.organizationId, args.category);
  const projected = current + args.units;
  const reasons: string[] = [];
  let decision: CostDecision = 'allowed';
  let alert = false;

  if (!budget || !budget.enabled) {
    return { decision: 'allowed', reasons: ['no_active_budget'], budget, current_spend: current, projected_spend: projected, alert_triggered: false };
  }

  if (budget.monthly_hard_ceiling > 0 && projected > budget.monthly_hard_ceiling) {
    decision = 'denied';
    reasons.push(`hard_ceiling_exceeded:${projected}>${budget.monthly_hard_ceiling}`);
  } else if (budget.monthly_soft_ceiling > 0 && projected > budget.monthly_soft_ceiling) {
    decision = 'warned';
    reasons.push(`soft_ceiling_exceeded:${projected}>${budget.monthly_soft_ceiling}`);
  }

  const alertLevel = budget.monthly_hard_ceiling > 0
    ? (budget.monthly_hard_ceiling * (budget.alert_threshold_percent / 100))
    : Number.POSITIVE_INFINITY;
  if (projected >= alertLevel && current < alertLevel) {
    alert = true;
    reasons.push(`alert_threshold_reached:${budget.alert_threshold_percent}%`);
  }

  return {
    decision,
    reasons,
    budget,
    current_spend: current,
    projected_spend: projected,
    alert_triggered: alert,
  };
}

export type RecordCostInput = {
  organizationId: string;
  category: CostCategory;
  units: number;
  decision?: CostDecision;
  reasons?: string[];
  attributionKind?: string | null;
  attributionRef?: string | null;
  metadata?: Record<string, unknown>;
};

export async function recordCost(input: RecordCostInput): Promise<CostEvent> {
  const { data, error } = await ownedDbTable('cost_events')
    .insert({
      organization_id: input.organizationId,
      category: input.category,
      units: input.units,
      decision: input.decision ?? 'allowed',
      reasons: input.reasons ?? [],
      attribution_kind: input.attributionKind ?? null,
      attribution_ref: input.attributionRef ?? null,
      metadata: input.metadata ?? {},
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(`cost_event_insert_failed:${error?.message ?? 'unknown'}`);
  return data as CostEvent;
}

export async function upsertBudget(input: {
  organizationId: string;
  category: CostCategory;
  monthlySoftCeiling: number;
  monthlyHardCeiling: number;
  alertThresholdPercent: number;
  enabled: boolean;
  createdBy: string | null;
}): Promise<CostBudget> {
  const payload = {
    organization_id: input.organizationId,
    category: input.category,
    monthly_soft_ceiling: Math.max(0, Math.floor(input.monthlySoftCeiling)),
    monthly_hard_ceiling: Math.max(input.monthlySoftCeiling, Math.floor(input.monthlyHardCeiling)),
    alert_threshold_percent: Math.max(1, Math.min(100, Math.floor(input.alertThresholdPercent))),
    enabled: input.enabled,
    created_by: input.createdBy,
  };
  const { data: existing } = await ownedDbTable('cost_budgets')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('category', input.category)
    .maybeSingle();
  if (existing && (existing as { id?: string }).id) {
    const { data, error } = await ownedDbTable('cost_budgets')
      .update(payload)
      .eq('id', (existing as { id: string }).id)
      .select('*')
      .single();
    if (error || !data) throw new Error(`cost_budget_update_failed:${error?.message ?? 'unknown'}`);
    return data as CostBudget;
  }
  const { data, error } = await ownedDbTable('cost_budgets')
    .insert(payload)
    .select('*')
    .single();
  if (error || !data) throw new Error(`cost_budget_insert_failed:${error?.message ?? 'unknown'}`);
  return data as CostBudget;
}

export async function listBudgets(organizationId: string): Promise<CostBudget[]> {
  const { data, error } = await ownedDbTable('cost_budgets')
    .select('*')
    .eq('organization_id', organizationId)
    .order('category', { ascending: true });
  if (error) throw new Error(`cost_budgets_list_failed:${error.message}`);
  return (data as CostBudget[]) ?? [];
}

export type CostSnapshot = {
  organization_id: string;
  generated_at: string;
  per_category: Array<{
    category: CostCategory;
    current_spend: number;
    soft_ceiling: number;
    hard_ceiling: number;
    soft_pct: number;
    hard_pct: number;
    enabled: boolean;
    anomaly_score: number;
  }>;
};

export async function getCostSnapshot(organizationId: string): Promise<CostSnapshot> {
  const budgets = await listBudgets(organizationId);
  const since = new Date(Date.now() - COST_BUDGET_WINDOW_MS).toISOString();
  const { data: events } = await ownedDbTable('cost_events')
    .select('category, units, created_at, decision')
    .eq('organization_id', organizationId)
    .gt('created_at', since)
    .in('decision', ['allowed', 'overage_approved']);
  const byCategory = new Map<string, number[]>();
  for (const e of (events ?? []) as Array<{ category: string; units: number }>) {
    const arr = byCategory.get(e.category) ?? [];
    arr.push(e.units);
    byCategory.set(e.category, arr);
  }
  const perCategory = budgets.map((b) => {
    const arr = byCategory.get(b.category) ?? [];
    const spend = arr.reduce((acc, v) => acc + v, 0);
    const mean = arr.length > 0 ? spend / arr.length : 0;
    const variance = arr.length > 0 ? arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length : 0;
    const std = Math.sqrt(variance);
    const anomaly = arr.length > 0 && std > 0
      ? Math.max(...arr.map((v) => Math.abs(v - mean) / std))
      : 0;
    return {
      category: b.category,
      current_spend: spend,
      soft_ceiling: b.monthly_soft_ceiling,
      hard_ceiling: b.monthly_hard_ceiling,
      soft_pct: b.monthly_soft_ceiling > 0 ? Number((spend / b.monthly_soft_ceiling).toFixed(3)) : 0,
      hard_pct: b.monthly_hard_ceiling > 0 ? Number((spend / b.monthly_hard_ceiling).toFixed(3)) : 0,
      enabled: b.enabled,
      anomaly_score: Number(anomaly.toFixed(3)),
    };
  });
  return {
    organization_id: organizationId,
    generated_at: new Date().toISOString(),
    per_category: perCategory,
  };
}
