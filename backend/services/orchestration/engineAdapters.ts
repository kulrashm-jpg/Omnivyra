/**
 * Engine adapters — the orchestrator's ONE interface to the engines.
 *
 * THE ORCHESTRATOR OWNS THE JOURNEY; EACH ENGINE OWNS ITS EXECUTION. An adapter
 * turns one ready journey step into a request of an existing engine, through that
 * engine's existing entry points, and reports back how the step should settle.
 * It never re-implements an engine's gates: WS-3 governance/approval/quota and
 * the WhatsApp contact-governance gate stay inside their engines and are
 * authoritative.
 *
 * Dispositions:
 *   completed    the engine executed the action        → step `completed`
 *   skipped      no suitable action for this person, or a human declined it
 *                                                       → step `skipped` (advances)
 *   wait         in flight / awaiting approval / deferred → step stays `ready`
 *   needs_human  an outcome only a person may resolve   → step stays `ready`, reported
 *
 * `failed` is never chosen automatically: a failed step blocks the chain for good,
 * so it remains an explicit human settlement (PI-041-A-K D2).
 *
 * THE ADAPTER CONTRACT (every engine, 2026-10-28):
 *   request         one call of `execute` per ready step; the step's task is the unit.
 *   authorization   the engine's OWN tenant, permission, approval, consent,
 *                   suppression, quota and kill-switch gates decide; an adapter
 *                   never bypasses or duplicates them, and a gate refusal is
 *                   reported (`needs_human` or `skipped`), never retried around.
 *   idempotency     `executionTaskId` is the key. An engine without its own
 *                   per-task record uses `execution_engine_requests` (unique per
 *                   task; claim `requested → submitting` before calling the engine;
 *                   `external_ref` set once). Re-running `execute` for the same
 *                   task must never cause a second external action.
 *   status          `outcome` is the engine's own word for what happened;
 *                   `disposition` is how the journey settles (above).
 *   external ref    the engine's own id for the work, or null before one exists.
 *   timestamps      the engine's records and the request ledger carry them; the
 *                   result carries none.
 *   errors          classified by consequence, not by exception type:
 *                     definitely not acted (refused, invalid, disabled) → `skipped`
 *                       or `needs_human`, never retried around a gate;
 *                     transiently not acted, provably before any external call → `wait`;
 *                     MAY have acted (timeout, crash, lost response after the call)
 *                       → `needs_human` with outcome `uncertain`; NEVER auto-retried.
 *   unsupported     a channel or action the engine cannot perform is reported, never
 *                   re-routed to another engine or approximated.
 * Adapters do not throw for engine refusals; a thrown error is an adapter defect.
 */

import { bridgeExecutionTask } from '../outreachBridge/outreachBridgeStore';
import {
  dispatchInternalOutreachTask,
  getOutreachTaskById,
  submitForApproval,
} from '../leadOutreachExecution';
import { readAttemptHistory } from '../leadOutreachExecution/storage';
import { dispatchWorkflowEmailTask, ensureWorkflowTransports } from '../emailEngine/workflowEmailDispatch';
import { resolveEmailRecipient } from '../emailEngine/emailExecutionContext';
import { renderEmailContent } from '../emailEngine/emailContentGenerator';
import type { SubjectRef } from '../executionSubject/subjectRef';
import type { WorkflowStep } from '../workflows/workflowStore';
import type { EngineCapabilityDeclaration } from './executionContract';
import { WS3_CAPABILITIES } from './engineCapabilities';

/**
 * Every engine an adapter may front. Owned by the integration owner: adapters add
 * themselves here only through that owner (one shared union, one ledger CHECK —
 * 20261231000001 — kept in step by orchestrationEngineContract.test.ts).
 */
export const ENGINE_NAMES = ['ws3', 'whatsapp', 'social_publish', 'community', 'browser'] as const;
export type EngineName = typeof ENGINE_NAMES[number];
export type EngineDisposition = 'completed' | 'skipped' | 'wait' | 'needs_human';

export interface EngineStepContext {
  readonly organizationId: string;
  readonly executionInstanceId: string;
  readonly executionTaskId: string;
  readonly planStepId: string;
  readonly channel: string;
  readonly subject: SubjectRef;
  /** The authored step from the run's frozen definition snapshot. */
  readonly step: WorkflowStep | null;
  readonly personId: string | null;
  readonly now?: string;
  /**
   * This step's conditions no longer hold, and it reached the engine only because the engine
   * may already hold the action. The engine reports what it holds and begins nothing new.
   */
  readonly holdOnly?: boolean;
}

