/**
 * D-02 — what an outreach approval is bound to, and whether it still authorises a send.
 *
 * An approval authorises ONE thing: this task, through this channel, doing this action,
 * with this content. `computeApprovalBinding` reduces that to a SHA-256 hash. The hash is
 * recorded on the approval row when a human approves (`approval.ts`), and recomputed at the
 * final execution boundary — the dispatch eligibility gate (`governance.ts`, loaded by
 * `governanceService.ts`) — by `resolveApprovalAuthority`. Any edit to what the hash covers
 * after approval makes the recorded hash disagree, and the gate refuses with
 * `approval_stale`.
 *
 * ─── WHAT THE HASH COVERS ─────────────────────────────────────────────────
 *   journey email (a 040-bridged task on the email channel): the existing approval-preview
 *     hash — organization, task, rendered subject and body, channel, the full canonical
 *     address and the frozen workflow version — computed from `prepareEmailSend`, the same
 *     read-only preparation the send path renders with, so it describes what would really
 *     be sent;
 *   any other task: organization, task, channel, kind, action, lead, person and plan key,
 *     the fields that define what a non-journey task would do; for an external channel also
 *     the recipient, which is not on the task: the approver names it at approval, and the
 *     gate binds in the address the send would go to. An approval naming none sends nowhere.
 * Both are wrapped with the execution action itself (`dispatch` on the task's channel,
 * kind and action), so a change of action invalidates the approval even where it would not
 * change a rendered byte. No content revision id exists at this base; when one does
 * (contract P-1), it belongs in the wrapper.
 *
 * ─── WHAT AUTHORISES ──────────────────────────────────────────────────────
 * Only the LATEST decision on the append-only log, and only when it is an `approved` row
 * that carries a well-formed hash equal to the current binding, decided less than seven
 * days before the evaluation instant, and — for an external channel — carrying the
 * passkey evidence recorded with it and sent only to the address it binds. Everything
 * else refuses, and fails closed:
 *   stale      — no approval, a legacy row with no hash (never backfilled), no passkey
 *                evidence on an external approval (or one not taken in the five minutes
 *                before the decision), a non-journey external approval naming no
 *                recipient, a `decided_at` in the future, content
 *                that can no longer be prepared, or content/action changed since approval;
 *   expired    — at or past the seven-day lifetime;
 *   revoked    — the latest decision is a revocation;
 *   recipient_mismatch — the send would go to an address the approval does not bind;
 *   unverified — the approval log, or the content behind it, could not be READ.
 * The same rule (minus the content hash) is enforced again by the database at the claim
 * (migration 20270120000011), and `assertRenderedEmailApproved` re-checks the hash over
 * the final render.
 *
 * Reads only, except the two re-review writers and the expiry, all compare-and-set from
 * the status read and nothing else (no decision, claim, quota, attempt or approval row):
 *   settleRefusedApproval — after the gate refused: an expired approval ends the task in the
 *     EXISTING `expired` status (no second expiry mechanism); a STALE one sends the task back
 *     to `awaiting_approval` for a fresh human approval. Every other refusal leaves it as is;
 *   requestFreshApproval  — the explicit resubmit of a task whose approval is stale.
 * Nothing here approves. A re-reviewed task is approved again only through `approval.ts`,
 * which recomputes and records a NEW binding; the old approval row stays as history.
 */

import { createHash } from 'crypto';
import { getOutreachTaskById, readApprovalHistory, transitionOutreachTaskState } from './storage';
import { recordLifecycleTransition } from './telemetry';
import { isTransitionAllowed } from './lifecycle';
import { BRIDGED_TASK_PLANNER_VERSION, resolveEmailExecutionContext } from '../emailEngine/emailExecutionContext';
import { APPROVAL_PROOF_MAX_AGE_MS } from './approvalPasskey';
import type { ApprovalAuthority, GovernanceEvaluation } from './governance';
import type { OutreachTask, OutreachTaskStatus } from './types';

/** Seven days from the approval's `decided_at`. Not configurable per tenant. */
export const APPROVAL_LIFETIME_DAYS = 7;
export const APPROVAL_LIFETIME_MS = APPROVAL_LIFETIME_DAYS * 24 * 3_600_000;
export const APPROVAL_BINDING_VERSION = 'outreach.approval.v1';
/** The eligibility rule the gate reports for a lapsed approval. */
export const APPROVAL_EXPIRED_RULE = 'eligibility.approval_expired';

