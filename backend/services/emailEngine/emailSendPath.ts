/**
 * PI-041-A — the Email send path.
 *
 * The one entry point that takes a bridged outreach task and asks the EXISTING
 * common Outreach path to send it as email.
 *
 * ─── IT ORCHESTRATES NOTHING IT DOES NOT OWN ──────────────────────────────
 * Governance, suppression, `mayContact`, region, approval, rate limiting, attempt
 * identity and transport resolution all stay where they are. This module calls
 * `dispatchInternalOutreachTask` — the common dispatcher, named for its first
 * channel but channel-generic, since it resolves the transport from
 * `task.channel` — and that dispatcher runs
 *
 *   resolveTransport → evaluateTaskGovernance → reserveQuota → appendAttempt
 *                    → transport.send
 *
 * in exactly that order. Nothing here reorders it, duplicates it, or looks at a
 * gate's verdict to decide anything for itself.
 *
 * ─── WHY PREPARATION HAPPENS BEFORE DISPATCH ──────────────────────────────
 * Context, recipient and content are resolved and validated BEFORE the dispatcher
 * is called, because the dispatcher creates the attempt and an unsendable task
 * must not leave an attempt behind. So a missing handoff, an unresolvable person,
 * a missing address or an unauthored instruction all refuse with no attempt, no
 * evidence and no provider call.
 *
 * ─── AND WHY IT RENDERS TWICE ─────────────────────────────────────────────
 * The validating render above happens before the attempt; the authoritative
 * render happens inside `transport.send`, where the attempt id exists and the
 * evidence can be keyed to it. The generator is deterministic and both renders
 * use the same inputs, so they are byte-identical by construction — which is why
 * the pre-check can refuse early without the evidence ever describing something
 * other than what was sent.
 *
 * ─── AUTONOMY IS NOT PERMISSION ───────────────────────────────────────────
 * `execution_mode` is read for evidence and for reporting, never to decide
 * whether to send. A `human` step reaches the dispatcher exactly as an
 * `autonomous` one does, and the common approval gate is what holds it — which is
 * why this module cannot grant or remove an approval requirement even by mistake.
 */
import { dispatchInternalOutreachTask, type DispatchResult } from '../leadOutreachExecution/dispatch';
import { getOutreachTaskById } from '../leadOutreachExecution/storage';
import {
  resolveEmailExecutionContext, resolveEmailRecipient,
  type EmailExecutionContext, type EmailRecipient, EmailContextError,
} from './emailExecutionContext';
import { renderEmailContent, EmailContentError, type RenderedEmail } from './emailContentGenerator';
import { recordEmailContentEvidence } from './emailContentEvidenceStore';

export class EmailSendPathError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'EmailSendPathError';
    this.code = code;
  }
}

/** A declaration, not an arrow: only a declaration's `never` narrows control flow. */
function fail(message: string, code: string): never {
  throw new EmailSendPathError(message, code);
}

export interface EmailSendPreparation {
  readonly context: EmailExecutionContext;
  readonly recipient: EmailRecipient;
  readonly rendered: RenderedEmail;
}

/**
 * Resolve and validate everything a send needs, creating nothing.
 *
 * Exposed because "could this be sent, and what would it say?" is a question
 * worth answering without sending — and because the ASSISTED and HUMAN modes
 * need exactly that before a human decides.
 */
export async function prepareEmailSend(
  organizationId: string, outreachTaskId: string,
): Promise<EmailSendPreparation> {
  const task = await getOutreachTaskById(organizationId, outreachTaskId);
  if (task === null) fail('no such outreach task in this tenant', 'task_not_found');
  if (task.channel !== 'email') {
    fail(`that task is a "${task.channel}" task, not email`, 'wrong_channel');
  }

  let context: EmailExecutionContext;
  let recipient: EmailRecipient;
  try {
    context = await resolveEmailExecutionContext(organizationId, outreachTaskId);
    recipient = await resolveEmailRecipient(organizationId, context.personId);
  } catch (error) {
    if (error instanceof EmailContextError) fail(error.message, error.code);
    throw error;
  }

  let rendered: RenderedEmail;
  try {
    // The authored instruction, carried verbatim from the Workflow Version step
    // through the Plan snapshot onto the task.
    rendered = renderEmailContent({
      instruction: task.action,
      personalization: recipient.personalization,
    });
  } catch (error) {
    if (error instanceof EmailContentError) fail(error.message, error.code);
    throw error;
  }

  return { context, recipient, rendered };
}

export interface EmailSendOutcome {
  readonly prepared: EmailSendPreparation;
  readonly dispatch: DispatchResult;
}

/**
 * Send one bridged task as email, through the common path.
 *
 * Returns the dispatcher's own result unchanged — including a governance block, an
 * approval hold or a provider failure. Those are outcomes, not exceptions: the
 * dispatcher classifies them and this module must not reinterpret them.
 */
export async function sendEmailForOutreachTask(input: {
  organizationId: string;
  outreachTaskId: string;
  /** Injected instant, for deterministic tests. Threaded, never read here. */
  now?: string;
}): Promise<EmailSendOutcome> {
  const prepared = await prepareEmailSend(input.organizationId, input.outreachTaskId);

  const dispatch = await dispatchInternalOutreachTask(
    input.organizationId,
    input.outreachTaskId,
    {
      // The CANONICAL address, resolved from the person. Never a caller's.
      recipient: prepared.recipient.email,
      ...(input.now === undefined ? {} : { now: input.now }),
    },
  );

  return { prepared, dispatch };
}

/**
 * The content hook to give `createEmailTransport`.
 *
 * Deterministic and self-contained: it re-resolves context, recipient and render
 * from the task, so the strings it returns are the ones the provider receives.
 */
export function emailContentHook() {
  return async (request: { task: { companyId: string; id: string | null } }) => {
    const taskId = request.task.id;
    if (taskId === null) {
      throw new EmailSendPathError('the task has no id', 'task_not_found');
    }
    const prepared = await prepareEmailSend(request.task.companyId, taskId);
    return {
      subject: prepared.rendered.subject,
      body: prepared.rendered.body,
      personalizationInputs: {
        ...prepared.rendered.personalizationInputs,
        // Provenance of the address and of the policy that permitted this send,
        // recorded with the content so a reader need not rejoin to explain it.
        recipient_source_of_truth: prepared.recipient.sourceOfTruth ?? 'unknown',
        execution_mode: prepared.context.executionMode,
        policy_source: prepared.context.policySource,
      },
      contentSource: prepared.rendered.contentSource,
    };
  };
}

/** The evidence hook to give `createEmailTransport`. */
export function emailContentEvidenceHook() {
  return async (evidence: {
    organizationId: string;
    outreachAttemptId: string;
    renderedSubject: string;
    renderedBody: string;
    personalizationInputs: Record<string, unknown>;
    contentSource: string;
  }): Promise<void> => {
    await recordEmailContentEvidence(evidence);
  };
}
