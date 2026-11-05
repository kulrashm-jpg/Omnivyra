/**
 * D-02 — a tenant approver's decision on a journey task handed to WS-3.
 *
 * The routine approval surface (`pages/api/outreach/journey-approval.ts`) calls this after
 * it has established WHO may approve: an authorised tenant approver (COMPANY_ADMIN or
 * CONTENT_REVIEWER, through `OUTREACH_JOURNEY_APPROVE` in the target organisation), never a
 * platform super-admin. This module decides whether THIS approval may be recorded:
 *
 *   1. the task is in the tenant and a journey handed it off (only journey tasks have a
 *      frozen workflow version, so only they have a routine tenant approver);
 *   2. the content the approver was shown is still the content (`expectedContentHash` must
 *      equal the binding recomputed now, else `approval_stale`);
 *   3. the approver did not publish or author the workflow version, unless the tenant turned
 *      self-approval on (`outreach_governance_config.self_approval_allowed`, default off);
 *   4. for any channel that contacts someone outside the platform, a fresh passkey
 *      verification bound to exactly this approval (`approvalPasskey.ts`).
 * Then it records the decision through the one approval path, `approveOutreachTask`, which
 * recomputes and stores the binding hash and labels the row `tenant`.
 *
 * AI never reaches here: nothing in this module is called by a generation, recommendation
 * or agent path, and an approval requires an authenticated human's passkey.
 */

import {
  approveOutreachTask,
  submitForApproval,
  type ApprovalActionResult,
} from '../leadOutreachExecution/approval';
import { revokeOutreachApproval } from '../leadOutreachExecution/approvalRevocation';
import { getOutreachTaskById } from '../leadOutreachExecution/storage';
import { loadTenantGovernanceConfig } from '../leadOutreachExecution/governanceService';
import { computeApprovalBinding, isJourneyTask, isWellFormedApprovalHash, requestFreshApproval } from '../leadOutreachExecution/approvalBinding';
import { beginApprovalPasskey, verifyApprovalPasskey } from '../leadOutreachExecution/approvalPasskey';
import { resolveEmailExecutionContext } from '../emailEngine/emailExecutionContext';
import { getWorkflowVersion } from '../workflows/workflowStore';
import { buildEmailApprovalPreview, type JourneyApprovalPreview } from './journeyApprovalPreview';
import type { OutreachTask } from '../leadOutreachExecution/types';

/** The one channel that contacts nobody; every other channel is external execution. */
const NON_EXTERNAL_CHANNEL = 'internal';
export const requiresApprovalPasskey = (task: Pick<OutreachTask, 'channel'>): boolean => task.channel !== NON_EXTERNAL_CHANNEL;

export type TenantApprovalRefusal =
  | 'task_not_found'
  | 'not_a_journey_task'
  | 'expected_hash_required'
  | 'approval_stale'
  | 'binding_unavailable'
  | 'self_approval_not_permitted'
  | 'self_approval_unverifiable'
  | 'passkey_required'
  | 'passkey_wrong_binding'
  | 'passkey_stale'
  | 'passkey_replayed'
  | 'passkey_rejected'
  | 'decision_refused';

export type TenantApprovalOutcome<T> =
  | ({ ok: true } & T)
  | { ok: false; code: TenantApprovalRefusal; reason: string; decision?: ApprovalActionResult };

