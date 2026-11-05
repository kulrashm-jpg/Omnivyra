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
 *   2. ends the journey on a deterministic answer (booked, converted, rejected,
 *      unsubscribed, a WhatsApp STOP) or when PI closed the prospect — no further step,
 *      and any unsent WS-3 task is cancelled; SUSPENDS it (run `paused`, a `needs_human`
 *      decision) on an unclassified reply a person has not yet evaluated (Prompt 4).
 *      A canonical restriction (complaint, unsubscribe) is read before any reply, and a
 *      complaint also ends a PAUSED run (Q-C1, the paused pass after the main loop);
 *   2a. a step a person deferred to a return date (`not_before`) waits until then;
 *   3. skips a step whose choice group already acted;
 *   4. asks the central gate (journeyGovernance.ts) on a contact channel — a tenant or
 *      platform control holds the step, whichever engine would have served it;
 *   5. applies IMPLICIT channel permission and authored `when` conditions — if they do
 *      not hold, the step is SKIPPED and its unsent task withdrawn: "no suitable action
 *      for this person" is a recorded decision, and the journey continues. Unless an
 *      engine already holds the action: then its own record decides;
 *   6. applies the version's frequency policy and execution window — too recent or
 *      out of hours, the step WAITS (it is retried by a later sweep);
 *   7. hands the step to the channel's engine adapter (engineAdapters.ts), which
 *      asks the EXISTING engine to act; the engine's own gates stay authoritative;
 *   8. settles the step from the engine's disposition: `completed` or `skipped`
 *      advance the journey; `wait` and `needs_human` leave it ready.
 *
 * Every decision is then recorded durably (journeyDecisionLog.ts) and the tenant's
 * recent outcomes are fed to PI's lifecycle (journeyFeedback.ts).
 *
 * ─── WHAT IT NEVER DOES ───────────────────────────────────────────────────
 * It never approves, never overrides an opt-out or suppression, never retries an
 * action that may already have happened, and never chooses `failed` (an absorbing
 * state reserved for a person). A response can only END a journey: no step is ever
 * added or reordered because of one, and a choice group chooses among steps the frozen
 * version already holds, on facts read live. Stopping contact narrows what a workflow
 * does, which is why it needs no authoring and no autonomy policy.
 *
 * ─── CONCURRENCY ──────────────────────────────────────────────────────────
 * `advance_execution_plan` locks the run; step transitions are compare-and-set; the
 * WS-3 bridge and the engine-request ledger are unique per execution task; and
 * engines claim before sending. Two sweeps over the same run converge.
 */
import {
  advanceExecutionRun, BLOCKING_STEP_STATES, getReadyStep, listProgressionSteps, transitionPlanStep,
} from './stepProgressionStore';
import {
  getPlanForInstance, lastCompletedActionAtForSubject, listInstanceTasks,
} from '../executionPlans/executionPlanStore';
import { getExecutionInstance, listExecutionInstanceIdsInStates, setExecutionInstanceState } from '../executionInstances/executionInstanceStore';
import { ownedDbTable } from '../../db/writeOwner';
import { recordProgressionSweep } from '../leadOutreachExecution/telemetry';
import { logger } from '../logger';
import {
  buildAdapterRegistry, createWs3Adapter, type EngineAdapter, type EngineResult,
} from '../orchestration/engineAdapters';
import { createWhatsAppAdapter } from '../orchestration/whatsappEngineAdapter';
import { createSocialPublishAdapter } from '../orchestration/socialPublishEngineAdapter';
import { createBrowserAdapter } from '../orchestration/browserEngineAdapter';
import {
  loadIndividualFacts, PROSPECT_STATE_UNREADABLE_GAP, type IndividualIntelligencePort,
} from '../orchestration/individualIntelligence';
import {
  channelPermissionFact, evaluateConditions, hoursBetween, isProspectClosedToJourneys,
  isWithinExecutionWindow, NON_CONTACT_CHANNELS, type JourneyCondition,
} from '../orchestration/journeyPolicy';
import {
  assessComplaint, assessJourneyResponse, durableJourneyResponsePort, evaluatedReplyKeys, REPLY_AWAITING_EVALUATION, type JourneyResponsePort,
} from '../orchestration/journeyResponses';
import { APPROVAL_REVOKED } from '../orchestration/engineAdapters';
import { listJourneyDecisions, recordJourneyDecisions, type JourneyDecisionInput } from '../orchestration/journeyDecisionLog';
import { feedRecentOutcomesToLifecycle, feedWhatsAppReplyToLifecycle, type LifecycleFeedbackReport } from '../orchestration/journeyFeedback';
import { exitJourney, withdrawStepAction, withdrawUnsentTasks } from '../orchestration/journeyExit';
import { channelRefusal } from '../orchestration/journeyGovernance';
import { COMMUNITY_CAPABILITIES } from '../orchestration/engineCapabilities';
import { ensureProspectLifecycleOpen } from '../prospectLifecycle/lifecycleWriter';
import type { WorkflowDefinition, WorkflowStep } from '../workflows/workflowStore';