export interface EngineResult {
  readonly engine: EngineName;
  /** The engine's own vocabulary (dispatch outcome, recipient status, …). */
  readonly outcome: string;
  readonly disposition: EngineDisposition;
  /** A code-level reason. Never personal data. */
  readonly reason: string | null;
  /** The engine's own id for the work, when one exists. */
  readonly externalRef: string | null;
}

export interface EngineAdapter {
  readonly engine: EngineName;
  readonly channels: readonly string[];
  /** The contract declaration (executionContract.ts). Must match `channels`. */
  readonly capabilities?: EngineCapabilityDeclaration;
  execute(ctx: EngineStepContext): Promise<EngineResult>;
}

const errCode = (e: unknown): string => String((e as { code?: string } | null)?.code ?? 'engine_error');

// ── WS-3 lead outreach ──────────────────────────────────────────────────────

export interface Ws3AdapterDeps {
  bridge: typeof bridgeExecutionTask;
  getTask: typeof getOutreachTaskById;
  submitForApproval: typeof submitForApproval;
  dispatch: typeof dispatchInternalOutreachTask;
  registerTransports: () => void;
  /** The certified Email Engine: recipient, render and the send path. */
  resolveRecipient: typeof resolveEmailRecipient;
  renderContent: typeof renderEmailContent;
  sendEmail: typeof dispatchWorkflowEmailTask;
  /** Absent in a fake that never requeues. */
  readAttempts?: typeof readAttemptHistory;
}

export const defaultWs3Deps: Ws3AdapterDeps = {
  bridge: bridgeExecutionTask,
  getTask: getOutreachTaskById,
  submitForApproval,
  dispatch: dispatchInternalOutreachTask,
  registerTransports: () => ensureWorkflowTransports(),
  resolveRecipient: resolveEmailRecipient,
  renderContent: renderEmailContent,
  sendEmail: dispatchWorkflowEmailTask,
  readAttempts: readAttemptHistory,
};

/**
 * Did a provider already refuse this task? WS-3 returns a refused task to `queued` and
 * treats the refusal as "not sent", which is right for a person retrying it and wrong for
 * a clock: every sweep would call the provider again with the same request. So the sweep
 * stops at the first refusal and leaves the step with a person. `disabled` never reached
 * a provider and stays free to go once the transport is enabled.
 */
async function providerAlreadyRefused(deps: Ws3AdapterDeps, organizationId: string, taskId: string): Promise<boolean | null> {
  if (deps.readAttempts === undefined) return false;
  const history = await deps.readAttempts(organizationId, taskId);
  if (history.ok === false) return null;
  return history.evidence.some((e) => (e.transport_response as Record<string, unknown> | null)?.outcome === 'rejected');
}

const SKIP_FOR_THIS_PERSON = new Set(['email_missing', 'email_invalid', 'personalization_missing']);

/**
 * Could this person be emailed this step? "No address" and "no value for a placeholder
 * the step uses" are facts about the person, so the step is skipped; anything else is
 * an authoring or data defect a person must look at. A failed read decides nothing.
 */
async function emailPreflight(
  deps: Ws3AdapterDeps,
  ctx: EngineStepContext,
): Promise<{ code: string; disposition: EngineDisposition; reason: string } | null> {
  const instruction = ctx.step?.instruction ?? null;
  if (instruction === null || instruction.trim() === '') {
    return { code: 'no_authored_content', disposition: 'needs_human', reason: 'the email step authored no instruction' };
  }
  if (ctx.personId === null) {
    return { code: 'person_unresolved', disposition: 'skipped', reason: 'no canonical person to email' };
  }
  try {
    const recipient = await deps.resolveRecipient(ctx.organizationId, ctx.personId);
    deps.renderContent({ instruction, personalization: recipient.personalization });
    return null;
  } catch (e) {
    const code = errCode(e);
    if (SKIP_FOR_THIS_PERSON.has(code)) return { code, disposition: 'skipped', reason: code };
    if (code === 'recipient_error') return { code, disposition: 'wait', reason: 'the person could not be read' };
    return { code, disposition: 'needs_human', reason: code };
  }
}

/**
 * WS-3: the existing bridge materializes exactly one `outreach_tasks` row per
 * execution task (DB-unique), then the existing dispatcher acts on it.
 *
 * APPROVAL. A step that needs no workflow approval is bridged `pending`, and WS-3
 * governance refuses a task that was never approved. Absence of a workflow
 * approval requirement is therefore NOT permission to dispatch: the adapter
 * SUBMITS such a task for human approval (`pending → awaiting_approval`) through
 * the WS-3 approval API and waits. Autonomous dispatch needs a tenant autonomy
 * policy the owner has not authorized; until then every WS-3 action is
 * human-approved. This is the one place the conflict is resolved, explicitly.
 *
 * EMAIL goes through the certified Email Engine (backend/services/emailEngine): the
 * authored step `instruction` is the content, the canonical person is the recipient,
 * and what was sent is recorded before the provider is called. The same recipient and
 * render checks run here BEFORE anything is bridged, so a task never reaches a person's
 * approval queue when it could not be sent. The engine's own refusal still stands at
 * send time: this is an early answer, not a second authority.
 */