const HEX64 = /^[0-9a-f]{64}$/;
const sha256 = (parts: unknown[]): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

export const isWellFormedApprovalHash = (v: unknown): v is string => typeof v === 'string' && HEX64.test(v);

/** A task a journey handed to WS-3 — the same stamp the D-03 hold keys on. */
export const isJourneyTask = (task: Pick<OutreachTask, 'plannerVersion'>): boolean =>
  task.plannerVersion === BRIDGED_TASK_PLANNER_VERSION;

/**
 * The approval-preview hash: what a person approving a journey email is shown. Kept here,
 * beside the binding that wraps it, and re-exported unchanged by `journeyApprovalPreview`.
 */
export function approvalPreviewHash(input: {
  organizationId: string; outreachTaskId: string; subject: string; body: string; channel: string; email: string; workflowVersionId: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify([input.organizationId, input.outreachTaskId, input.subject, input.body, input.channel, input.email, input.workflowVersionId]))
    .digest('hex');
}

/** The one channel that contacts nobody. Every other channel is external execution. */
const NON_EXTERNAL_CHANNEL = 'internal';
export const isExternalChannel = (task: Pick<OutreachTask, 'channel'>): boolean => task.channel !== NON_EXTERNAL_CHANNEL;

/** How an address is compared and bound: trimmed, lower-cased; empty is no address. */
export const normalizeRecipient = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : null;

/**
 * Every key on both variants, so callers read `code`/`reason` without strict narrowing.
 * `recipient` is the address the approval is bound to: the canonical address for a journey
 * email, the approver-named address for any other external task, null for internal.
 */
export type ApprovalBinding =
  | { ok: true; hash: string; kind: 'journey_email' | 'task'; recipient: string | null; code?: undefined; reason?: undefined }
  | { ok: false; code: string; reason: string; hash?: undefined; kind?: undefined; recipient?: undefined };

/** The journey-email binding over given content: shared by the approval and the post-render check. */
function journeyEmailBindingHash(companyId: string, task: OutreachTask & { id: string }, content: {
  subject: string; body: string; email: string | null; workflowVersionId: string;
}): string {
  const contentHash = approvalPreviewHash({
    organizationId: companyId, outreachTaskId: task.id, subject: content.subject, body: content.body,
    channel: 'email', email: normalizeRecipient(content.email) ?? '', workflowVersionId: content.workflowVersionId,
  });
  return sha256([APPROVAL_BINDING_VERSION, companyId, task.id, 'dispatch', task.channel, task.kind, task.action, contentHash]);
}

/**
 * The binding of `task` as it is NOW. Never throws.
 *
 * `recipient` is read only for a NON-journey external task. Its address is not on the
 * task, so the approver names it at approval and the gate binds in the address the
 * dispatcher would send to: a different address gives a different hash, and an approval
 * that named none matches no send (S-04). A journey email binds its canonical address and
 * ignores `recipient`; an internal task contacts nobody and binds none.
 */
export async function computeApprovalBinding(
  companyId: string, task: OutreachTask, options: { recipient?: string | null } = {},
): Promise<ApprovalBinding> {
  if (!task.id) return { ok: false, code: 'task_not_found', reason: 'the task has no id' };
  const id = task.id;

  if (isJourneyTask(task) && task.channel === 'email') {
    try {
      // Loaded on use: the send path imports the dispatcher, which loads this module.
      const { prepareEmailSend } = await import('../emailEngine/emailSendPath');
      const { context, recipient, rendered } = await prepareEmailSend(companyId, id);
      return {
        ok: true,
        kind: 'journey_email',
        recipient: normalizeRecipient(recipient.email),
        hash: journeyEmailBindingHash(companyId, { ...task, id }, {
          subject: rendered.subject, body: rendered.body, email: recipient.email, workflowVersionId: context.workflowVersionId,
        }),
      };
    } catch (e) {
      const code = typeof (e as { code?: unknown })?.code === 'string' ? String((e as { code: string }).code) : 'binding_unavailable';
      return { ok: false, code, reason: `the message cannot be prepared (${code}), so there is nothing to bind an approval to` };
    }
  }

  // `explanation` too: the non-engine email transport sends it as the body (emailTransport.ts).
  const fields: unknown[] = ['ws3.task.v1', companyId, id, task.channel, task.kind, task.action, task.leadId, task.personId, task.planTaskId, task.explanation ?? null];
  const recipient = isExternalChannel(task) ? normalizeRecipient(options.recipient) : null;
  if (isExternalChannel(task)) fields.push(['recipient', recipient]);
  return {
    ok: true,
    kind: 'task',
    recipient,
    hash: sha256([APPROVAL_BINDING_VERSION, companyId, id, 'dispatch', task.channel, task.kind, task.action, sha256(fields)]),
  };
}

