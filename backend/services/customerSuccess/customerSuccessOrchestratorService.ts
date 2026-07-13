/**
 * customerSuccessOrchestratorService.ts — the ONE canonical Customer Success
 * Orchestrator authority (CSA-005).
 *
 * Gathers signals from the existing authorities — CSA-003 health (which composes
 * CSA-002 evolution, CSA-001 usage, readiness) and CSA-004 lifecycle — and runs
 * the pure orchestrator model to decide the next-best-actions per company. It is
 * a PURE read-model: no writes, no persistence, NO execution (no emails, no
 * workflows, no reminders — §6). Every future Customer Success capability
 * (automation, emails, reminders, CS dashboards, playbooks) consumes these
 * recommendations through this service — nothing else decides next-best-actions.
 */

import { recordRawCounter, recordRawHistogram } from '../../observability/metrics';
import {
  buildAllCustomerHealth,
  type HealthResult,
} from '../health/customerHealthService';
import { buildAllCustomerLifecycle } from '../lifecycle/customerLifecycleService';
import type { CustomerLifecycle } from '../../../lib/lifecycle/customerLifecycle';
import {
  orchestrateCustomerSuccess,
  type OrchestratorInputs,
  type CustomerSuccessPlan,
  type LifecycleStage,
} from '../../../lib/customerSuccess/nextBestActions';

/** Map a CSA-003 health result + CSA-004 lifecycle stage into orchestrator inputs. Pure. */
export function buildCustomerSuccessInputs(
  h: HealthResult,
  lifecycleStage: LifecycleStage,
  now: string,
  dismissedActionIds?: string[],
): OrchestratorInputs {
  return {
    companyId: h.health.companyId,
    now,
    platformReady: h.inputs.platformReady,
    lifecycleStage,
    healthScore: h.health.score,
    healthState: h.health.state,
    trajectory: h.inputs.trajectory,
    inactiveDays: h.health.risk.inactiveDays,
    areas: h.inputs.areas,
    usageActiveDays: h.inputs.usage.activeDays,
    capabilitiesUsed: h.inputs.usage.capabilitiesUsed,
    dismissedActionIds,
  };
}

export interface OrchestratorServiceDeps {
  buildHealth?: (opts: { now: string }) => Promise<HealthResult[]>;
  buildLifecycle?: (opts: { now: string; buildHealth: () => Promise<HealthResult[]> }) => Promise<CustomerLifecycle[]>;
  /** Optional per-company dismissed action ids (consumers persist dismissals; this model does not). */
  dismissedByCompany?: Map<string, string[]>;
  now?: string;
}

/**
 * Build the canonical Customer Success plan for every company. Deterministic and
 * pure (no writes). Builds health once and reuses it for lifecycle + orchestration.
 * Emits HARDEN observability. Fail-safe: returns [] on any error.
 */
export async function buildAllCustomerSuccessPlans(
  deps: OrchestratorServiceDeps = {},
): Promise<CustomerSuccessPlan[]> {
  const started = Date.now();
  const now = deps.now ?? new Date().toISOString();
  try {
    const buildHealth = deps.buildHealth ?? ((o: { now: string }) => buildAllCustomerHealth(o));
    const buildLifecycle = deps.buildLifecycle ?? ((o: { now: string; buildHealth: () => Promise<HealthResult[]> }) => buildAllCustomerLifecycle(o));

    const healths = await buildHealth({ now });
    if (healths.length === 0) return [];

    const lifecycles = await buildLifecycle({ now, buildHealth: async () => healths });
    const stageById = new Map(lifecycles.map((l) => [l.companyId, l.stage]));

    const plans = healths.map((h) => {
      const stage = stageById.get(h.health.companyId) ?? 'ONBOARDING';
      const dismissed = deps.dismissedByCompany?.get(h.health.companyId);
      return orchestrateCustomerSuccess(buildCustomerSuccessInputs(h, stage, now, dismissed));
    });

    emitObservability(plans);
    recordRawHistogram('csa.cs_orchestrator.duration_ms', Date.now() - started);
    return plans;
  } catch {
    recordRawCounter('csa.cs_orchestrator.failures', 1);
    recordRawHistogram('csa.cs_orchestrator.duration_ms', Date.now() - started);
    return [];
  }
}

/** §8 — action distribution, priority distribution, blocked + recommended counts. */
function emitObservability(plans: CustomerSuccessPlan[]): void {
  let blocked = 0;
  let recommended = 0;
  const nextAction: Record<string, number> = {};
  const priority: Record<string, number> = {};
  for (const p of plans) {
    recommended += p.recommendedActions.length;
    blocked += p.actions.filter((a) => a.state === 'BLOCKED').length;
    if (p.nextBestAction) {
      nextAction[p.nextBestAction.id] = (nextAction[p.nextBestAction.id] ?? 0) + 1;
      priority[p.nextBestAction.priorityTier] = (priority[p.nextBestAction.priorityTier] ?? 0) + 1;
    }
  }
  for (const [action, count] of Object.entries(nextAction)) recordRawCounter('csa.cs.next_action', count, { action });
  for (const [tier, count] of Object.entries(priority)) recordRawCounter('csa.cs.priority', count, { tier });
  recordRawCounter('csa.cs.blocked', blocked);
  recordRawCounter('csa.cs.recommended', recommended);
}

/**
 * The canonical per-company Customer Success plan. Fail-safe → null. Consumers
 * that need one company today compute the batch and select; a single-company
 * gather can be added if hot-path performance requires it.
 */
export async function getCustomerSuccessPlan(
  companyId: string,
  deps: OrchestratorServiceDeps = {},
): Promise<CustomerSuccessPlan | null> {
  try {
    const plans = await buildAllCustomerSuccessPlans(deps);
    return plans.find((p) => p.companyId === companyId) ?? null;
  } catch {
    return null;
  }
}
