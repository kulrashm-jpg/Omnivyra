/**
 * customerSuccessWorkspaceService.ts — the ONE canonical Customer Success
 * Workspace authority (CSA-007).
 *
 * PURE composition layer. It gathers the OUTPUTS of the existing authorities —
 * CSA-003 health, CSA-004 lifecycle, CSA-005 orchestrator, CSA-006 playbooks —
 * (building health once and reusing it) and reshapes them into the single
 * per-company workspace view. It introduces NO new intelligence, NO calculation,
 * NO orchestration, and performs NO execution and NO writes. Every future
 * Customer Success surface consumes this authority.
 */

import { recordRawCounter, recordRawHistogram } from '../../observability/metrics';
import { buildAllCustomerHealth, type HealthResult } from '../health/customerHealthService';
import { buildAllCustomerLifecycle } from '../lifecycle/customerLifecycleService';
import type { CustomerLifecycle } from '../../../lib/lifecycle/customerLifecycle';
import {
  orchestrateCustomerSuccess,
  type CustomerSuccessPlan,
  type LifecycleStage,
} from '../../../lib/customerSuccess/nextBestActions';
import { buildCustomerSuccessInputs } from './customerSuccessOrchestratorService';
import { buildPlaybookSet } from '../../../lib/customerSuccess/playbooks';
import {
  composeCustomerSuccessWorkspace,
  type CustomerSuccessWorkspace,
  type WorkspaceHealth,
  type WorkspaceLifecycle,
  type WorkspaceUsage,
} from '../../../lib/customerSuccess/workspace';

function integrationCoverageOf(h: HealthResult): number {
  return h.health.contributors.find((x) => x.key === 'integration')?.value ?? 0;
}

/** Project a CSA-003 health result → the workspace health/usage shapes. Pure. */
function healthOf(h: HealthResult): WorkspaceHealth {
  return {
    score: h.health.score,
    state: h.health.state,
    riskLevel: h.health.risk.level,
    majorContributors: h.health.explanation.majorContributors,
    recommendedImprovements: h.health.explanation.recommendedImprovements,
  };
}
function usageOf(h: HealthResult): WorkspaceUsage {
  return {
    totalEvents: h.inputs.usage.totalEvents,
    activeUsers: h.inputs.usage.activeUsers,
    activeDays: h.inputs.usage.activeDays,
    capabilitiesUsed: h.inputs.usage.capabilitiesUsed,
  };
}
/** Project a CSA-004 lifecycle → the workspace lifecycle shape. Pure. */
function lifecycleOf(l: CustomerLifecycle | undefined, fallbackStage: LifecycleStage): WorkspaceLifecycle {
  return {
    stage: l?.stage ?? fallbackStage,
    previousStage: l?.transition.from ?? null,
    transitionReason: l?.transition.reason ?? 'Initial lifecycle classification.',
    trajectory: l?.transition.trajectory ?? 'UNKNOWN',
    nextMilestone: l?.explanation.nextMilestone ?? '',
  };
}

export interface WorkspaceServiceDeps {
  buildHealth?: (opts: { now: string }) => Promise<HealthResult[]>;
  buildLifecycle?: (opts: { now: string; buildHealth: () => Promise<HealthResult[]> }) => Promise<CustomerLifecycle[]>;
  now?: string;
}

/**
 * Compose the workspace for every company. Deterministic and pure (no writes).
 * Builds health ONCE and reuses it for lifecycle + orchestration + playbooks +
 * composition. Emits HARDEN observability. Fail-safe: returns [] on any error.
 */
export async function buildAllCustomerSuccessWorkspaces(
  deps: WorkspaceServiceDeps = {},
): Promise<CustomerSuccessWorkspace[]> {
  const started = Date.now();
  const now = deps.now ?? new Date().toISOString();
  try {
    const buildHealth = deps.buildHealth ?? ((o: { now: string }) => buildAllCustomerHealth(o));
    const buildLifecycle = deps.buildLifecycle ?? ((o: { now: string; buildHealth: () => Promise<HealthResult[]> }) => buildAllCustomerLifecycle(o));

    const healths = await buildHealth({ now });
    if (healths.length === 0) return [];
    const lifecycles = await buildLifecycle({ now, buildHealth: async () => healths });
    const lifeById = new Map(lifecycles.map((l) => [l.companyId, l]));

    const workspaces = healths.map((h) => {
      const life = lifeById.get(h.health.companyId);
      const stage = (life?.stage ?? 'ONBOARDING') as LifecycleStage;
      const plan: CustomerSuccessPlan = orchestrateCustomerSuccess(buildCustomerSuccessInputs(h, stage, now));
      const playbookSet = buildPlaybookSet(plan);
      return composeCustomerSuccessWorkspace({
        companyId: h.health.companyId,
        now,
        health: healthOf(h),
        platformReady: h.inputs.platformReady,
        readinessScore: h.inputs.readinessScore,
        usage: usageOf(h),
        lifecycle: lifecycleOf(life, stage),
        plan,
        playbookSet,
      });
    });

    recordRawCounter('csa.workspace.built', workspaces.length);
    recordRawHistogram('csa.workspace.duration_ms', Date.now() - started);
    return workspaces;
  } catch {
    recordRawCounter('csa.workspace.failures', 1);
    recordRawHistogram('csa.workspace.duration_ms', Date.now() - started);
    return [];
  }
}

/** The canonical per-company workspace. Fail-safe → null. */
export async function getCustomerSuccessWorkspace(
  companyId: string,
  deps: WorkspaceServiceDeps = {},
): Promise<CustomerSuccessWorkspace | null> {
  try {
    const all = await buildAllCustomerSuccessWorkspaces(deps);
    return all.find((w) => w.companyId === companyId) ?? null;
  } catch {
    return null;
  }
}

// ── §8 interaction telemetry (reuse HARDEN observability; no writes) ─────────
export type WorkspaceTelemetryEvent = 'opened' | 'section_view' | 'playbook_open';

/** Emit a workspace interaction metric. Fail-safe; emits nothing but a counter. */
export function recordWorkspaceTelemetry(event: WorkspaceTelemetryEvent, label?: string): void {
  switch (event) {
    case 'opened': recordRawCounter('csa.workspace.opened', 1); break;
    case 'section_view': recordRawCounter('csa.workspace.section_view', 1, label ? { section: label } : {}); break;
    case 'playbook_open': recordRawCounter('csa.workspace.playbook_open', 1, label ? { playbook: label } : {}); break;
  }
}
