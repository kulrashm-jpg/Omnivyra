/**
 * WS-3 Milestone-3 — approval workflow.
 *
 * Durable approval orchestration and NOTHING else. This module moves a task
 * through the approval segment of the frozen lifecycle and records every human
 * decision immutably. It does not evaluate governance, dispatch, enqueue, rate
 * limit, retry, deliver, or contact anything — none of that exists yet.
 *
 * ─── WHY COMPARE-AND-SET, NOT READ-THEN-WRITE ──────────────────────────────
 * Two approvers can open the same task. A read-then-write would let both
 * observe `awaiting_approval` and both proceed, producing two "authoritative"
 * decisions for one contact. Every transition here is a database-evaluated
 * compare-and-set: exactly one caller wins, and the loser is told the state it
 * actually found. Determinism under concurrency is the point of the whole
 * approval gate — without it the gate is decorative.
 *
 * ─── ORDERING: TRANSITION FIRST, THEN AUDIT ────────────────────────────────
 * These are two separate statements with no transaction spanning them, so one
 * of two imperfect orderings must be chosen:
 *   • audit first  → losers of a race litter the history with decisions that
 *                    never took effect, corrupting the record of what happened.
 *   • state first  → the winner is unambiguous, and only the winner writes.
 * State-first is chosen. The residual risk — a successful transition whose
 * audit append then fails — is reported explicitly as `auditFailed`, never
 * swallowed, so an operator sees a state change that lacks its record instead
 * of discovering it later during an incident.
 *
 * ─── A CONSTRAINT OF THE FROZEN LIFECYCLE, STATED PLAINLY ──────────────────
 * `rejected` and `cancelled` are TERMINAL. A rejected or cancelled task can
 * therefore never be "resubmitted" — nothing exits a terminal state. That is
 * not an omission here: the architecture's answer is that a regenerated plan
 * produces a NEW task rather than reviving a finished one. `resubmitForApproval`
 * consequently re-requests approval for a task still in `pending`, and is
 * idempotent for one already `awaiting_approval`.
 */

import {
  appendApproval,
  getOutreachTaskById,
  listApprovals,
  transitionOutreachTaskState,
} from './storage';
import { explainTransition, isTransitionAllowed } from './lifecycle';
import type { OutreachTask, OutreachTaskStatus } from './types';
import { recordFailure, recordLifecycleTransition, recordStageOutcome } from './telemetry';
import { computeApprovalBinding, isExternalChannel } from './approvalBinding';
import { redeemApprovalPasskeyProof } from './approvalPasskey';

/** The two decisions a human may record. Nothing else is a decision. */
export type ApprovalDecision = 'approved' | 'rejected';

/** Why an approval action was refused. A closed set — no free-form failures. */
export type ApprovalRefusal =
  | 'task_not_found'
  | 'missing_approver'
  | 'invalid_decision'
  | 'invalid_state'
  | 'already_decided'
  | 'storage_failure'
  // D-02
  | 'approval_stale'
  | 'binding_unavailable'
  | 'not_revocable'
  | 'passkey_required'
  | 'recipient_required';

export interface ApprovalActionResult {
  ok: boolean;
  taskId: string;
  /** The task's status AFTER the action (or the status that blocked it). */
  status: OutreachTaskStatus | null;
  /** True only when this call performed the transition. */
  changed: boolean;
  refusal?: ApprovalRefusal;
  reason?: string;
  /**
   * Set when the state moved but its audit record could not be written. The
   * action succeeded and the history is incomplete — both facts are surfaced.
   */
  auditFailed?: boolean;
}

