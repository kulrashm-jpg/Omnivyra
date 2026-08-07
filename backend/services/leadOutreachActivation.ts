/**
 * WS-6A — Lead Outreach Runtime Activation.
 *
 * THE PROBLEM THIS SOLVES. WS-3 shipped a complete, migrated, deployed and
 * certified execution runtime that had never executed. Its milestone table
 * (docs/WS3-ARCHITECTURE.md §9) ends at M7 and never specifies a caller, so
 * nothing outside `backend/services/leadOutreachExecution/` and its test and
 * certification scripts imported it. The runtime was orphaned from the
 * application graph — not disabled, not broken, simply unreachable.
 *
 * This module is that caller and nothing more. It COMPOSES already-exported
 * functions in the order the frozen architecture prescribes and the WS-3 M8
 * certification harness proves (scripts/ws3-m8/pipeline.ts). It contains no
 * execution logic of its own: no governance, no quota arithmetic, no lifecycle
 * transition, no transport. Every one of those already exists and is reached
 * through the runtime's public surface.
 *
 * ─── WHAT THIS DELIBERATELY DOES NOT DO ────────────────────────────────────
 *  • It never approves. Approval is a human gate (M3) and a freshly
 *    materialised task is `pending`, which `evaluateEligibility` refuses. A
 *    caller that auto-approved would erase the gate WS-3 built first, on
 *    purpose, before capability arrived.
 *  • It never enables a tenant. `outreach_governance_config` is the single
 *    documented switch — "enabling the tenant is the ONE step that makes it
 *    dispatchable" (WS-3 M8 proof). Writing it from here would move the switch
 *    into code and out of operations.
 *  • It registers no new transport and enables no disabled one. Email remains
 *    behind `LEAD_OUTREACH_EMAIL_ENABLED`, which this module never reads.
 *  • It adds no queue. `approved → queued → dispatching → sent` is already the
 *    durable state machine, with compare-and-set transitions
 *    (lifecycle.ts:55-65). A second queue would duplicate it and create a
 *    second source of truth for "is this task in flight".
 *
 * ─── WHY NO NEW FEATURE FLAG ───────────────────────────────────────────────
 * Deploying this changes nothing on its own. Dispatch requires a tenant with an
 * `outreach_governance_config` row, and production has none. The architecture
 * deliberately made tenant enablement the single switch; adding a third global
 * flag would contradict that and give operators two places to look when
 * "nothing dispatches".
 *
 * ─── CHANNEL POSTURE ───────────────────────────────────────────────────────
 * Defaults to the internal channel ONLY — the one that contacts nobody. The
 * frozen rollout is explicit: "Dispatch internal tasks first. Confirm work
 * items appear. Only then consider email." Widening is an explicit, per-call
 * decision, and even then the email transport is independently flag-gated.
 */

import {
  approveOutreachTask,
  dispatchInternalOutreachTask,
  listOutreachTasksForLead,
  materializeAutomationPlan,
  registerDefaultTransports,
  resolveTransport,
  submitForApproval,
  supportedChannels,
  type DispatchResult,
  type MaterializationResult,
  type OutreachTask,
} from './leadOutreachExecution';
import { getPersistedLeadIntelligence } from './leadIntelligenceOrchestration/readIntegration';
import { ENGINE_VERSION } from './leadIntelligenceOrchestration/engineVersion';
import type { IntelligencePersistencePort } from './leadIntelligenceOrchestration/types';
import { logger } from './logger';

/** The channel that contacts nobody. The only default this module dispatches. */
export const DEFAULT_ACTIVATION_CHANNELS: readonly string[] = ['internal'];

