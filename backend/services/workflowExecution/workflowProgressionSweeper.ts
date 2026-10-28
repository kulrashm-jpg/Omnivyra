/**
 * The workflow execution progression sweeper — the orchestrator's clock hand.
 *
 * PORTED from the parked PI program (refs/preserve/wt/pi-consol, PI-041-A-I/A-K)
 * and extended for multi-engine, individual-aware journeys (2026-10-28).
 *
 * ─── IT OWNS TIME AND THE JOURNEY, NOT EXECUTION ──────────────────────────
 * For each tenant run it asks the database which step is due (`advance_execution_plan`
 * is the only clock — no second scheduler), then, for the one ready step:
 *
 *   1. reads the individual's facts (individualIntelligence.ts — canonical sources);
 *   2. applies the step's IMPLICIT channel permission and its authored `when`
 *      conditions — if they do not hold, the step is SKIPPED: "no suitable
 *      action for this person" is a recorded decision, and the journey continues;
 *   3. applies the version's frequency policy — if the person was contacted too
 *      recently, the step WAITS (it is retried by a later sweep);
 *   4. hands the step to the channel's engine adapter (engineAdapters.ts), which
 *      asks the EXISTING engine to act; the engine's own gates stay authoritative;
 *   5. settles the step from the engine's disposition: `completed` or `skipped`
 *      advance the journey; `wait` and `needs_human` leave it ready.
 *
 * ─── WHAT IT NEVER DOES ───────────────────────────────────────────────────
 * It never approves, never overrides an opt-out or suppression, never retries an
 * action that may already have happened, never chooses `failed` (an absorbing
 * state reserved for a person), and never reads an outcome to change a decision —
 * outcome-driven adaptation is not authorized.
 *
 * ─── CONCURRENCY ──────────────────────────────────────────────────────────
 * `advance_execution_plan` locks the run; step transitions are compare-and-set; the
 * WS-3 bridge and the engine-request ledger are unique per execution task; and
 * engines claim before sending. Two sweeps over the same run converge.
 */
import { advanceExecutionRun, getReadyStep, transitionPlanStep } from './stepProgressionStore';
import {
  getPlanForInstance, lastCompletedActionAtForSubject, listInstanceTasks,
} from '../executionPlans/executionPlanStore';
import { listExecutionInstanceIdsInStates } from '../executionInstances/executionInstanceStore';
import { ownedDbTable } from '../../db/writeOwner';
import { recordProgressionSweep } from '../leadOutreachExecution/telemetry';
import { logger } from '../logger';
import {
  buildAdapterRegistry, createWs3Adapter, type EngineAdapter, type EngineResult,
} from '../orchestration/engineAdapters';
import { createWhatsAppAdapter } from '../orchestration/whatsappEngineAdapter';
import { loadIndividualFacts, type IndividualIntelligencePort } from '../orchestration/individualIntelligence';
import {
  channelPermissionFact, evaluateConditions, hoursBetween, type JourneyCondition,
} from '../orchestration/journeyPolicy';
import type { WorkflowDefinition, WorkflowStep } from '../workflows/workflowStore';

const CONFIG_TABLE = 'outreach_governance_config';

/** Lifecycle states in which a run may still make work eligible. `paused` is excluded: a pause is real. */
export const OCCUPIED_LIFECYCLE_STATES = ['created', 'queued', 'active'] as const;

/** Channels with an engine adapter. Everything else is visible as unsupported, never re-routed. */
export const ROUTED_CHANNELS = ['internal', 'email', 'whatsapp'] as const;
export type RoutedChannel = typeof ROUTED_CHANNELS[number];

/**
 * Bounds. Every invocation is finite, and reaching a bound is REPORTED rather than
 * hidden, so an operator can tell "nothing was due" from "we ran out of budget".
 */
export const SWEEP_LIMITS = {
  tenants: 25,
  instancesPerTenant: 50,
  tasksPerTenant: 25,
} as const;

export interface SweepCounters {
  instances_scanned: number;
  steps_advanced: number;
  tasks_seen: number;
  /** Steps settled `completed` because an engine executed the action. */
  steps_settled: number;
  /** Steps settled `skipped`: a condition, a permission or a human said no. */
  steps_skipped: number;
  /** Ready steps left for later by the frequency policy. */
  tasks_deferred_frequency: number;
  /** Ready steps an engine is still working on, or awaiting approval. */
  tasks_waiting: number;
  /** Ready steps an engine reported only a person can resolve. */
  tasks_needing_human: number;
  unsupported_channels: number;
  settlement_converged: number;
  errors: number;
}

export interface SweepIssue {
  readonly scope: 'tenant' | 'instance' | 'task';
  readonly organizationId: string;
  readonly id: string | null;
  readonly code: string;
  readonly message: string;
}

