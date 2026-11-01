/**
 * Journey report — business intelligence for one tenant workflow, per version.
 *
 * READ-ONLY and DESCRIPTIVE. It measures what happened; nothing reads it to decide
 * anything (outcome-driven adaptation is not authorized), and it keeps no store of
 * its own. Every number is derived from an existing canonical record:
 *
 *   enrollment & journey state   execution_instances (via the instance store)
 *   per-step decisions           execution_plan_steps (via the progression store)
 *   WS-3 actions & outcomes      outreach_bridge_handoffs → outreach_tasks /
 *                                outreach_outcomes (via the WS-3 readers)
 *   WhatsApp actions             execution_engine_requests (via its adapter's table)
 *   decisions                    execution_journey_decisions (via its writer's reader)
 *
 * Bounded: at most `limit` runs are read (newest first) and `truncated` says so.
 * COST is not reported: no engine records a per-action cost on main, and a number
 * invented here would be worse than its absence.
 */

import { getWorkflow, listWorkflowVersions } from '../workflows/workflowStore';
import { listWorkflowExecutionInstances, type ExecutionInstance } from '../executionInstances/executionInstanceStore';
import { getPlanForInstance, listInstanceTasks } from '../executionPlans/executionPlanStore';
import { listProgressionSteps } from '../workflowExecution/stepProgressionStore';
import { listInstanceHandoffs } from '../outreachBridge/outreachBridgeStore';
import { getOutreachTaskById, outcomeTypesFor } from '../leadOutreachExecution';
import { ownedDbTable } from '../../db/writeOwner';
import { ENGINE_REQUESTS_TABLE } from './whatsappEngineAdapter';
import { listJourneyDecisions } from './journeyDecisionLog';
import type { ObjectiveOutcome } from './journeyPolicy';

export interface StepReport {
  readonly stepKey: string;
  readonly channel: string;
  /** Count per plan-step state: pending / ready / completed / skipped / … */
  readonly states: Record<string, number>;
}

export interface VersionReport {
  readonly workflowVersionId: string;
  readonly version: number;
  readonly status: string;
  readonly objective: { statement: string; successOutcome: ObjectiveOutcome; targetRate: number | null } | null;
  readonly enrolled: number;
  /** Count per journey lifecycle state. */
  readonly journeys: Record<string, number>;
  readonly steps: readonly StepReport[];
  /** Engine → outcome → count (WS-3 task status, WhatsApp request state). */
  readonly engines: Record<string, Record<string, number>>;
  /** Decision → count, across this version's runs. */
  readonly decisions: Record<string, number>;
  /** Steps still waiting on a person: the operator's queue. Codes only. */
  readonly needsHuman: ReadonlyArray<{ executionInstanceId: string; stepKey: string | null; outcome: string | null; reasons: readonly string[] }>;
  /** Individuals who reached the version's success outcome, and the share of those enrolled. */
  readonly attainment: { reached: number; rate: number | null; target: number | null; measured: boolean; note: string | null };
}

export interface JourneyReport {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly generatedAt: string;
  readonly runsRead: number;
  readonly truncated: boolean;
  readonly versions: readonly VersionReport[];
  readonly notMeasured: readonly string[];
}

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** This tenant's WhatsApp request states by execution task (tenant-first, one read). */
async function whatsappRequestStates(organizationId: string): Promise<Map<string, string>> {
  const res = await ownedDbTable(ENGINE_REQUESTS_TABLE)
    .select('execution_task_id, state')
    .eq('organization_id', organizationId)
    .eq('engine', 'whatsapp')
    .limit(5000);
  const out = new Map<string, string>();
  if (res.error || !Array.isArray(res.data)) return out;
  for (const r of res.data as Array<Record<string, unknown>>) out.set(String(r.execution_task_id), String(r.state));
  return out;
}