export interface ActivationOptions {
  /**
   * Channels this invocation may dispatch. Anything outside the list is left
   * untouched and reported as `channel_not_permitted` — a deliberate refusal,
   * distinct from `skipped_no_transport`, which means no transport exists at
   * all. Collapsing the two would hide an operator's scoping decision behind
   * what looks like a missing capability.
   */
  channels?: readonly string[];
  /** Injected instant, so an activation run is reproducible. */
  now?: string;
  /** Recipient passed to governance for suppression and region evaluation. */
  recipient?: string | null;
  region?: string | null;
  /** Translate and report without writing anything. */
  previewOnly?: boolean;
  /**
   * Injected intelligence-read port. `getPersistedLeadIntelligence` already
   * takes one; threading it through keeps this entry point testable without a
   * database, the same way every WS-3 module takes its ports.
   */
  persistence?: IntelligencePersistencePort;
}

export interface ActivationTaskReport {
  taskId: string;
  channel: string | null;
  status: string;
  /** `dispatched` only when the runtime actually ran; otherwise why not. */
  action: 'dispatched' | 'not_approved' | 'channel_not_permitted' | 'no_transport' | 'terminal';
  outcome?: string;
  reason?: string;
  governance?: string;
}

export interface ActivationReport {
  companyId: string;
  leadId: string;
  ranAt: string;
  plannerVersion: string;
  planPresent: boolean;
  planGeneratedAt: string | null;
  permittedChannels: string[];
  registeredChannels: string[];
  materialization: MaterializationResult | null;
  tasks: ActivationTaskReport[];
  dispatched: number;
  /** Populated only when the run could not proceed at all. */
  blocked?: string;
}

/**
 * Register the transports this runtime may use.
 *
 * Registration is caller-driven by design (transportRegistry.ts) so that a mere
 * module import can never make a channel sendable. Calling it here — once, at
 * the entry point — is exactly the intended shape. It is idempotent:
 * `registerTransport` is a keyed `Map.set` (transport.ts:91-93).
 */
function ensureTransports(): void {
  registerDefaultTransports();
}

/**
 * Materialise a lead's persisted automation plan into durable outreach tasks.
 *
 * Reads the plan WS-2 already persisted; it never regenerates one. A lead with
 * no generated envelope, or an envelope whose `automationPlanning` is null, is
 * reported as such rather than treated as an error — most leads legitimately
 * have no plan.
 */
export async function materializeOutreachForLead(
  companyId: string,
  leadId: string,
  options: ActivationOptions = {},
): Promise<{ planPresent: boolean; planGeneratedAt: string | null; result: MaterializationResult | null; reason?: string }> {
  const { record } = await getPersistedLeadIntelligence(companyId, leadId, options.persistence);
  const plan = record?.automationPlanning ?? null;

  if (!plan) {
    return {
      planPresent: false,
      planGeneratedAt: null,
      result: null,
      reason: record ? 'the envelope carries no automationPlanning block' : 'no generated envelope for this lead',
    };
  }

  const result = await materializeAutomationPlan(
    plan,
    { companyId, leadId, plannerVersion: ENGINE_VERSION, materializedAt: options.now },
    { previewOnly: options.previewOnly === true },
  );

  return { planPresent: true, planGeneratedAt: plan.generatedAt ?? null, result };
}

/** A task the runtime can no longer act on. */
const TERMINAL = new Set(['sent', 'delivered', 'failed', 'rejected', 'cancelled', 'expired', 'completed']);

/**
 * Dispatch the lead's tasks that are already approved.
 *
 * Approval is NOT performed here. A task in any state other than `approved` is
 * reported and left alone — `evaluateEligibility` would refuse it anyway
 * (governance.ts:194-202), and pre-empting that refusal in the caller would put
 * a second copy of the eligibility rule outside the governance engine.
 */
