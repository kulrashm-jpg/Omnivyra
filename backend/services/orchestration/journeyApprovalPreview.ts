/**
 * What a person would be approving: a read-only preview of one journey email, and a hash
 * that binds an approval to exactly that message (TENANT-JOURNEY-APPROVAL-DESIGN.md).
 *
 * THIS GRANTS NOTHING, and writes nothing: the send path's own read-only preparation
 * supplies the content, so this can never disagree with what would really be sent. D-02:
 * the tenant approval surface (`journeyApproval.ts`) shows it; the approval itself binds to
 * `approvalBinding.computeApprovalBinding`, which wraps `approvalPreviewHash` with the
 * execution action, and is re-checked at dispatch.
 *
 * The address is masked. The hash covers the full address, so a changed recipient changes
 * it without the preview ever holding the address.
 *
 * A refusal is part of the answer: a message that could not be sent is shown with its
 * reason, never hidden, and has no hash, so there is nothing to approve.
 */

import { getOutreachTaskById } from '../leadOutreachExecution';
import { approvalPreviewHash } from '../leadOutreachExecution/approvalBinding';
import { EmailSendPathError, prepareEmailSend } from '../emailEngine/emailSendPath';
import { getProgressionStep } from '../workflowExecution/stepProgressionStore';
import { getExecutionInstance, TERMINAL_LIFECYCLE_STATES } from '../executionInstances/executionInstanceStore';
import { channelRefusal } from './journeyGovernance';
import { loadIndividualFacts } from './individualIntelligence';
import { listJourneyDecisions } from './journeyDecisionLog';

export interface JourneyApprovalPreview {
  readonly organizationId: string;
  readonly outreachTaskId: string;
  readonly status: string;
  readonly channel: string;
  /** Null when the message could not be sent; `refusal` then says why. */
  readonly content: { readonly subject: string; readonly body: string } | null;
  readonly recipient: { readonly personId: string; readonly maskedEmail: string } | null;
  readonly refusal: string | null;
  readonly workflow: { readonly workflowId: string; readonly workflowVersionId: string; readonly executionInstanceId: string; readonly stepKey: string | null } | null;
  /** Why this needs approval at all. */
  readonly authorization: { readonly executionMode: string; readonly workflowRequiresApproval: boolean; readonly policySource: string } | null;
  /** The earliest time the clock made it eligible. Gates are evaluated at send, so this is not a promise. */
  readonly timing: { readonly readyAt: string | null; readonly delayAfterPreviousHours: number | null } | null;
  /** What would stop it now. Approval does not lift any of these. */
  readonly wouldBeBlockedBy: readonly string[];
  /** This run's earlier decisions, as codes. */
  readonly history: ReadonlyArray<{ readonly stepKey: string | null; readonly decision: string; readonly outcome: string | null; readonly decidedAt: string }>;
  /** Null when there is nothing to approve. */
  readonly previewHash: string | null;
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Stable over the fields that define the message. Delimited so no two inputs can run together.
 * D-02: defined beside the approval binding that wraps it, unchanged, and re-exported here.
 */
export { approvalPreviewHash };

/** One email task's preview. Null when the task is not in this tenant. */
export async function buildEmailApprovalPreview(
  organizationId: string,
  outreachTaskId: string,
  now: string,
): Promise<JourneyApprovalPreview | null> {
  const task = await getOutreachTaskById(organizationId, outreachTaskId);
  if (task === null) return null;

  const base = {
    organizationId, outreachTaskId, status: String(task.status), channel: String(task.channel),
  };
  const refused = (refusal: string, wouldBeBlockedBy: readonly string[] = []): JourneyApprovalPreview => ({
    ...base, content: null, recipient: null, refusal, workflow: null, authorization: null, timing: null, wouldBeBlockedBy, history: [], previewHash: null,
  });

  if (task.status !== 'pending' && task.status !== 'awaiting_approval') return refused('not_awaiting_approval');

  let prepared;
  try {
    prepared = await prepareEmailSend(organizationId, outreachTaskId);
  } catch (e) {
    if (e instanceof EmailSendPathError) return refused(e.code);
    throw e;
  }
  const { context, recipient, rendered } = prepared;

  const step = await getProgressionStep(organizationId, context.executionPlanStepId);
  const facts = await loadIndividualFacts(organizationId, { kind: context.subjectKind, id: context.subjectId }, now);
  const gate = await channelRefusal(organizationId, 'email');
  const decisions = await listJourneyDecisions(organizationId, context.executionInstanceId);
  const run = await getExecutionInstance(organizationId, context.executionInstanceId);
  const runOpen = run !== null && !(TERMINAL_LIFECYCLE_STATES as readonly string[]).includes(run.lifecycleState);

  return {
    ...base,
    content: { subject: rendered.subject, body: rendered.body },
    recipient: { personId: recipient.personId, maskedEmail: maskEmail(recipient.email) },
    refusal: null,
    workflow: {
      workflowId: context.workflowId, workflowVersionId: context.workflowVersionId,
      executionInstanceId: context.executionInstanceId, stepKey: step?.stepKey ?? null,
    },
    authorization: {
      executionMode: context.executionMode, workflowRequiresApproval: context.workflowRequiresApproval, policySource: context.policySource,
    },
    timing: { readyAt: step?.readyAt ?? null, delayAfterPreviousHours: step?.delayAfterPreviousHours ?? null },
    wouldBeBlockedBy: [
      ...(runOpen ? [] : ['run_ended']),
      ...(gate === null ? [] : [gate]),
      ...(facts.facts.email_permitted === true ? [] : ['email_not_permitted']),
    ],
    history: decisions.map((d) => ({ stepKey: d.stepKey, decision: d.decision, outcome: d.outcome, decidedAt: d.decidedAt })),
    previewHash: approvalPreviewHash({
      organizationId, outreachTaskId, subject: rendered.subject, body: rendered.body, channel: 'email', email: recipient.email, workflowVersionId: context.workflowVersionId,
    }),
  };
}