/** One journey decision, for the operator report. Codes only — never personal data. */
export interface JourneyDecision {
  readonly executionInstanceId: string;
  readonly planStepId: string;
  readonly stepKey: string;
  readonly channel: string;
  readonly engine: string | null;
  readonly decision: 'executed' | 'skipped' | 'deferred' | 'waiting' | 'needs_human' | 'unsupported';
  readonly outcome: string | null;
  readonly reasons: readonly string[];
}

export interface TenantSweepResult {
  readonly organizationId: string;
  readonly counters: SweepCounters;
  readonly outcomes: Record<string, number>;
  readonly unsupported: readonly string[];
  readonly decisions: readonly JourneyDecision[];
  readonly issues: readonly SweepIssue[];
  /** True when a bound stopped the work, so the next invocation has more to do. */
  readonly workRemains: boolean;
}

export interface SweepReport {
  readonly ranAt: string;
  readonly tenantsConsidered: number;
  readonly tenants: readonly TenantSweepResult[];
  readonly counters: SweepCounters;
  readonly issues: readonly SweepIssue[];
  readonly workRemains: boolean;
}

const zero = (): SweepCounters => ({
  instances_scanned: 0, steps_advanced: 0, tasks_seen: 0, steps_settled: 0, steps_skipped: 0,
  tasks_deferred_frequency: 0, tasks_waiting: 0, tasks_needing_human: 0,
  unsupported_channels: 0, settlement_converged: 0, errors: 0,
});

const add = (a: SweepCounters, b: SweepCounters): SweepCounters => {
  const out = zero();
  for (const k of Object.keys(out) as Array<keyof SweepCounters>) out[k] = a[k] + b[k];
  return out;
};

const errText = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);
const errCode = (e: unknown): string =>
  String((e as { code?: string } | null)?.code ?? 'unexpected_error');

/** Injected seams: the engines and the facts source. Defaults are the real ones. */
export interface SweeperDeps {
  readonly adapters: readonly EngineAdapter[];
  readonly intelligence?: IndividualIntelligencePort;
}

let defaultAdapters: readonly EngineAdapter[] | null = null;
const realAdapters = (): readonly EngineAdapter[] =>
  (defaultAdapters ??= [createWs3Adapter(), createWhatsAppAdapter()]);

/** The authored step and the run's policy, from the plan's FROZEN definition snapshot. */
function readSnapshot(snapshot: unknown, stepKey: string): { step: WorkflowStep | null; definition: WorkflowDefinition | null } {
  const def = (snapshot && typeof snapshot === 'object' ? snapshot : null) as WorkflowDefinition | null;
  const steps = Array.isArray(def?.steps) ? def!.steps : [];
  return { step: steps.find((s) => s && s.key === stepKey) ?? null, definition: def };
}

/**
 * Settle a ready step. Convergence (another actor moved it first) is counted, not
 * treated as an error, and never overwrites that actor's decision.
 */
async function settleStep(
  organizationId: string,
  planStepId: string,
  state: 'completed' | 'skipped',
  counters: SweepCounters,
  issues: SweepIssue[],
): Promise<void> {
  try {
    const settled = await transitionPlanStep({ organizationId, stepId: planStepId, state });
    if (settled === null) { counters.settlement_converged += 1; return; }
    if (settled.state === 'completed') counters.steps_settled += 1;
    if (settled.state === 'skipped') counters.steps_skipped += 1;
  } catch (e) {
    if (errCode(e) === 'already_settled') { counters.settlement_converged += 1; return; }
    // The engine's record stands; the step stays ready and the next sweep finds the
    // engine already done (bridge / request ledger replay), so nothing is repeated.
    counters.errors += 1;
    issues.push({
      scope: 'task', organizationId, id: planStepId,
      code: errCode(e), message: `the step could not be settled ${state}: ${errText(e)}`,
    });
  }
}

/** Tenants that may be swept, derived from data and never from a request. */
export async function listSweepableTenants(limit: number = SWEEP_LIMITS.tenants): Promise<string[]> {
  const res = await ownedDbTable(CONFIG_TABLE)
    .select('company_id')
    // An unconfigured tenant has no row and is excluded by construction; a disabled
    // one by this filter. A kill-switched tenant IS swept: the kill switch is
    // governance's to apply inside the engines, and its refusal is worth counting.
    .eq('enabled', true)
    .order('company_id', { ascending: true })
    .limit(limit + 1);
  if (res.error) {
    throw Object.assign(new Error(String((res.error as { message?: string }).message ?? 'tenant discovery failed')), { code: 'tenant_discovery_failed' });
  }
  const rows = Array.isArray(res.data) ? res.data as Array<Record<string, unknown>> : [];
  return rows.map((r) => String(r.company_id));
}