const CONFIG_TABLE = 'outreach_governance_config';

/** Lifecycle states in which a run may still make work eligible. `paused` is excluded: a pause is real. */
export const OCCUPIED_LIFECYCLE_STATES = ['created', 'queued', 'active'] as const;

/** Channels with an engine adapter. Everything else is visible as unsupported, never re-routed. */
export const ROUTED_CHANNELS = ['internal', 'email', 'whatsapp', 'social_post', 'community'] as const;
export type RoutedChannel = typeof ROUTED_CHANNELS[number];

/**
 * Bounds. Every invocation is finite, and reaching a bound is REPORTED rather than
 * hidden, so an operator can tell "nothing was due" from "we ran out of budget".
 */
export const SWEEP_LIMITS = {
  tenants: 25,
  instancesPerTenant: 50,
  tasksPerTenant: 25,
  /** The occupied runs a sweep rotates its window across; beyond this is reported. */
  instanceWindowPerTenant: 1000,
} as const;

/**
 * A step held this long by an engine, or left `running` by a person, is reported to a
 * person. It is only ever reported: nothing is retried, settled or expired because of it.
 */
export const STUCK_AFTER_HOURS = 24 * 7;

/** The cadence the rotation assumes. A different cadence only changes how fast it cycles. */
export const SWEEP_ROTATION_MS = 15 * 60 * 1000;

/**
 * Which part of a tenant's occupied runs this sweep looks at. Runs waiting on a human
 * consume the task budget without settling, so always starting from the oldest would
 * leave newer journeys unreached for as long as the old ones wait. Stateless on
 * purpose: the instant picks the window, so no sweep cursor has to be stored or raced.
 */
export function rotateInstanceWindow(ids: readonly string[], now: string): string[] {
  if (ids.length <= SWEEP_LIMITS.tasksPerTenant) return [...ids];
  const tick = Math.floor(Date.parse(now) / SWEEP_ROTATION_MS);
  const start = Number.isFinite(tick) ? (tick * SWEEP_LIMITS.tasksPerTenant) % ids.length : 0;
  return [...ids.slice(start), ...ids.slice(0, start)];
}

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
  /** Journeys ended because the person responded or PI closed the prospect. */
  journeys_exited: number;
  /** Prompt 4 — journeys paused because the person replied and a person must evaluate it. */
  journeys_suspended: number;
  /** PI lifecycle transitions written from recorded responses. */
  lifecycle_transitions_written: number;
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
  /** Null only for the run-level `exited`. */
  readonly planStepId: string | null;
  readonly stepKey: string | null;
  readonly channel: string | null;
  readonly engine: string | null;
  readonly decision: 'executed' | 'skipped' | 'deferred' | 'waiting' | 'needs_human' | 'unsupported' | 'exited';
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
  /** What reached PI's lifecycle this sweep; null when the feed could not run. */
  readonly lifecycleFeedback: LifecycleFeedbackReport | null;
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
  unsupported_channels: 0, settlement_converged: 0, journeys_exited: 0, journeys_suspended: 0,
  lifecycle_transitions_written: 0, errors: 0,
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
  readonly responses?: JourneyResponsePort;
  /** The run's recorded decisions, for the replies a person already evaluated. */
  readonly readDecisions?: typeof listJourneyDecisions;
  /** The durable record and PI feed. Injected together: a unit test exercises neither. */
  readonly recordDecisions?: typeof recordJourneyDecisions;
  readonly feedLifecycle?: typeof feedRecentOutcomesToLifecycle;
  readonly openLifecycle?: typeof ensureProspectLifecycleOpen;
  /** The central tenant and platform gate. */
  readonly channelGate?: typeof channelRefusal;
}