export interface DecisionInput {
  approverUserId: string;
  /** Structured cause — answers "under which rule". */
  reason?: string | null;
  /** Free-text note the approver wrote. */
  notes?: string | null;
  /** Injected for determinism in tests; defaults to the current instant. */
  decidedAt?: string;
  /**
   * D-02 — the binding the approver was shown. When given and no longer equal to the
   * binding recomputed now, the approval is refused as `approval_stale` and nothing moves.
   * The recorded hash is ALWAYS the server's recomputation, never a caller's value.
   */
  expectedContentHash?: string | null;
  /** D-02 — which surface records the decision. */
  tier?: 'tenant' | 'platform' | null;
  /**
   * D-02 (S-02) — REQUIRED to approve a task on any external channel: the proof
   * `verifyApprovalPasskey` returned for this approver, task and binding. Nothing else
   * satisfies it (approvalPasskey.ts), so no caller can approve external execution
   * without a fresh passkey ceremony. Ignored for the internal channel and for rejections.
   */
  passkeyProof?: unknown;
  /**
   * D-02 (S-04) — for a NON-journey task on an external channel, the one address the
   * approval authorises. Bound into the hash; a dispatch to any other address, or an
   * approval that names none, is refused. A journey email binds its canonical address.
   */
  recipient?: string | null;
}

export interface ApprovalStateView {
  taskId: string;
  status: OutreachTaskStatus | null;
  requiresApproval: boolean;
  /** True when the task is currently waiting on a human. */
  awaitingDecision: boolean;
  /** The most recent recorded decision, if any. D-02: `revoked` withdrew an approval. */
  latestDecision: ApprovalDecision | 'revoked' | null;
  latestApproverUserId: string | null;
  latestDecidedAt: string | null;
  decisionCount: number;
}

const nowIso = (): string => new Date().toISOString();
const trim = (v: unknown, max = 2000): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

const refuse = (
  taskId: string,
  refusal: ApprovalRefusal,
  reason: string,
  status: OutreachTaskStatus | null = null,
): ApprovalActionResult => {
  // WS-3 M6 (observability only): a refusal is REFUSED, not failed — the gate
  // working is not the gate breaking. Only storage trouble is a failure.
  recordStageOutcome('approval', refusal === 'storage_failure' ? 'failed' : 'refused');
  if (refusal === 'storage_failure') recordFailure('approval', reason);
  return { ok: false, taskId, status, changed: false, refusal, reason };
};

/**
 * Move a task between two states and record nothing.
 *
 * Shared by every approval action. Validates against the frozen transition
 * table first, so an illegal move is refused deterministically before the
 * database is touched.
 */
async function attemptTransition(
  companyId: string,
  task: OutreachTask,
  to: OutreachTaskStatus,
): Promise<{ result: ApprovalActionResult; moved: boolean }> {
  const taskId = task.id as string;
  const from = task.status;

  if (!isTransitionAllowed(from, to)) {
    return {
      moved: false,
      result: refuse(taskId, 'invalid_state', explainTransition(from, to), from),
    };
  }

  const applied = await transitionOutreachTaskState(companyId, taskId, from, to);
  if (!applied.ok) {
    return { moved: false, result: refuse(taskId, 'storage_failure', applied.error ?? 'transition failed', from) };
  }
  if (!applied.changed) {
    // Lost a race, or the state moved between our read and our write. The
    // caller is told what the task actually is now, not what we expected.
    const current = await getOutreachTaskById(companyId, taskId);
    return {
      moved: false,
      result: refuse(
        taskId,
        'already_decided',
        `task is no longer ${from}${current ? ` (now ${current.status})` : ''}`,
        current?.status ?? null,
      ),
    };
  }

  // WS-3 M6 (observability only): the transition actually happened.
  recordLifecycleTransition(from, to);
  return { moved: true, result: { ok: true, taskId, status: to, changed: true } };
}

// ── request lifecycle ───────────────────────────────────────────────────────

/**
 * Submit a task for human approval: `pending → awaiting_approval`.
 *
 * Idempotent: a task already awaiting a decision returns success without
 * changing anything, because re-requesting a pending request is not an error.
 */