const refused = (verdict: ApprovalAuthority['verdict'], reason: string, decidedAt: string | null = null, expiresAt: string | null = null): ApprovalAuthority =>
  ({ verdict, reason, decidedAt, expiresAt });

/** Codes from `prepareEmailSend` that mean a READ failed, not that the content is unsendable. */
const READ_FAILURE_CODES: readonly string[] = ['context_error', 'recipient_error'];

/**
 * Tolerated difference between the database clock (which stamps `decided_at`) and this
 * process's clock, before an approval counts as recorded in the future.
 */
const CLOCK_SKEW_MS = 60_000;

/**
 * Whether the approval of record still authorises `task` at `at`. Never throws: any
 * failure is a refusal.
 *
 * `at` is the caller's instant; expiry is judged at the LATER of it and this server's
 * clock, so a caller can never move the evaluation back into an approval's lifetime (T2).
 * `dispatch` is given by the dispatch gate: the address the send would go to, which must
 * be the address the approval is bound to (S-04). Without it (an explicit resubmit) the
 * recipient is not judged.
 */
export async function resolveApprovalAuthority(
  companyId: string, task: OutreachTask, at: string, dispatch?: { recipient: string | null },
): Promise<ApprovalAuthority> {
  if (!task.id) return refused('stale', 'the task has no id');
  let history: Array<Record<string, unknown>>;
  try {
    const read = await readApprovalHistory(companyId, task.id);
    if (read.ok === false) return refused('unverified', `the approval log could not be read (${read.error}); nothing is sent`);
    history = read.approvals;
  } catch (e) {
    return refused('unverified', `the approval log could not be read (${e instanceof Error ? e.message : String(e)}); nothing is sent`);
  }
  const latest = history.length > 0 ? history[history.length - 1] : null;
  if (latest === null) return refused('stale', 'no approval is on record; a fresh approval is required');

  const decision = String(latest.decision ?? '');
  if (decision === 'revoked') return refused('revoked', 'the approval was revoked');
  if (decision !== 'approved') return refused('stale', `the latest decision is "${decision}", not an approval; a fresh approval is required`);

  const decidedAt = typeof latest.decided_at === 'string' ? latest.decided_at : null;
  const decidedMs = decidedAt === null ? Number.NaN : Date.parse(decidedAt);
  const serverMs = Date.now();
  const callerMs = Date.parse(at);
  const atMs = Number.isFinite(callerMs) ? Math.max(callerMs, serverMs) : serverMs;
  if (!Number.isFinite(decidedMs)) {
    return refused('stale', 'the approval time cannot be established; a fresh approval is required', decidedAt);
  }
  // T1 — the database stamps `decided_at` and refuses a future one; this is the same rule here.
  if (decidedMs > serverMs + CLOCK_SKEW_MS) {
    return refused('stale', 'the approval is recorded as given in the future, so its lifetime cannot be trusted; a fresh approval is required', decidedAt);
  }
  const expiresAt = new Date(decidedMs + APPROVAL_LIFETIME_MS).toISOString();
  if (atMs >= decidedMs + APPROVAL_LIFETIME_MS) {
    return refused('expired', `the approval lapsed at ${expiresAt}, ${APPROVAL_LIFETIME_DAYS} days after it was given`, decidedAt, expiresAt);
  }

  const approvedHash = latest.approved_content_hash;
  if (!isWellFormedApprovalHash(approvedHash)) {
    return refused('stale', 'the approval predates content binding and records no content hash; a fresh approval is required', decidedAt, expiresAt);
  }
  // S-02 — an approval of external execution is only ever recorded with passkey evidence.
  // One without it (a legacy row, or one written around the approval writer) authorises nothing.
  if (isExternalChannel(task) && (typeof latest.passkey_credential_id !== 'string' || latest.passkey_credential_id === '')) {
    return refused('stale', 'the approval carries no passkey verification; a fresh, passkey-verified approval is required', decidedAt, expiresAt);
  }
  // L-1 — the verification backs THIS decision: taken in the five minutes before it, never after.
  if (isExternalChannel(task)) {
    const verifiedMs = Date.parse(String(latest.passkey_verified_at ?? ''));
    if (!Number.isFinite(verifiedMs) || verifiedMs > decidedMs + CLOCK_SKEW_MS || verifiedMs < decidedMs - APPROVAL_PROOF_MAX_AGE_MS) {
      return refused('stale', 'the passkey verification was not made at the time of the approval; a fresh, passkey-verified approval is required', decidedAt, expiresAt);
    }
  }
  const sendTo = dispatch ? normalizeRecipient(dispatch.recipient) : null;
  if (dispatch && isExternalChannel(task) && sendTo === null) {
    return refused('recipient_mismatch', 'no recipient was given for an external send; an approval authorises only the address it is bound to', decidedAt, expiresAt);
  }
  // L-3/L-4 — a non-journey external approval stores the address it names (also inside the
  // hash). The hash is recomputed over THAT address, so a wrong send address is a mismatch,
  // not a change, and a resubmit without a send address does not mistake it for stale.
  const namesRecipient = isExternalChannel(task) && !(isJourneyTask(task) && task.channel === 'email');
  const bound = namesRecipient ? normalizeRecipient(latest.approved_recipient) : null;
  if (namesRecipient && bound === null) {
    return refused('stale', 'the approval names no recipient, so it authorises no external send; a fresh approval naming one is required', decidedAt, expiresAt);
  }
  const current = await computeApprovalBinding(companyId, task, { recipient: namesRecipient ? bound : sendTo });
  if (!current.ok) {
    return refused(READ_FAILURE_CODES.includes(current.code) ? 'unverified' : 'stale', current.reason, decidedAt, expiresAt);
  }
  if (current.hash !== approvedHash) {
    return refused('stale', 'the content or action changed after it was approved; a fresh approval is required', decidedAt, expiresAt);
  }
  // S-04 — a journey email goes only to the canonical address the approval bound. Checked
  // after the hash, so a real change still returns the task to review, while a caller's
  // wrong address on unchanged content refuses and leaves the task as it is. A non-journey
  // task is held to the address its approval stored, the same way.
  if (dispatch && (current.kind === 'journey_email' || namesRecipient) && current.recipient !== sendTo) {
    return refused('recipient_mismatch', 'the send recipient is not the address the approval is bound to; nothing is sent', decidedAt, expiresAt);
  }
  return { verdict: 'valid', reason: 'the approval matches the content and action it authorised', decidedAt, expiresAt };
}