/**
 * The community engine's module graph (executor, RPA, session encryption) needs the
 * full runtime configuration at load, so it is reached only when a community step is
 * actually due. Every other journey keeps working without it.
 */
const communityAdapter: EngineAdapter = {
  engine: 'community',
  channels: ['community'],
  capabilities: COMMUNITY_CAPABILITIES,
  execute: async (ctx) =>
    (await import('../orchestration/communityEngineAdapter')).createCommunityAdapter().execute(ctx),
};

let defaultAdapters: readonly EngineAdapter[] | null = null;
const realAdapters = (): readonly EngineAdapter[] =>
  (defaultAdapters ??= [
    createWs3Adapter(), createWhatsAppAdapter(), createSocialPublishAdapter(),
    communityAdapter, createBrowserAdapter(),
  ]);

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
  const responses = options.deps?.responses ?? durableJourneyResponsePort;

  const counters = zero();
  const outcomes: Record<string, number> = {};
  const unsupported: string[] = [];
  const decisions: JourneyDecision[] = [];
  const issues: SweepIssue[] = [];
  const taskBudget = options.limit ?? SWEEP_LIMITS.tasksPerTenant;
  let workRemains = false;

  let instanceIds: string[];
  try {
    instanceIds = await listExecutionInstanceIdsInStates(organizationId, OCCUPIED_LIFECYCLE_STATES, SWEEP_LIMITS.instanceWindowPerTenant);
  } catch (e) {
    counters.errors += 1;
    issues.push({ scope: 'tenant', organizationId, id: null, code: errCode(e), message: errText(e) });
    return { organizationId, counters, outcomes, unsupported, decisions, issues, lifecycleFeedback: null, workRemains: true };
  }
  if (instanceIds.length > SWEEP_LIMITS.instanceWindowPerTenant) {
    instanceIds = instanceIds.slice(0, SWEEP_LIMITS.instanceWindowPerTenant);
    workRemains = true;                      // stated, not silently truncated
  }
  instanceIds = rotateInstanceWindow(instanceIds, now);
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
      if (ready === null) {
        // A failed or cancelled step blocks the chain for good, but the database ends a
        // run only once every step has settled, so this run would stay occupied forever:
        // re-enrolment refused, and a sweep scan spent on it each cycle.
        const planSteps = await listProgressionSteps(organizationId, plan.id);
        const blocking = planSteps.find((s) => (BLOCKING_STEP_STATES as readonly string[]).includes(s.state));
        if (blocking !== undefined) {
          // Withdraw first: a terminal run is not swept again, so a failure must leave it open.
          await withdrawUnsentTasks(organizationId, executionInstanceId);
          await setExecutionInstanceState({ organizationId, instanceId: executionInstanceId, lifecycleState: 'failed' });
          await withdrawUnsentTasks(organizationId, executionInstanceId);
          counters.journeys_exited += 1;
          decisions.push({
            executionInstanceId, planStepId: null, stepKey: null, channel: null, engine: null,
            decision: 'exited', outcome: `step_${blocking.state}`, reasons: [`step ${blocking.stepKey} is ${blocking.state}; later steps cannot run`],
          });
          continue;
        }
        const running = planSteps.find((s) => s.state === 'running');
        const heldFor = running?.startedAt == null ? null : hoursBetween(running.startedAt, now);
        if (running !== undefined && heldFor !== null && heldFor >= STUCK_AFTER_HOURS) {
          counters.tasks_needing_human += 1;
          decisions.push({
            executionInstanceId, planStepId: running.id, stepKey: running.stepKey, channel: running.channel, engine: null,
            decision: 'needs_human', outcome: 'running_step_unattended', reasons: [`marked running ${heldFor.toFixed(0)}h ago and never settled`],
          });
        }
        continue;
      }

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

      // ── 3. The person responded, or PI closed them → the journey ends. ────
      if (facts.gaps.includes(PROSPECT_STATE_UNREADABLE_GAP)) {
        counters.tasks_waiting += 1;
        decide({ engine: adapter.engine, decision: 'waiting', outcome: PROSPECT_STATE_UNREADABLE_GAP, reasons: ['the prospect state could not be read; no contact this sweep'] });
        continue;
      }
      const priorDecisions = await (options.deps?.readDecisions ?? listJourneyDecisions)(organizationId, executionInstanceId);
      const evaluated = evaluatedReplyKeys(priorDecisions);
      // RV-1 — suspensions a person already reviewed: the run is active again, so they resumed it.
      const reviewed = new Set(priorDecisions.filter((d) => d.decision === 'needs_human' && d.outcome !== null).map((d) => d.outcome as string));
      const exit = await assessJourneyResponse(organizationId, executionInstanceId, facts.personId, evaluated, responses, now);
      // A PI closed state ends the run even while a reply awaits evaluation.
      const closedBy = isProspectClosedToJourneys(facts.facts) ? String(facts.facts.prospect_lifecycle_state) : null;
      const exitReason = exit.consequence === 'exit' ? exit.outcome : closedBy;
      if (exitReason === null && exit.consequence === 'suspend') {
        // Prompt 4 — an unclassified reply SUSPENDS the journey: the existing pause, which
        // the sweeper never progresses and the D-03 hold keeps any handed-off task from
        // sending. Nothing is withdrawn: a person resumes (PATCH lifecycleState `active`)
        // or ends it (`cancelled`, which withdraws). PI hears the reply as before.
        if (exit.whatsappReply !== null && subject.kind === 'prospect') {
          try {
            const fed = await feedWhatsAppReplyToLifecycle({
              organizationId, prospectId: subject.id, now,
              messageId: exit.whatsappReply.messageId, threadId: exit.whatsappReply.threadId,
              outcome: exit.whatsappReply.outcome,
            });
            if (fed.wrote) counters.lifecycle_transitions_written += 1;
          } catch (e) {
            issues.push({ scope: 'instance', organizationId, id: executionInstanceId, code: 'lifecycle_feedback_failed', message: errText(e) });
          }
        }
        // Paused FIRST: only a run that really is suspended records the decision that marks
        // its reply as handed to a person.
        await setExecutionInstanceState({ organizationId, instanceId: executionInstanceId, lifecycleState: 'paused' });
        counters.journeys_suspended += 1;
        decide({
          engine: adapter.engine, decision: 'needs_human', outcome: `${REPLY_AWAITING_EVALUATION}:${exit.replyKey}`,
          reasons: ['the person replied; the journey is paused until a person evaluates the reply (resume or end it)'],
        });
        continue;
      }
      if (exitReason !== null) {
        if (exit.whatsappReply !== null && subject.kind === 'prospect') {
          // Best effort: the journey's stop must not depend on PI accepting the event.
          try {
            const fed = await feedWhatsAppReplyToLifecycle({
              organizationId, prospectId: subject.id, now,
              messageId: exit.whatsappReply.messageId, threadId: exit.whatsappReply.threadId,
              outcome: exit.whatsappReply.outcome,
            });
            if (fed.wrote) counters.lifecycle_transitions_written += 1;
          } catch (e) {
            issues.push({ scope: 'instance', organizationId, id: executionInstanceId, code: 'lifecycle_feedback_failed', message: errText(e) });
          }
        }
        await exitJourney(organizationId, executionInstanceId);
        counters.journeys_exited += 1;
        decisions.push({
          executionInstanceId, planStepId: null, stepKey: null, channel: null, engine: null,
          decision: 'exited', outcome: exitReason, reasons: [`the journey ended: ${exitReason}`],
        });
        continue;
      }

      // PI abstains on a prospect with no ledger, so a response could never reach
      // it. The first step a journey acts on opens one, through PI's own opener.
      // Best effort: the opener is idempotent and the next sweep tries again.
      if (facts.prospectLedgerAbsent) {
        try {
          await (options.deps?.openLifecycle ?? ensureProspectLifecycleOpen)({
            organizationId, prospectId: subject.id, now,
            reasoning: 'a journey first acted on this prospect',
            evidence: { kind: 'human_action', detail: { reason: 'campaign_enrollment' } },
          });
        } catch (e) {
          issues.push({ scope: 'instance', organizationId, id: executionInstanceId, code: 'lifecycle_open_failed', message: errText(e) });
        }
      }

      // ── 3a. A person deferred this step to a return date: it waits until then. ──
      if (typeof ready.notBefore === 'string' && !(Date.parse(now) >= Date.parse(ready.notBefore))) {
        counters.tasks_deferred_frequency += 1;
        decide({ engine: adapter.engine, decision: 'deferred', outcome: 'not_before', reasons: [`a person deferred this step until ${ready.notBefore}`] });
        continue;
      }

      const heldHours = ready.readyAt === null ? null : hoursBetween(ready.readyAt, now);
      const heldTooLong = heldHours !== null && heldHours >= STUCK_AFTER_HOURS;

      // Once an engine holds the action, conditions no longer decide this step: it goes to
      // the engine, whose own record answers. Skipping would let the next candidate contact
      // the same person a second time.
      let engineHolds = false;

      // ── 4. An earlier step in this choice group acted → this one has no decision left. ──
      if (typeof step?.choice_group === 'string') {
        const group = step.choice_group;
        const groupKeys = (Array.isArray(definition?.steps) ? definition!.steps : []).filter((s) => s.choice_group === group).map((s) => s.key);
        const earlier = (await listProgressionSteps(organizationId, plan.id))
          .filter((s) => s.stepOrder < ready.stepOrder && groupKeys.includes(s.stepKey));
        const chosen = earlier.find((s) => s.state === 'completed');
        if (chosen !== undefined) {
          engineHolds = (await withdrawStepAction(organizationId, executionInstanceId, task.id)) === 'engine_holds';
          if (!engineHolds) {
            await settleStep(organizationId, ready.id, 'skipped', counters, issues);
            decide({ engine: adapter.engine, decision: 'skipped', outcome: 'branch_not_taken', reasons: [`choice group ${group} already acted through ${chosen.stepKey}`] });
            continue;
          }
        }
      }

      // ── 5. Tenant and platform controls: held, whichever engine serves this. ──
      if (!NON_CONTACT_CHANNELS.includes(channel)) {
        const refusal = await (options.deps?.channelGate ?? channelRefusal)(organizationId, channel);
        if (refusal !== null) {
          if (heldTooLong) {
            counters.tasks_needing_human += 1;
            decide({ engine: adapter.engine, decision: 'needs_human', outcome: 'stuck_waiting', reasons: [`${refusal} for ${heldHours.toFixed(0)}h`] });
          } else {
            counters.tasks_waiting += 1;
            decide({ engine: adapter.engine, decision: 'waiting', outcome: refusal, reasons: [`${channel} is not available: ${refusal}`] });
          }
          continue;
        }
      }

      // ── 6. Implicit permission and authored conditions → skip when unmet. ──
      const permission = channelPermissionFact(channel);
      // A new contact channel with nothing that can say no would contact everyone. An engine
      // serving it is held until its permission source exists; the step stays with a person.
      if (permission === null && !NON_CONTACT_CHANNELS.includes(channel)) {
        counters.tasks_needing_human += 1;
        decide({ engine: adapter.engine, decision: 'needs_human', outcome: 'no_permission_source', reasons: [`nothing can read a person's permission for ${channel}`] });
        continue;
      }
      const required: JourneyCondition[] = [
        ...(permission === null ? [] : [{ fact: permission, op: 'eq' as const, value: true }]),
        ...(step?.when ?? []),
      ];
      const verdict = evaluateConditions(required, facts.facts);
      if (!verdict.holds) {
        // A fact missing because a read failed says nothing about the person. Skipping would
        // lose the step to an outage, so it waits for a read that answers.
        const unread = facts.gaps.filter((g) => g.endsWith('_unreadable'));
        if (unread.length > 0 && verdict.unmet.some((u) => u.includes(' is unknown'))) {
          if (heldTooLong) {
            counters.tasks_needing_human += 1;
            decide({ engine: adapter.engine, decision: 'needs_human', outcome: 'stuck_waiting', reasons: [`facts_unreadable for ${heldHours.toFixed(0)}h`, ...unread] });
          } else {
            counters.tasks_waiting += 1;
            decide({ engine: adapter.engine, decision: 'waiting', outcome: 'facts_unreadable', reasons: unread });
          }
          continue;
        }
        engineHolds = (await withdrawStepAction(organizationId, executionInstanceId, task.id)) === 'engine_holds';
        if (!engineHolds) {
          await settleStep(organizationId, ready.id, 'skipped', counters, issues);
          decide({ engine: adapter.engine, decision: 'skipped', outcome: null, reasons: [...verdict.unmet, ...facts.gaps.map((g) => `gap: ${g}`)] });
          continue;
        }
      }

      // ── 7. Frequency policy and execution window. Neither delays reading an engine's record. ──
      const gap = definition?.policy?.min_hours_between_actions;
      if (!engineHolds && typeof gap === 'number' && gap > 0 && !NON_CONTACT_CHANNELS.includes(channel)) {
        const last = await lastCompletedActionAtForSubject(organizationId, subject.kind, subject.id);
        const since = last === null ? null : hoursBetween(last, now);
        if (since !== null && since < gap) {
          counters.tasks_deferred_frequency += 1;
          decide({ engine: adapter.engine, decision: 'deferred', outcome: null, reasons: [`last action ${since.toFixed(1)}h ago; policy requires ${gap}h`] });
          continue;
        }
      }

      const window = definition?.policy?.execution_window;
      if (!engineHolds && window !== undefined && !NON_CONTACT_CHANNELS.includes(channel) && !isWithinExecutionWindow(window, now, facts.personTimezone ?? null)) {
        counters.tasks_deferred_frequency += 1;
        decide({ engine: adapter.engine, decision: 'deferred', outcome: 'outside_execution_window', reasons: [`outside ${window.start_hour}:00-${window.end_hour}:00`] });
        continue;
      }

      // ── 8. The engine acts; its disposition settles the step. ─────────────
      let r: EngineResult;
      try {
        r = await adapter.execute({
          organizationId, executionInstanceId, executionTaskId: task.id, planStepId: ready.id,
          channel, subject, step, personId: facts.personId, now,
          ...(engineHolds ? { holdOnly: true } : {}),
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
          // RV-1 — a revoked approval PAUSES the run for a person, the reply-suspension
          // pattern. Once a person resumed it (the suspension is on record and the run is
          // active), the revoked task stays cancelled and the step is skipped as before.
          if (r.outcome.startsWith(`${APPROVAL_REVOKED}:`)) {
            if (reviewed.has(r.outcome)) {
              await settleStep(organizationId, ready.id, 'skipped', counters, issues);
              decide({ engine: r.engine, decision: 'skipped', outcome: `${APPROVAL_REVOKED}_reviewed`, reasons: ['a person resumed the journey after the revocation; the revoked action is not taken'] });
              break;
            }
            await setExecutionInstanceState({ organizationId, instanceId: executionInstanceId, lifecycleState: 'paused' });
            counters.journeys_suspended += 1;
            decide({ engine: r.engine, decision: 'needs_human', outcome: r.outcome, reasons: ['the approval was revoked; the journey is paused until a person resumes or ends it'] });
            break;
          }
          counters.tasks_needing_human += 1;
          issues.push({ scope: 'task', organizationId, id: task.id, code: `needs_human:${r.outcome}`, message: r.reason ?? r.outcome });
          decide({ engine: r.engine, decision: 'needs_human', outcome: r.outcome, reasons });
          break;
        default: {
          if (heldTooLong) {
            counters.tasks_needing_human += 1;
            decide({ engine: r.engine, decision: 'needs_human', outcome: 'stuck_waiting', reasons: [`${r.outcome} for ${heldHours.toFixed(0)}h`, ...reasons] });
            break;
          }
          counters.tasks_waiting += 1;
          decide({ engine: r.engine, decision: 'waiting', outcome: r.outcome, reasons });
        }
      }
    } catch (e) {
      counters.errors += 1;
      issues.push({ scope: 'instance', organizationId, id: executionInstanceId, code: errCode(e), message: errText(e) });
    }
  }

  if (counters.tasks_seen >= taskBudget && instanceIds.length > counters.instances_scanned) {
    workRemains = true;
  }

  // ── Q-C1: a complaint ends a PAUSED run too. Nothing else is done to a paused run. ──
  let pausedIds: string[] = [];
  try {
    pausedIds = await listExecutionInstanceIdsInStates(organizationId, ['paused'], SWEEP_LIMITS.instancesPerTenant);
  } catch (e) {
    counters.errors += 1;
    issues.push({ scope: 'tenant', organizationId, id: null, code: errCode(e), message: `paused runs unreadable: ${errText(e)}` });
  }
  if (pausedIds.length > SWEEP_LIMITS.instancesPerTenant) { pausedIds = pausedIds.slice(0, SWEEP_LIMITS.instancesPerTenant); workRemains = true; }
  for (const executionInstanceId of pausedIds) {
    try {
      const run = await getExecutionInstance(organizationId, executionInstanceId);
      if (run === null || run.lifecycleState !== 'paused') continue;
      const facts = await loadIndividualFacts(organizationId, { kind: run.subjectKind, id: run.subjectId }, now, intelligence);
      if (!(await assessComplaint(organizationId, executionInstanceId, facts.personId, responses, now))) continue;
      await exitJourney(organizationId, executionInstanceId);
      counters.journeys_exited += 1;
      decisions.push({
        executionInstanceId, planStepId: null, stepKey: null, channel: null, engine: null,
        decision: 'exited', outcome: 'complained', reasons: ['the journey ended: complained (it was paused)'],
      });
    } catch (e) {
      counters.errors += 1;
      issues.push({ scope: 'instance', organizationId, id: executionInstanceId, code: errCode(e), message: errText(e) });
    }
  }

  const recorded = await (options.deps?.recordDecisions ?? recordJourneyDecisions)(
    organizationId, decisions as readonly JourneyDecisionInput[],
  );
  if (recorded.failed > 0) {
    counters.errors += recorded.failed;
    issues.push({ scope: 'tenant', organizationId, id: null, code: 'decision_record_failed', message: recorded.firstError ?? 'a decision could not be recorded' });
  }

  let lifecycleFeedback: LifecycleFeedbackReport | null = null;
  try {
    lifecycleFeedback = await (options.deps?.feedLifecycle ?? feedRecentOutcomesToLifecycle)(organizationId, now);
    counters.lifecycle_transitions_written += lifecycleFeedback.written;
    counters.errors += lifecycleFeedback.errors;
    if (lifecycleFeedback.truncated) workRemains = true;
  } catch (e) {
    counters.errors += 1;
    issues.push({ scope: 'tenant', organizationId, id: null, code: errCode(e), message: errText(e) });
  }

  return { organizationId, counters, outcomes, unsupported, decisions, issues, lifecycleFeedback, workRemains };
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