export async function submitForApproval(companyId: string, taskId: string): Promise<ApprovalActionResult> {
  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id) return refuse(taskId, 'task_not_found', 'no such task for this tenant');

  if (task.status === 'awaiting_approval') {
    return { ok: true, taskId, status: 'awaiting_approval', changed: false, reason: 'already awaiting approval' };
  }
  // D-02 — the lifecycle now also allows an approved task back to review, but only for a
  // stale approval and only through `approvalBinding` (settleRefusedApproval /
  // requestFreshApproval). Submission stays `pending → awaiting_approval` and nothing else.
  if (task.status !== 'pending' && isTransitionAllowed(task.status, 'awaiting_approval')) {
    return refuse(taskId, 'invalid_state', `a task in "${task.status}" returns to review only through a fresh-approval request`, task.status);
  }
  return (await attemptTransition(companyId, task, 'awaiting_approval')).result;
}

/**
 * Re-request approval. Identical to `submitForApproval` by design: a rejected
 * or cancelled task is terminal and cannot be revived — see the module header.
 */
export const resubmitForApproval = submitForApproval;

/**
 * Withdraw an approval request: `awaiting_approval → cancelled`.
 *
 * `cancelled` is TERMINAL. This ends the task permanently rather than returning
 * it to `pending`, because the frozen lifecycle has no path back and inventing
 * one here would silently widen the architecture.
 */
export async function cancelApprovalRequest(
  companyId: string,
  taskId: string,
  input: { approverUserId: string; reason?: string | null; notes?: string | null; decidedAt?: string },
): Promise<ApprovalActionResult> {
  const approver = trim(input?.approverUserId, 200);
  if (!approver) return refuse(taskId, 'missing_approver', 'an approver identity is required');

  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id) return refuse(taskId, 'task_not_found', 'no such task for this tenant');

  const { moved, result } = await attemptTransition(companyId, task, 'cancelled');
  if (!moved) return result;

  // A withdrawal is a human decision about contacting someone, so it is
  // recorded as a rejection in the immutable history rather than vanishing.
  const audit = await appendApproval({
    companyId,
    taskId: task.id,
    decision: 'rejected',
    approverUserId: approver,
    reason: trim(input.reason) ?? 'approval request cancelled',
    notes: trim(input.notes),
    missingInformation: [],
    decidedAt: trim(input.decidedAt, 40) ?? nowIso(),
  });
  return audit.ok ? result : { ...result, auditFailed: true, reason: audit.error };
}

// ── decisions ───────────────────────────────────────────────────────────────

