import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * G-11 — a company admin decides one opt-out review.
 *
 *   GET  /api/contact-optout-reviews/:id?company_id=<uuid>   -> { review }
 *   POST /api/contact-optout-reviews/:id?company_id=<uuid>   (or company_id in the body)
 *        { reopenChannels: ('email' | 'phone' | 'whatsapp')[], reason }
 *        -> { decision: { reviewId, decision, reopenedChannels, closedChannels, revokedIds,
 *                         closingRecordIds, preExistingHoldIds, heldByOtherReview, reinstatedHoldIds } }
 *
 * `reopenChannels` empty keeps every channel closed. A channel a STOP or an unsubscribe locked
 * is refused (400 `channel_locked`): only the person undoes their own opt-out. The channels
 * that stay closed are closed explicitly FIRST, then the review's adopted holds are revoked,
 * then the review is marked decided (optOutReview.decideOptOutReview). Allowed after the due
 * date, and again on a decided review (an admin may still reopen).
 *
 * Refusals: 400 bad request / `reason_required` / `unknown_channel` / `channel_locked`;
 * 403 not an admin of this company (a super-admin bypass included); 404 no such review in
 * this company; 409 `decision_race_lost`; 503 `governance_write_failed` (retryable; nothing
 * was reopened that was not closed first); 503 `reconcile_incomplete` (retryable: holds were
 * revoked and one owed to another pending review is not yet restored; retry the decision, and
 * its reconcile restores it; audited as `optout_review_reconcile_incomplete`).
 *
 * AUDIT: every applied decision is written to execution_audit (stage `suppression`, the
 * record lead-intelligence/execution writes when a suppression is released): `cancelled` for
 * a reopen, `suppressed` for keep-closed, with the review id, channels, revoked ids, the holds
 * left for another pending review (`held_by_other_review`) and any reinstated holds; never an
 * address. The review row itself keeps decided_by, decided_at and the reason.
 *
 * ─── AUTHORIZATION ────────────────────────────────────────────────────────
 * enforceCompanyAccess, then COMPANY_ADMIN in THIS company from the canonical tenant decision
 * (TenantGuard.assertTenantAccess, as lead-intelligence/execution's companyScopedRole), with
 * the platform super-admin bypass REFUSED. The actor is the authenticated principal, never a
 * body field.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { enforceCompanyAccess } from '../../../backend/services/userContextService';
import { assertTenantAccess } from '../../../backend/security/TenantGuard';
import { normalizePermissionRole, Role } from '../../../backend/services/rbacService';
import { recordExecutionAudit } from '../../../backend/services/execution/executionAuditService';
import { decideOptOutReview, getOptOutReview } from '../../../backend/services/orchestration/optOutReview';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const METHODS = ['GET', 'POST'];

/** As in index.ts: COMPANY_ADMIN by active membership in THIS company; no bypass. */
async function isCompanyAdmin(userId: string, companyId: string): Promise<boolean> {
  const decision = await assertTenantAccess({ userId, organizationId: companyId, options: { noPlatformBypass: true } });
  if (decision.ok !== true || decision.access.bypass) return false;
  return normalizePermissionRole(String(decision.access.role ?? '').trim().toUpperCase()) === Role.COMPANY_ADMIN;
}

const STATUS: Record<string, number> = {
  actor_required: 401, review_not_found: 404, decision_race_lost: 409, governance_write_failed: 503,
  reconcile_incomplete: 503,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!METHODS.includes(req.method ?? '')) {
    res.setHeader('Allow', METHODS.join(', '));
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const reviewId = str(req.query.id);
  if (!reviewId || !UUID.test(reviewId)) return res.status(400).json({ error: 'review id must be a uuid' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(req.query.company_id) ?? str(body.company_id);
  if (!companyId) return res.status(400).json({ error: 'company_id is required' });
  if (!UUID.test(companyId)) return res.status(400).json({ error: 'company_id must be a uuid' });

  const access = await enforceCompanyAccess({ req, res, companyId });
  if (!access) return;
  if (!(await isCompanyAdmin(access.userId, companyId))) {
    return res.status(403).json({ error: 'only an admin of this company decides its opt-outs', code: 'company_admin_required' });
  }

  if (req.method === 'GET') {
    try {
      const review = await getOptOutReview(companyId, reviewId);
      if (!review) return res.status(404).json({ error: 'no such review', code: 'review_not_found' });
      return res.status(200).json({ review });
    } catch {
      return res.status(503).json({ error: 'the review could not be read', code: 'review_unreadable' });
    }
  }

  const decided = await decideOptOutReview({
    organizationId: companyId,                      // the VERIFIED tenant
    reviewId,
    actorUserId: access.userId,                     // the authenticated person, never the body's
    reopenChannels: body.reopenChannels,
    reason: body.reason,
  });
  if (decided.ok !== true) {
    // A partly applied decision (holds revoked, a reinstatement still owed) is audited too.
    if (decided.code === 'reconcile_incomplete' && decided.applied) {
      await recordExecutionAudit({
        companyId,
        stage: 'suppression',
        decision: decided.applied.decision === 'reopen' ? 'cancelled' : 'suppressed',
        reason: 'optout_review_reconcile_incomplete',
        actor: access.userId,
        evidence: {
          review_id: decided.applied.reviewId,
          recorded: decided.applied.recorded,
          revoked_ids: decided.applied.revokedIds,
          held_by_other_review: decided.applied.heldByOtherReview,
          closing_record_ids: decided.applied.closingRecordIds,
        },
      });
    }
    return res.status(STATUS[decided.code] ?? 400).json({
      error: decided.reason, code: decided.code, ...(decided.channels ? { channels: decided.channels } : {}),
    });
  }
  await recordExecutionAudit({
    companyId,
    stage: 'suppression',
    decision: decided.decision === 'reopen' ? 'cancelled' : 'suppressed',
    reason: `optout_review_${decided.decision}`,
    actor: access.userId,
    evidence: {
      review_id: decided.reviewId,
      reopened_channels: decided.reopenedChannels,
      closed_channels: decided.closedChannels,
      revoked_ids: decided.revokedIds,
      closing_record_ids: decided.closingRecordIds,
      held_by_other_review: decided.heldByOtherReview,
      reinstated_hold_ids: decided.reinstatedHoldIds,
    },
  });
  return res.status(200).json({
    decision: {
      reviewId: decided.reviewId, decision: decided.decision, reopenedChannels: decided.reopenedChannels,
      closedChannels: decided.closedChannels, revokedIds: decided.revokedIds, closingRecordIds: decided.closingRecordIds,
      preExistingHoldIds: decided.preExistingHoldIds, heldByOtherReview: decided.heldByOtherReview,
      reinstatedHoldIds: decided.reinstatedHoldIds,
    },
  });
}

export default __createApiRoute(handler, { route: '/api/contact-optout-reviews/[id]' });