/**
 * S-03 — the last check before a journey email leaves: the binding recomputed over the
 * EXACT strings the transport is about to hand the provider, and the address it is about
 * to send to, must equal the approved hash. The gate checked the content as it was then;
 * this closes the window between the gate and the render (claim, quota, attempt). Throws
 * on any mismatch or unreadable record; the transport turns that into a refusal with no
 * provider call. Reuses the binding function; nothing is stored.
 */
export async function assertRenderedEmailApproved(
  companyId: string, task: OutreachTask, rendered: { subject: string; body: string }, recipient: string | null,
): Promise<void> {
  const fail = (reason: string): never => {
    throw Object.assign(new Error(`${reason}; nothing was sent`), { code: 'approval_stale' });
  };
  if (!task.id) fail('the task has no id');
  const id = task.id as string;
  const read = await readApprovalHistory(companyId, id);
  if (read.ok === false) fail(`the approval log could not be read (${read.error})`);
  const history = read.ok ? read.approvals : [];
  const latest = history.length > 0 ? history[history.length - 1] : null;
  if (latest === null || String(latest.decision ?? '') !== 'approved' || !isWellFormedApprovalHash(latest.approved_content_hash)) {
    fail('no content-bound approval is on record for this message');
  }
  const context = await resolveEmailExecutionContext(companyId, id);
  const sent = journeyEmailBindingHash(companyId, { ...task, id }, {
    subject: rendered.subject, body: rendered.body, email: recipient, workflowVersionId: context.workflowVersionId,
  });
  if (sent !== (latest as Record<string, unknown>).approved_content_hash) {
    fail('the rendered message or its recipient differs from what was approved');
  }
}

/** The eligibility rule the gate reports for an approval that no longer binds the content. */
export const APPROVAL_STALE_RULE = 'eligibility.approval_stale';

