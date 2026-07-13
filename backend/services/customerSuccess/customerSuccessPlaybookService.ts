/**
 * customerSuccessPlaybookService.ts — the ONE canonical Customer Success Playbook
 * authority (CSA-006).
 *
 * Consumes the CSA-005 orchestrator (buildAllCustomerSuccessPlans) and translates
 * each plan's next-best-actions into deterministic playbooks. It is a PURE
 * read-model: no writes, no persistence, NO execution (no reminders, no emails,
 * no automation — §6). Every future capability (dashboard, automation, email,
 * assistant, customer success) consumes playbooks through this service —
 * nothing else defines customer guidance.
 */

import { recordRawCounter, recordRawHistogram } from '../../observability/metrics';
import {
  buildAllCustomerSuccessPlans,
  type OrchestratorServiceDeps,
} from './customerSuccessOrchestratorService';
import type { CustomerSuccessPlan } from '../../../lib/customerSuccess/nextBestActions';
import { buildPlaybookSet, type PlaybookSet } from '../../../lib/customerSuccess/playbooks';

/** An "available" playbook = its action is actionable now (not blocked/completed/dismissed/deferred). */
const AVAILABLE: ReadonlySet<string> = new Set(['AVAILABLE']);

export interface PlaybookServiceDeps extends OrchestratorServiceDeps {
  /** Inject the orchestrator batch directly (tests / composition). */
  buildPlans?: (deps: OrchestratorServiceDeps) => Promise<CustomerSuccessPlan[]>;
}

/**
 * Build the canonical playbook set for every company. Deterministic and pure (no
 * writes). Reuses the CSA-005 orchestrator. Emits HARDEN observability. Fail-safe:
 * returns [] on any error.
 */
export async function buildAllCustomerSuccessPlaybooks(
  deps: PlaybookServiceDeps = {},
): Promise<PlaybookSet[]> {
  const started = Date.now();
  try {
    const buildPlans = deps.buildPlans ?? buildAllCustomerSuccessPlans;
    const plans = await buildPlans(deps);
    const sets = plans.map((p) => buildPlaybookSet(p));

    emitObservability(sets);
    recordRawHistogram('csa.playbook.duration_ms', Date.now() - started);
    return sets;
  } catch {
    recordRawCounter('csa.playbook.failures', 1);
    recordRawHistogram('csa.playbook.duration_ms', Date.now() - started);
    return [];
  }
}

/** §8 — playbook distribution, step distribution, completion potential. */
function emitObservability(sets: PlaybookSet[]): void {
  const recommended: Record<string, number> = {};
  let recommendedSteps = 0;
  let completionPotential = 0; // playbooks that are actionable now across the portfolio
  for (const s of sets) {
    if (s.recommendedPlaybook) {
      recommended[s.recommendedPlaybook.id] = (recommended[s.recommendedPlaybook.id] ?? 0) + 1;
      recommendedSteps += s.recommendedPlaybook.steps.length;
    }
    completionPotential += s.playbooks.filter((p) => AVAILABLE.has(p.status)).length;
  }
  for (const [id, count] of Object.entries(recommended)) recordRawCounter('csa.playbook.distribution', count, { playbook: id });
  recordRawCounter('csa.playbook.recommended_steps', recommendedSteps);
  recordRawCounter('csa.playbook.completion_potential', completionPotential);
}

/**
 * The canonical per-company playbook set. Fail-safe → null. Consumers that need
 * one company today compute the batch and select; a single-company gather can be
 * added if hot-path performance requires it.
 */
export async function getCustomerSuccessPlaybooks(
  companyId: string,
  deps: PlaybookServiceDeps = {},
): Promise<PlaybookSet | null> {
  try {
    const sets = await buildAllCustomerSuccessPlaybooks(deps);
    return sets.find((s) => s.companyId === companyId) ?? null;
  } catch {
    return null;
  }
}