export async function dispatchApprovedOutreachForLead(
  companyId: string,
  leadId: string,
  options: ActivationOptions = {},
): Promise<ActivationTaskReport[]> {
  ensureTransports();

  const permitted = new Set(options.channels ?? DEFAULT_ACTIVATION_CHANNELS);
  const tasks = await listOutreachTasksForLead(companyId, leadId);
  const reports: ActivationTaskReport[] = [];

  for (const task of tasks) {
    const taskId = task?.id ? String(task.id) : '';
    if (!taskId) continue;
    const channel = task.channel ?? null;
    const status = String(task.status ?? 'unknown');

    if (TERMINAL.has(status)) {
      reports.push({ taskId, channel, status, action: 'terminal' });
      continue;
    }
    if (status !== 'approved') {
      reports.push({ taskId, channel, status, action: 'not_approved' });
      continue;
    }
    if (!channel || !permitted.has(channel)) {
      reports.push({ taskId, channel, status, action: 'channel_not_permitted' });
      continue;
    }
    if (!resolveTransport(channel)) {
      reports.push({ taskId, channel, status, action: 'no_transport' });
      continue;
    }

    const dispatched: DispatchResult = await dispatchInternalOutreachTask(companyId, taskId, {
      now: options.now,
      recipient: options.recipient ?? null,
      region: options.region ?? null,
    });

    reports.push({
      taskId,
      channel,
      status,
      action: 'dispatched',
      outcome: String(dispatched.outcome),
      reason: dispatched.reason ? String(dispatched.reason) : undefined,
      governance: dispatched.governance?.decision ? String(dispatched.governance.decision) : undefined,
    });
  }

  return reports;
}

/**
 * The activation entry point: materialise, then dispatch whatever is approved.
 *
 * On a first run for a lead this materialises tasks and dispatches nothing —
 * new tasks are `pending` and await a human approval. That is the intended
 * shape, not an incomplete run.
 *
 * Never throws. An activation failure must not propagate into whatever
 * operator surface invoked it.
 */
export async function runOutreachActivation(
  companyId: string,
  leadId: string,
  options: ActivationOptions = {},
): Promise<ActivationReport> {
  const ranAt = options.now ?? new Date().toISOString();
  const permittedChannels = [...(options.channels ?? DEFAULT_ACTIVATION_CHANNELS)];

  const base: ActivationReport = {
    companyId,
    leadId,
    ranAt,
    plannerVersion: ENGINE_VERSION,
    planPresent: false,
    planGeneratedAt: null,
    permittedChannels,
    registeredChannels: [],
    materialization: null,
    tasks: [],
    dispatched: 0,
  };

  try {
    ensureTransports();
    base.registeredChannels = supportedChannels();

    const materialized = await materializeOutreachForLead(companyId, leadId, options);
    base.planPresent = materialized.planPresent;
    base.planGeneratedAt = materialized.planGeneratedAt;
    base.materialization = materialized.result;

    if (!materialized.planPresent) {
      base.blocked = materialized.reason;
      return base;
    }
    if (options.previewOnly === true) {
      base.blocked = 'previewOnly — nothing written and nothing dispatched';
      return base;
    }

    base.tasks = await dispatchApprovedOutreachForLead(companyId, leadId, options);
    base.dispatched = base.tasks.filter((t) => t.action === 'dispatched').length;
    return base;
  } catch (error) {
    logger.error('outreach.activation.failed', {
      companyId,
      leadId,
      error: error instanceof Error ? error.message : String(error),
    });
    base.blocked = `activation failed: ${error instanceof Error ? error.message : String(error)}`;
    return base;
  }
}

/**
 * Advance a materialised task to `approved` — submit, then decide.
 *
 * Exposed so an operator surface can drive the documented approval path
 * (M3) rather than writing task state directly, which would bypass the
 * compare-and-set transitions that make a contested approval safe. The
 * approver's identity is required: an approval with no attributable decider is
 * not an approval.
 */
export async function approveOutreachTaskForOperator(
  companyId: string,
  taskId: string,
  approverUserId: string,
  reason: string,
  notes: string | null = null,
): Promise<{ ok: boolean; status?: string; reason?: string }> {
  const submitted = await submitForApproval(companyId, taskId);
  if (!submitted.ok && submitted.status !== 'awaiting_approval') {
    return { ok: false, status: submitted.status, reason: submitted.reason ? String(submitted.reason) : 'submission refused' };
  }
  const decided = await approveOutreachTask(companyId, taskId, { approverUserId, reason, notes });
  return {
    ok: decided.ok === true,
    status: decided.status ? String(decided.status) : undefined,
    reason: decided.reason ? String(decided.reason) : undefined,
  };
}

export type { OutreachTask };