/**
 * After the dispatch gate refused: settle the task's status for exactly two refusals, by
 * compare-and-set from the status the dispatcher read (a task another caller moved is left
 * alone). Writes nothing else. Returns the status to report.
 *   approval_expired → `expired` (the existing terminal status);
 *   approval_stale   → `awaiting_approval` (re-review: a fresh human approval is required).
 * Any other refusal — revoked, unverified, kill switch, suppression, region, rate limit —
 * leaves the task exactly as it was.
 */
export async function settleRefusedApproval(
  companyId: string, task: OutreachTask, evaluation: GovernanceEvaluation,
): Promise<OutreachTaskStatus> {
  if (!task.id || (task.status !== 'approved' && task.status !== 'queued')) return task.status;
  const to: OutreachTaskStatus | null = evaluation.blockingCondition === APPROVAL_EXPIRED_RULE
    ? 'expired'
    : evaluation.blockingCondition === APPROVAL_STALE_RULE ? 'awaiting_approval' : null;
  // The frozen transition table is authoritative: an edge it does not list is never taken.
  if (to === null || !isTransitionAllowed(task.status, to)) return task.status;
  // F-1 — never back to review when an earlier attempt may have reached the recipient: a
  // fresh approval could only lead to a second send, which dispatch refuses anyway.
  if (to === 'awaiting_approval' && (await priorAttemptProblem(companyId, task)) !== null) return task.status;
  const moved = await transitionOutreachTaskState(companyId, task.id, task.status, to);
  if (moved.ok && moved.changed) {
    recordLifecycleTransition(task.status, to);
    return to;
  }
  return task.status;
}

/**
 * F-1 — why a task must not be re-reviewed: an earlier attempt may have reached the
 * recipient. The dispatcher's own rule (`redispatchProblem`), so the two never disagree.
 * Loaded on use: the dispatcher imports this module.
 */
async function priorAttemptProblem(companyId: string, task: OutreachTask): Promise<string | null> {
  if (!task.id) return 'the task has no id';
  const { redispatchProblem } = await import('./dispatch');
  const { resolveTransport } = await import('./transport');
  // The transport that would send it decides external-ness, as in dispatch; where none is
  // registered in this process (a route), the channel does. Dispatch re-checks either way.
  return redispatchProblem(companyId, task.id, resolveTransport(task.channel)?.external ?? isExternalChannel(task));
}

/**
 * The explicit resubmit: send a task whose approval is STALE back to `awaiting_approval`
 * so a human can approve it afresh. Refused for any other verdict — a valid approval needs
 * no resubmission, and an expired, revoked or unreadable one is not stale. Approves nothing.
 */
export async function requestFreshApproval(
  companyId: string, taskId: string, at: string = new Date().toISOString(),
): Promise<{ ok: boolean; status: OutreachTaskStatus | null; reason: string }> {
  const task = await getOutreachTaskById(companyId, taskId);
  if (!task || !task.id) return { ok: false, status: null, reason: 'no such task for this tenant' };
  if (task.status === 'awaiting_approval') return { ok: true, status: 'awaiting_approval', reason: 'already awaiting approval' };
  if (task.status !== 'approved' && task.status !== 'queued') {
    return { ok: false, status: task.status, reason: `a task in "${task.status}" has no approval to resubmit` };
  }
  const authority = await resolveApprovalAuthority(companyId, task, at);
  if (authority.verdict !== 'stale') {
    return { ok: false, status: task.status, reason: `the approval is ${authority.verdict}, not stale; nothing to resubmit` };
  }
  if (!isTransitionAllowed(task.status, 'awaiting_approval')) {
    return { ok: false, status: task.status, reason: `${task.status} → awaiting_approval is not a permitted transition` };
  }
  const sentBefore = await priorAttemptProblem(companyId, task);
  if (sentBefore !== null) {
    return { ok: false, status: task.status, reason: `not resubmitted: ${sentBefore}; a fresh approval could never be sent` };
  }
  const moved = await transitionOutreachTaskState(companyId, task.id, task.status, 'awaiting_approval');
  if (!moved.ok) return { ok: false, status: task.status, reason: moved.error ?? 'transition failed' };
  if (!moved.changed) {
    const current = await getOutreachTaskById(companyId, taskId);
    return { ok: false, status: current?.status ?? null, reason: `task is no longer ${task.status}` };
  }
  recordLifecycleTransition(task.status, 'awaiting_approval');
  return { ok: true, status: 'awaiting_approval', reason: authority.reason };
}
