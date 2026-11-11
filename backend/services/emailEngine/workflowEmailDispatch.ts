/**
 * PI-041-A-E — the production caller for Workflow-driven email.
 *
 * 041-A-D found that the certified Email Engine had no composition root and
 * nothing in the application called it, so a complete and verified engine was
 * unreachable. `registerDefaultTransports({ email: 'engine' })` supplies the
 * first; this module supplies the second.
 *
 * ─── IT IS A CALLER, NOT A SECOND IMPLEMENTATION ──────────────────────────
 * The whole body is: register the transports, translate an Execution Task into
 * the legacy task id the common dispatcher addresses, and hand over to
 * `sendEmailForOutreachTask`. There is no governance here, no approval, no quota,
 * no attempt, no render, no evidence and no provider — every one of those already
 * exists on the certified path and is reached through it.
 *
 * ─── THE TRANSLATION IS THE 040 HANDOFF, AND ONLY THE HANDOFF ─────────────
 * The new substrate identifies work by `execution_task_id`; Common Outreach
 * addresses work by `outreach_tasks.id`. The 040 handoff is the only sanctioned
 * mapping between them, and `(organization_id, execution_task_id)` is UNIQUE, so
 * one tenant-scoped read is the whole translation. Nothing here infers identity
 * from `lead_id`, which is a text column that cannot even express a subject kind.
 *
 * ─── NO HANDOFF MEANS NO SEND ─────────────────────────────────────────────
 * An Execution Task that has not been bridged is refused. It is NOT bridged here
 * as a convenience: bridging is a write that creates a legacy row and a mapping,
 * it belongs to 040, and performing it inside a send would make a dispatch
 * attempt silently mutate the execution record it is supposed to be acting on.
 * There is also no synthetic handoff, and no fallback to the placeholder email
 * path — 041-A-D forbade `if handoff exists → Engine else → legacy` because, with
 * one transport per channel per process, such a fallback is indistinguishable
 * from a bypass.
 *
 * ─── IT DECIDES NOTHING ABOUT PERMISSION ──────────────────────────────────
 * Whether this task may actually be sent is answered downstream, by the frozen
 * governance order `kill_switch → suppression → region → eligibility/approval →
 * rate_limit → transport`. An unapproved task — `human`, `assisted` or
 * `autonomous` alike — is held at the approval gate, and this module neither
 * approves nor consults the verdict. Email also remains behind
 * `LEAD_OUTREACH_EMAIL_ENABLED`, which is off in production.
 */
import { registerDefaultTransports } from '../leadOutreachExecution/transportRegistry';
import type { EmailProviderPort } from '../leadOutreachExecution/emailTransport';
import { getHandoffForTask } from '../outreachBridge/outreachBridgeStore';
import { sendEmailForOutreachTask, type EmailSendOutcome } from './emailSendPath';

export class WorkflowEmailDispatchError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorkflowEmailDispatchError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new WorkflowEmailDispatchError(message, code);
}

/**
 * Register the transports Workflow execution may use.
 *
 * The SAME selection the operator activation root makes, deliberately: the
 * registry is one process-global map keyed by channel, so the two roots must
 * agree or whichever ran last would decide for both. Both choose `'engine'`,
 * which means there is exactly one email transport in the process and it is the
 * Engine-aware one. Idempotent — `registerTransport` is a keyed `Map.set`.
 */
export function ensureWorkflowTransports(
  options: { emailProvider?: EmailProviderPort } = {},
): void {
  // The spread comes FIRST so that `email` is the last word: no caller, however
  // widely typed, can substitute the placeholder composition through `options`.
  registerDefaultTransports({ ...options, email: 'engine' });
}

/**
 * Send one bridged Execution Task as email, through the certified path.
 *
 * Returns the Engine's own outcome unchanged, including a governance block, an
 * approval hold or a provider refusal. Those are outcomes, not exceptions, and
 * reinterpreting them here would put a second opinion about a send next to the
 * one the dispatcher already recorded.
 */
export async function dispatchWorkflowEmailTask(input: {
  organizationId: string;
  executionTaskId: string;
  /** Injected instant, for deterministic tests. Threaded, never read here. */
  now?: string;
  /**
   * Injected provider port, defaulting to the platform's transactional-email
   * seam. The same seam `createEmailTransport` has always taken, threaded here
   * because this function composes the transports: without it, certification
   * could not exercise the real path without a network.
   */
  emailProvider?: EmailProviderPort;
}): Promise<EmailSendOutcome & { outreachTaskId: string }> {
  ensureWorkflowTransports(
    input.emailProvider === undefined ? {} : { emailProvider: input.emailProvider },
  );

  const handoff = await getHandoffForTask(input.organizationId, input.executionTaskId);
  if (handoff === null) {
    fail(
      'that execution task has no 040 handoff in this tenant; it cannot be sent until it is bridged',
      'handoff_not_found',
    );
  }

  const outreachTaskId = String(handoff.outreachTaskId ?? '');
  if (outreachTaskId === '') {
    // The 040 schema makes this NOT NULL, so reaching here means the mapping is
    // damaged rather than merely absent.
    fail('the handoff carries no legacy task', 'handoff_incomplete');
  }

  const sent = await sendEmailForOutreachTask({
    organizationId: input.organizationId,
    outreachTaskId,
    ...(input.now === undefined ? {} : { now: input.now }),
  });

  return { ...sent, outreachTaskId };
}
