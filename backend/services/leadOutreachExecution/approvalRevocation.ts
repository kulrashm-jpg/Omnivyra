/**
 * D-02 — revoking an outreach approval.
 *
 * Kept OUT of `approval.ts` deliberately: that module moves a task only through the
 * approval segment of the lifecycle (pinned by ws3Milestone3Approval.test.ts), and a
 * revocation must also stop a task an earlier dispatch returned to `queued`.
 *
 * Append-only and compare-and-set, like every other decision:
 *   1. the task must be `approved` or `queued`, and its latest decision an approval;
 *   2. the task moves to the existing terminal `cancelled` status by compare-and-set, so
 *      a task a dispatcher already claimed (`dispatching` or later) cannot be revoked,
 *      and exactly one caller wins;
 *   3. only then a `revoked` row is appended. The approval it withdraws is kept as it was.
 * The dispatch gate independently refuses any task whose latest decision is `revoked`
 * (`approvalBinding.resolveApprovalAuthority`).
 */

import { appendApproval, getOutreachTaskById, listApprovals, transitionOutreachTaskState } from './storage';
import { explainTransition, isTransitionAllowed } from './lifecycle';
import { recordFailure, recordLifecycleTransition, recordStageOutcome } from './telemetry';
import type { ApprovalActionResult, ApprovalRefusal } from './approval';

const trim = (v: unknown, max = 2000): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t.slice(0, max);
};

const refuse = (taskId: string, refusal: ApprovalRefusal, reason: string, status: ApprovalActionResult['status'] = null): ApprovalActionResult => {
  recordStageOutcome('approval', refusal === 'storage_failure' ? 'failed' : 'refused');
  if (refusal === 'storage_failure') recordFailure('approval', reason);
  return { ok: false, taskId, status, changed: false, refusal, reason };
};

export async function revokeOutreachApproval(
  companyId: string,
  taskId: string,
  input: { approverUserId: string; reason?: string | null; notes?: string | null; decidedAt?: string; tier?: 'tenant' | 'platform' | null },
): Promise<ApprovalActionResult> {
  const approver = trim(input?.approverUserId, 200);
  if (!approver) return refuse(taskId, 'missing_approver', 'an approver identity is required');

  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id) return refuse(taskId, 'task_not_found', 'no such task for this tenant');
  if (task.status !== 'approved' && task.status !== 'queued') {
    return refuse(taskId, 'invalid_state', `a task in "${task.status}" has no approval that can still be revoked`, task.status);
  }
  if (!isTransitionAllowed(task.status, 'cancelled')) {
    return refuse(taskId, 'invalid_state', explainTransition(task.status, 'cancelled'), task.status);
  }
  const history = await listApprovals(companyId, taskId);
  const latest = history.length > 0 ? String(history[history.length - 1].decision ?? '') : '';
  if (latest !== 'approved') return refuse(taskId, 'not_revocable', 'the latest decision on record is not an approval', task.status);

  const moved = await transitionOutreachTaskState(companyId, task.id, task.status, 'cancelled');
  if (!moved.ok) return refuse(taskId, 'storage_failure', moved.error ?? 'transition failed', task.status);
  if (!moved.changed) {
    const current = await getOutreachTaskById(companyId, taskId);
    return refuse(taskId, 'already_decided', `task is no longer ${task.status}${current ? ` (now ${current.status})` : ''}`, current?.status ?? null);
  }
  recordLifecycleTransition(task.status, 'cancelled');

  const audit = await appendApproval({
    companyId,
    taskId: task.id,
    decision: 'revoked',
    approverUserId: approver,
    reason: trim(input.reason) ?? 'approval revoked',
    notes: trim(input.notes),
    missingInformation: [],
    decidedAt: trim(input.decidedAt, 40) ?? new Date().toISOString(),
    tier: input.tier ?? null,
  });
  const result: ApprovalActionResult = { ok: true, taskId, status: 'cancelled', changed: true };
  if (!audit.ok) recordFailure('approval', audit.error);
  return audit.ok ? result : { ...result, auditFailed: true, reason: audit.error };
}