async function recordDecision(
  companyId: string,
  taskId: string,
  decision: ApprovalDecision,
  input: DecisionInput,
): Promise<ApprovalActionResult> {
  if (decision !== 'approved' && decision !== 'rejected') {
    return refuse(taskId, 'invalid_decision', `"${String(decision)}" is not a decision`);
  }
  const approver = trim(input?.approverUserId, 200);
  if (!approver) return refuse(taskId, 'missing_approver', 'an approver identity is required');

  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id) return refuse(taskId, 'task_not_found', 'no such task for this tenant');

  // D-02 — an approval is bound to the exact content and action it authorises. The binding
  // is computed BEFORE the transition, so content that cannot be bound is never approved,
  // and an approver who was shown different content is refused with nothing moved.
  let approvedContentHash: string | null = null;
  let approvedRecipient: string | null = null;
  let passkey: { credentialId: string; verifiedAt: string } | null = null;
  if (decision === 'approved') {
    const binding = await computeApprovalBinding(companyId, task, { recipient: input.recipient ?? null });
    if (!binding.ok) return refuse(taskId, 'binding_unavailable', binding.reason, task.status);
    if (input.expectedContentHash != null && input.expectedContentHash !== binding.hash) {
      return refuse(taskId, 'approval_stale', 'the content or action changed after it was shown for approval; review it again', task.status);
    }
    // L-2 — a non-journey external task names the one address it authorises; without one
    // the gate could never let it send, so it is not recorded as approved at all.
    if (binding.kind === 'task' && isExternalChannel(task) && binding.recipient === null) {
      return refuse(taskId, 'recipient_required', 'an external non-journey approval must name the recipient it authorises', task.status);
    }
    approvedContentHash = binding.hash;
    approvedRecipient = binding.recipient;
    // S-02 — external execution is approved only with a fresh passkey verification bound
    // to exactly this approver, task and binding. No option, caller or tier skips it.
    if (isExternalChannel(task)) {
      const redeemed = redeemApprovalPasskeyProof(input.passkeyProof, {
        userId: approver, organizationId: companyId, taskId: task.id, bindingHash: binding.hash,
      });
      if (redeemed.ok !== true) return refuse(taskId, 'passkey_required', redeemed.reason, task.status);
      passkey = { credentialId: redeemed.credentialId, verifiedAt: redeemed.verifiedAt };
    }
  }

  const target: OutreachTaskStatus = decision === 'approved' ? 'approved' : 'rejected';
  const { moved, result } = await attemptTransition(companyId, task, target);
  if (!moved) return result;

  recordStageOutcome('approval', 'ok');
  // State first, then this row (module header). If this append fails the task is
  // `approved` with no bound approval on record, which the dispatch gate refuses.
  const audit = await appendApproval({
    companyId,
    taskId: task.id,
    decision,
    approverUserId: approver,
    reason: trim(input.reason),
    notes: trim(input.notes),
    missingInformation: [],
    decidedAt: trim(input.decidedAt, 40) ?? nowIso(),
    approvedContentHash,
    tier: input.tier ?? null,
    approvedRecipient,
    passkeyCredentialId: passkey?.credentialId ?? null,
    passkeyVerifiedAt: passkey?.verifiedAt ?? null,
  });
  // The decision took effect; say so, and say that its record did not.
  if (!audit.ok) recordFailure('approval', audit.error);
  return audit.ok ? result : { ...result, auditFailed: true, reason: audit.error };
}

/** `awaiting_approval → approved`. Exactly one caller can win. */
export const approveOutreachTask = (companyId: string, taskId: string, input: DecisionInput) =>
  recordDecision(companyId, taskId, 'approved', input);

/** `awaiting_approval → rejected` (terminal). Exactly one caller can win. */
export const rejectOutreachTask = (companyId: string, taskId: string, input: DecisionInput) =>
  recordDecision(companyId, taskId, 'rejected', input);

// ── retrieval ───────────────────────────────────────────────────────────────

/** Current approval state. Company-scoped; returns null state when not found. */
export async function getApprovalState(companyId: string, taskId: string): Promise<ApprovalStateView> {
  const task = await getOutreachTaskById(companyId, taskId);
  const history = task ? await listApprovals(companyId, taskId) : [];
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const latestDecision = latest ? (String((latest as Record<string, unknown>).decision) as ApprovalDecision | 'revoked') : null;

  return {
    taskId,
    status: task?.status ?? null,
    requiresApproval: task?.requiresApproval === true,
    awaitingDecision: task?.status === 'awaiting_approval',
    latestDecision: latestDecision === 'approved' || latestDecision === 'rejected' || latestDecision === 'revoked' ? latestDecision : null,
    latestApproverUserId: latest ? (trim((latest as Record<string, unknown>).approver_user_id, 200)) : null,
    latestDecidedAt: latest ? (trim((latest as Record<string, unknown>).decided_at, 40)) : null,
    decisionCount: history.length,
  };
}

/**
 * Full immutable decision history, oldest first. Never filtered — a rejected
 * decision that lost a race is not in here, because losers never write.
 */
export async function getApprovalHistory(companyId: string, taskId: string): Promise<Array<Record<string, unknown>>> {
  return listApprovals(companyId, taskId);
}