/**
 * Advance one tenant's journeys and act on whatever became ready.
 *
 * Never throws for a per-unit failure: one unreadable run or one refusing engine
 * must not cost the tenant its whole sweep. Failures are COUNTED and REPORTED.
 */
export async function advanceAndDispatchWorkflowExecution(
  organizationId: string,
  options: { now?: string; limit?: number; deps?: SweeperDeps } = {},
): Promise<TenantSweepResult> {
  const now = options.now ?? new Date().toISOString();
  const registry = buildAdapterRegistry(options.deps?.adapters ?? realAdapters());
  const intelligence = options.deps?.intelligence;

  const counters = zero();
  const outcomes: Record<string, number> = {};
  const unsupported: string[] = [];
  const decisions: JourneyDecision[] = [];
  const issues: SweepIssue[] = [];
  const taskBudget = options.limit ?? SWEEP_LIMITS.tasksPerTenant;
  let workRemains = false;

  let instanceIds: string[];
  try {
    instanceIds = await listExecutionInstanceIdsInStates(organizationId, OCCUPIED_LIFECYCLE_STATES, SWEEP_LIMITS.instancesPerTenant);
  } catch (e) {
    counters.errors += 1;
    issues.push({ scope: 'tenant', organizationId, id: null, code: errCode(e), message: errText(e) });
    return { organizationId, counters, outcomes, unsupported, decisions, issues, workRemains: true };
  }
  if (instanceIds.length > SWEEP_LIMITS.instancesPerTenant) {
    instanceIds = instanceIds.slice(0, SWEEP_LIMITS.instancesPerTenant);
    workRemains = true;                      // stated, not silently truncated
  }

  for (const executionInstanceId of instanceIds) {
    if (counters.tasks_seen >= taskBudget) { workRemains = true; break; }
    counters.instances_scanned += 1;

    try {
      // The database decides eligibility. The sweeper supplies no clock and no delay.
      counters.steps_advanced += await advanceExecutionRun({ organizationId, executionInstanceId });

      const plan = await getPlanForInstance(organizationId, executionInstanceId);
      if (plan === null) continue;           // nothing materialized yet

      // A linear chain has a single frontier, so this is the whole ready set.
      const ready = await getReadyStep(organizationId, plan.id);
      if (ready === null) continue;

      const tasks = await listInstanceTasks(organizationId, executionInstanceId);
      const task = tasks.find((t) => t.planStepId === ready.id) ?? null;
      if (task === null) {
        counters.errors += 1;
        issues.push({
          scope: 'instance', organizationId, id: executionInstanceId, code: 'ready_step_has_no_task',
          message: `plan step ${ready.id} is ready but no execution task references it`,
        });
        continue;
      }
      if (String(ready.state) !== 'ready') {
        counters.errors += 1;
        issues.push({
          scope: 'task', organizationId, id: task.id, code: 'step_not_ready',
          message: `step ${ready.id} is "${String(ready.state)}", not ready; it may not be acted on`,
        });
        continue;
      }

      counters.tasks_seen += 1;
      const channel = String(task.channel ?? '');
      const { step, definition } = readSnapshot(plan.definitionSnapshot, ready.stepKey);
      const subject = { kind: task.subjectKind, id: task.subjectId } as const;
      const decide = (d: Omit<JourneyDecision, 'executionInstanceId' | 'planStepId' | 'stepKey' | 'channel'>) =>
        decisions.push({ executionInstanceId, planStepId: ready.id, stepKey: ready.stepKey, channel, ...d });

      // ── 1. No engine serves this channel: visible, the step stays ready. ──
      const adapter = registry.get(channel) ?? null;
      if (adapter === null) {
        counters.unsupported_channels += 1;
        if (!unsupported.includes(channel)) unsupported.push(channel);
        decide({ engine: null, decision: 'unsupported', outcome: null, reasons: [`no engine serves the "${channel}" channel`] });
        continue;
      }

      // ── 2. Who this person is, from canonical sources. ────────────────────
      const facts = await loadIndividualFacts(organizationId, subject, now, intelligence);

      // ── 3. Implicit permission + authored conditions → skip when unmet. ──
      const permission = channelPermissionFact(channel);
      const required: JourneyCondition[] = [
        ...(permission === null ? [] : [{ fact: permission, op: 'eq' as const, value: true }]),
        ...(step?.when ?? []),
      ];
      const verdict = evaluateConditions(required, facts.facts);
      if (!verdict.holds) {
        await settleStep(organizationId, ready.id, 'skipped', counters, issues);
        decide({ engine: adapter.engine, decision: 'skipped', outcome: null, reasons: [...verdict.unmet, ...facts.gaps.map((g) => `gap: ${g}`)] });
        continue;
      }

      // ── 4. Frequency policy across this tenant's journeys for the person. ──
      const gap = definition?.policy?.min_hours_between_actions;
      if (typeof gap === 'number' && gap > 0) {
        const last = await lastCompletedActionAtForSubject(organizationId, subject.kind, subject.id);
        const since = last === null ? null : hoursBetween(last, now);
        if (since !== null && since < gap) {
          counters.tasks_deferred_frequency += 1;
          decide({ engine: adapter.engine, decision: 'deferred', outcome: null, reasons: [`last action ${since.toFixed(1)}h ago; policy requires ${gap}h`] });
          continue;
        }
      }

      // ── 5. The engine acts; its disposition settles the step. ─────────────
      let r: EngineResult;
      try {
        r = await adapter.execute({
          organizationId, executionInstanceId, executionTaskId: task.id, planStepId: ready.id,
          channel, subject, step, personId: facts.personId, now,
        });
      } catch (e) {
        counters.errors += 1;
        issues.push({ scope: 'task', organizationId, id: task.id, code: errCode(e), message: `engine ${adapter.engine} failed: ${errText(e)}` });
        continue;
      }
      const key = `${r.engine}:${r.outcome}`;
      outcomes[key] = (outcomes[key] ?? 0) + 1;
      const reasons = r.reason ? [r.reason] : [];
      switch (r.disposition) {
        case 'completed':
          await settleStep(organizationId, ready.id, 'completed', counters, issues);
          decide({ engine: r.engine, decision: 'executed', outcome: r.outcome, reasons });
          break;
        case 'skipped':
          await settleStep(organizationId, ready.id, 'skipped', counters, issues);
          decide({ engine: r.engine, decision: 'skipped', outcome: r.outcome, reasons });
          break;
        case 'needs_human':
          counters.tasks_needing_human += 1;
          issues.push({ scope: 'task', organizationId, id: task.id, code: `needs_human:${r.outcome}`, message: r.reason ?? r.outcome });
          decide({ engine: r.engine, decision: 'needs_human', outcome: r.outcome, reasons });
          break;
        default:
          counters.tasks_waiting += 1;
          decide({ engine: r.engine, decision: 'waiting', outcome: r.outcome, reasons });
      }
    } catch (e) {
      counters.errors += 1;
      issues.push({ scope: 'instance', organizationId, id: executionInstanceId, code: errCode(e), message: errText(e) });
    }
  }

  if (counters.tasks_seen >= taskBudget && instanceIds.length > counters.instances_scanned) {
    workRemains = true;
  }

  return { organizationId, counters, outcomes, unsupported, decisions, issues, workRemains };
}