interface Actor {
  readonly organizationId: string;
  readonly taskId: string;
  readonly approverUserId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

const no = (code: TenantApprovalRefusal, reason: string, decision?: ApprovalActionResult) =>
  ({ ok: false as const, code, reason, ...(decision ? { decision } : {}) });

async function journeyTask(a: Actor): Promise<OutreachTask | { ok: false; code: TenantApprovalRefusal; reason: string }> {
  const task = await getOutreachTaskById(a.organizationId, a.taskId);
  if (task === null || !task.id) return no('task_not_found', 'no such task in this tenant');
  if (!isJourneyTask(task)) return no('not_a_journey_task', 'only a task a journey handed off has a routine tenant approver');
  return task;
}
const refusedTask = (t: unknown): t is { ok: false; code: TenantApprovalRefusal; reason: string } =>
  (t as { ok?: unknown }).ok === false;

/**
 * Null when the approver may approve; otherwise why not. "Self" is the approver being the
 * person who published the frozen workflow version the task runs, or who authored it
 * (`created_by`, S-01). Applied on BOTH surfaces: this tenant route and the platform
 * override (`leadOutreachActivation.approveOutreachTaskForOperator`). Fails closed: a
 * version that cannot be read, or that names no publisher, refuses.
 */
export async function selfApprovalRefusal(
  organizationId: string, taskId: string, approverUserId: string,
): Promise<{ code: TenantApprovalRefusal; reason: string } | null> {
  const config = await loadTenantGovernanceConfig(organizationId);
  if (config.selfApprovalAllowed === true) return null;
  let publishedBy: string | null;
  let createdBy: string | null = null;
  try {
    const context = await resolveEmailExecutionContext(organizationId, taskId);
    const version = await getWorkflowVersion(organizationId, context.workflowVersionId);
    publishedBy = version?.publishedBy ?? null;
    createdBy = version?.createdBy ?? null;
  } catch {
    publishedBy = null;
  }
  if (publishedBy === null) {
    return { code: 'self_approval_unverifiable', reason: 'who published this workflow version cannot be established, so self-approval cannot be ruled out' };
  }
  const me = approverUserId.trim().toLowerCase();
  if (publishedBy.toLowerCase() === me) {
    return { code: 'self_approval_not_permitted', reason: 'you published this workflow version; another approver must approve it (self-approval is off for this tenant)' };
  }
  if (createdBy !== null && createdBy.toLowerCase() === me) {
    return { code: 'self_approval_not_permitted', reason: 'you authored this workflow version; another approver must approve it (self-approval is off for this tenant)' };
  }
  return null;
}

/**
 * What the approver is about to approve, the hash that binds it, and — for an external
 * channel — the passkey ceremony bound to that hash. Writes only the WebAuthn challenge.
 */
export async function beginTenantJourneyApproval(a: Actor & { readonly now?: string }): Promise<TenantApprovalOutcome<{
  contentHash: string; preview: JourneyApprovalPreview | null; passkeyRequired: boolean; passkeyOptions: unknown | null;
}>> {
  const task = await journeyTask(a);
  if (refusedTask(task)) return task;
  const binding = await computeApprovalBinding(a.organizationId, task);
  if (!binding.ok) return no('binding_unavailable', binding.reason);
  const self = await selfApprovalRefusal(a.organizationId, a.taskId, a.approverUserId);
  if (self !== null) return no(self.code, self.reason);

  const preview = task.channel === 'email'
    ? await buildEmailApprovalPreview(a.organizationId, a.taskId, a.now ?? new Date().toISOString())
    : null;
  const passkeyRequired = requiresApprovalPasskey(task);
  const passkeyOptions = passkeyRequired
    ? await beginApprovalPasskey(
      { userId: a.approverUserId, organizationId: a.organizationId, taskId: a.taskId, action: 'approve', bindingHash: binding.hash },
      { ip: a.ip, userAgent: a.userAgent },
    )
    : null;
  return { ok: true, contentHash: binding.hash, preview, passkeyRequired, passkeyOptions };
}

/** Record a tenant approver's approval, bound to `expectedContentHash`. */
export async function approveTenantJourneyTask(a: Actor & {
  readonly expectedContentHash: unknown;
  readonly passkey: unknown;
  readonly reason?: string | null;
  readonly notes?: string | null;
}): Promise<TenantApprovalOutcome<{ status: string | null }>> {
  if (!isWellFormedApprovalHash(a.expectedContentHash)) {
    return no('expected_hash_required', 'the content hash the approver was shown is required');
  }
  const task = await journeyTask(a);
  if (refusedTask(task)) return task;

  const binding = await computeApprovalBinding(a.organizationId, task);
  if (!binding.ok) return no('binding_unavailable', binding.reason);
  if (binding.hash !== a.expectedContentHash) {
    return no('approval_stale', 'the content or action changed after it was shown; review it again');
  }

  const self = await selfApprovalRefusal(a.organizationId, a.taskId, a.approverUserId);
  if (self !== null) return no(self.code, self.reason);

  let passkeyProof: unknown = null;
  if (requiresApprovalPasskey(task)) {
    const passkey = await verifyApprovalPasskey(
      { userId: a.approverUserId, organizationId: a.organizationId, taskId: a.taskId, action: 'approve', bindingHash: binding.hash },
      a.passkey,
      { ip: a.ip, userAgent: a.userAgent },
    );
    if (passkey.ok !== true) return no(passkey.code, passkey.detail ?? passkey.code);
    // Redeemed by the approval writer, which refuses an external approval without it.
    passkeyProof = passkey.proof;
  }

  if (task.status === 'pending') {
    const submitted = await submitForApproval(a.organizationId, a.taskId);
    if (!submitted.ok) return no('decision_refused', submitted.reason ?? 'could not request approval', submitted);
  }
  const decided = await approveOutreachTask(a.organizationId, a.taskId, {
    approverUserId: a.approverUserId,
    reason: a.reason ?? 'tenant approver approved the journey step',
    notes: a.notes ?? null,
    expectedContentHash: binding.hash,
    tier: 'tenant',
    passkeyProof,
  });
  if (!decided.ok) {
    return no(decided.refusal === 'approval_stale' ? 'approval_stale' : 'decision_refused', decided.reason ?? 'the approval was refused', decided);
  }
  return { ok: true, status: decided.status };
}

/**
 * D-02 — re-review: a journey task whose approval no longer binds its content (stale) goes
 * back to `awaiting_approval`. Approves nothing: the fresh approval then needs `begin`
 * and `approve` again — new binding, self-approval rule, passkey.
 *
 * N2 — the requester is the authenticated approver the route resolved (`approverUserId`),
 * recorded with the accepted transition in `audit_logs` by `requestFreshApproval`.
 */
export async function resubmitTenantJourneyTask(a: Actor & { readonly reason?: string | null }):
Promise<TenantApprovalOutcome<{ status: string | null; auditFailed?: true }>> {
  const task = await journeyTask(a);
  if (refusedTask(task)) return task;
  const r = await requestFreshApproval(a.organizationId, a.taskId, undefined, {
    userId: a.approverUserId, reason: a.reason ?? null, tier: 'tenant',
  });
  if (!r.ok) return no('decision_refused', r.reason);
  return r.auditFailed ? { ok: true, status: r.status, auditFailed: true } : { ok: true, status: r.status };
}

/** Withdraw an approval before the task is sent: appends `revoked`, cancels the task. */
export async function revokeTenantJourneyApproval(a: Actor & { readonly reason?: string | null; readonly notes?: string | null }):
Promise<TenantApprovalOutcome<{ status: string | null }>> {
  const task = await journeyTask(a);
  if (refusedTask(task)) return task;
  const revoked = await revokeOutreachApproval(a.organizationId, a.taskId, {
    approverUserId: a.approverUserId,
    reason: a.reason ?? 'tenant approver revoked the approval',
    notes: a.notes ?? null,
    tier: 'tenant',
  });
  if (!revoked.ok) return no('decision_refused', revoked.reason ?? 'the revocation was refused', revoked);
  return { ok: true, status: revoked.status };
}