export function createWs3Adapter(deps: Ws3AdapterDeps = defaultWs3Deps): EngineAdapter {
  const result = (outcome: string, disposition: EngineDisposition, reason: string | null, externalRef: string | null): EngineResult =>
    ({ engine: 'ws3', outcome, disposition, reason, externalRef });

  return {
    engine: 'ws3',
    channels: ['internal', 'email'],
    capabilities: WS3_CAPABILITIES,
    async execute(ctx) {
      const isEmail = ctx.channel === 'email';
      if (isEmail) {
        const refusal = await emailPreflight(deps, ctx);
        if (refusal !== null) return result(refusal.code, refusal.disposition, refusal.reason, null);
      }

      deps.registerTransports();
      let handoff;
      try {
        ({ handoff } = await deps.bridge({ organizationId: ctx.organizationId, executionTaskId: ctx.executionTaskId }));
      } catch (e) {
        const code = errCode(e);
        // An unsupported channel or an unresolved person cannot be fixed by
        // retrying the sweep; a person must look. Neither is settled.
        return result(code, 'needs_human', code, null);
      }
      const taskId = String(handoff.outreachTaskId);
      const task = await deps.getTask(ctx.organizationId, taskId);
      if (!task) return result('task_unreadable', 'wait', 'outreach task could not be read', taskId);

      switch (task.status) {
        case 'pending': {
          const submitted = await deps.submitForApproval(ctx.organizationId, taskId);
          return result(
            'awaiting_approval', 'wait',
            submitted.ok ? 'autonomous dispatch is not authorized; submitted for human approval' : `approval submission failed: ${submitted.reason ?? 'unknown'}`,
            taskId,
          );
        }
        case 'awaiting_approval':
          return result('awaiting_approval', 'wait', 'awaiting human approval', taskId);
        case 'approved':
        case 'queued': {
          const refused = await providerAlreadyRefused(deps, ctx.organizationId, taskId);
          if (refused === null) return result('attempts_unreadable', 'wait', 'the attempt history could not be read', taskId);
          if (refused) return result('provider_refused_prior_attempt', 'needs_human', 'the provider refused this message; a person decides what happens next', taskId);
          let out;
          if (isEmail) {
            try {
              ({ dispatch: out } = await deps.sendEmail({
                organizationId: ctx.organizationId,
                executionTaskId: ctx.executionTaskId,
                ...(ctx.now === undefined ? {} : { now: ctx.now }),
              }));
            } catch (e) {
              // A refusal before the dispatcher ran: no attempt, nothing sent.
              const code = errCode(e);
              return result(code, 'needs_human', code, taskId);
            }
          } else {
            out = await deps.dispatch(ctx.organizationId, taskId, ctx.now === undefined ? {} : { now: ctx.now });
          }
          const outcome = String(out.outcome);
          if (outcome === 'sent') return result('sent', 'completed', null, taskId);
          if (outcome === 'blocked_governance' || outcome === 'blocked_prior_attempt' || outcome === 'failed' || outcome === 'rejected' || outcome === 'timeout') {
            return result(outcome, 'needs_human', out.reason ?? outcome, taskId);
          }
          // deferred_*, skipped_transport_disabled, skipped_already_dispatched, …
          return result(outcome, 'wait', out.reason ?? outcome, taskId);
        }
        case 'dispatching':
          return result('dispatching', 'wait', 'a dispatch is in flight', taskId);
        case 'sent':
        case 'delivered':
        case 'completed':
          return result(task.status, 'completed', null, taskId);
        case 'rejected':
          return result('rejected', 'skipped', 'a human declined this action', taskId);
        case 'cancelled':
        case 'expired':
          return result(task.status, 'skipped', `the outreach task was ${task.status}`, taskId);
        default:
          return result(String(task.status), 'needs_human', `outreach task is ${String(task.status)}`, taskId);
      }
    },
  };
}

// ── Registry ────────────────────────────────────────────────────────────────

/** Channel → adapter. A channel with no adapter is visibly unsupported, never re-routed. */
export function buildAdapterRegistry(adapters: readonly EngineAdapter[]): ReadonlyMap<string, EngineAdapter> {
  const map = new Map<string, EngineAdapter>();
  for (const a of adapters) {
    for (const c of a.channels) {
      if (map.has(c)) throw new Error(`two engine adapters claim the "${c}" channel`);
      map.set(c, a);
    }
  }
  return map;
}