export async function buildJourneyReport(input: {
  organizationId: string;
  workflowId: string;
  limit?: number;
  now?: string;
}): Promise<JourneyReport | null> {
  const workflow = await getWorkflow(input.organizationId, input.workflowId);
  if (workflow === null) return null;
  const limit = input.limit ?? 500;

  const [versions, runs, waStates] = await Promise.all([
    listWorkflowVersions(input.organizationId, input.workflowId),
    listWorkflowExecutionInstances(input.organizationId, input.workflowId, limit),
    whatsappRequestStates(input.organizationId),
  ]);

  const byVersion = new Map<string, ExecutionInstance[]>();
  for (const run of runs) {
    const list = byVersion.get(run.workflowVersionId) ?? [];
    list.push(run);
    byVersion.set(run.workflowVersionId, list);
  }

  const reports: VersionReport[] = [];
  for (const v of versions) {
    const vruns = byVersion.get(v.id) ?? [];
    const journeys: Record<string, number> = {};
    const steps = new Map<string, StepReport>();
    const engines: Record<string, Record<string, number>> = {};
    const successOutcome = v.definition.objective?.success_outcome ?? null;
    const decisionCounts: Record<string, number> = {};
    const needsHuman: Array<VersionReport['needsHuman'][number]> = [];
    let reached = 0;

    for (const run of vruns) {
      bump(journeys, run.lifecycleState);
      const plan = await getPlanForInstance(input.organizationId, run.id);
      if (plan === null) continue;
      const planSteps = await listProgressionSteps(input.organizationId, plan.id);
      for (const s of planSteps) {
        const sr = steps.get(s.stepKey) ?? { stepKey: s.stepKey, channel: s.channel, states: {} };
        bump(sr.states, s.state);
        steps.set(s.stepKey, sr);
      }
      const ready = planSteps.find((s) => s.state === 'ready') ?? null;
      const runDecisions = await listJourneyDecisions(input.organizationId, run.id);
      for (const d of runDecisions) bump(decisionCounts, d.decision);
      // Only the latest word on the step that is still open is the queue.
      const latest = ready === null ? null : runDecisions.filter((d) => d.planStepId === ready.id).pop() ?? null;
      if (latest !== null && latest.decision === 'needs_human') {
        needsHuman.push({ executionInstanceId: run.id, stepKey: latest.stepKey, outcome: latest.outcome, reasons: latest.reasons });
      }

      // WS-3: one handoff per bridged task; its outreach task status is the engine outcome.
      let personReached = false;
      for (const h of await listInstanceHandoffs(input.organizationId, run.id)) {
        const task = await getOutreachTaskById(input.organizationId, h.outreachTaskId);
        bump(engines.ws3 ??= {}, String(task?.status ?? 'unreadable'));
        if (successOutcome !== null && successOutcome !== 'step_completion') {
          const types = await outcomeTypesFor(input.organizationId, h.outreachTaskId);
          if ((types as string[]).includes(successOutcome)) personReached = true;
        }
      }
      // WhatsApp: the request ledger is keyed by execution task, which is per run.
      for (const t of await listInstanceTasks(input.organizationId, run.id)) {
        if (t.channel !== 'whatsapp') continue;
        bump(engines.whatsapp ??= {}, waStates.get(t.id) ?? 'not_requested');
      }
      if (successOutcome === 'step_completion' && run.lifecycleState === 'completed') personReached = true;
      if (personReached) reached += 1;
    }

    const objective = v.definition.objective
      ? { statement: v.definition.objective.statement, successOutcome: v.definition.objective.success_outcome, targetRate: v.definition.objective.target_rate ?? null }
      : null;
    reports.push({
      workflowVersionId: v.id,
      version: v.version,
      status: v.status,
      objective,
      enrolled: vruns.length,
      journeys,
      steps: [...steps.values()],
      engines,
      decisions: decisionCounts,
      needsHuman,
      attainment: {
        reached,
        rate: vruns.length > 0 && objective !== null ? reached / vruns.length : null,
        target: objective?.targetRate ?? null,
        measured: objective !== null,
        note: objective === null ? 'this version declares no objective' : null,
      },
    });
  }

  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    generatedAt: input.now ?? new Date().toISOString(),
    runsRead: runs.length,
    truncated: runs.length >= limit,
    versions: reports,
    notMeasured: ['cost — no engine records a per-action cost'],
  };
}