/**
 * Sweep every eligible tenant. The tenant set comes from
 * `outreach_governance_config.enabled = true` and nowhere else: no caller may name
 * a tenant, and there is no owner or company special case anywhere in this path.
 */
export async function sweepWorkflowExecutionProgression(
  options: { now?: string; tenantLimit?: number; taskLimit?: number; deps?: SweeperDeps } = {},
): Promise<SweepReport> {
  const ranAt = options.now ?? new Date().toISOString();
  const tenantLimit = options.tenantLimit ?? SWEEP_LIMITS.tenants;

  let tenantIds: string[];
  try {
    tenantIds = await listSweepableTenants(tenantLimit);
  } catch (e) {
    logger.error('workflow_progression_tenant_discovery_failed', { error: errText(e) });
    const counters = zero();
    counters.errors += 1;
    return {
      ranAt, tenantsConsidered: 0, tenants: [], counters, workRemains: true,
      issues: [{ scope: 'tenant', organizationId: '', id: null, code: errCode(e), message: errText(e) }],
    };
  }

  let workRemains = false;
  if (tenantIds.length > tenantLimit) {
    tenantIds = tenantIds.slice(0, tenantLimit);
    workRemains = true;
  }

  const tenants: TenantSweepResult[] = [];
  const issues: SweepIssue[] = [];
  let counters = zero();

  for (const organizationId of tenantIds) {
    const result = await advanceAndDispatchWorkflowExecution(organizationId, {
      now: ranAt,
      ...(options.taskLimit === undefined ? {} : { limit: options.taskLimit }),
      ...(options.deps === undefined ? {} : { deps: options.deps }),
    });
    tenants.push(result);
    counters = add(counters, result.counters);
    issues.push(...result.issues);
    if (result.workRemains) workRemains = true;
  }

  for (const [measure, value] of Object.entries(counters)) {
    recordProgressionSweep(measure, value);
  }

  return { ranAt, tenantsConsidered: tenantIds.length, tenants, counters, issues, workRemains };
}

export const WORKFLOW_PROGRESSION_CONFIG_TABLE = CONFIG_TABLE;
