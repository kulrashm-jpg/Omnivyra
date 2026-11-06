import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';
/**
 * POST /api/outreach/journey-approval
 *
 * D-02 — the ROUTINE approval surface for a journey step handed to WS-3. Tenant tier: the
 * approver is an authorised human in the task's own organisation.
 *
 *   { action: 'begin',   companyId, taskId }
 *       → { contentHash, preview, passkeyRequired, passkeyOptions }
 *   { action: 'approve', companyId, taskId, expectedContentHash, passkey, reason?, notes? }
 *   { action: 'revoke',  companyId, taskId, reason?, notes? }
 *   { action: 'resubmit', companyId, taskId, reason? }   — a STALE approval back to review (D-02);
 *       the authenticated requester is recorded in `audit_logs` (N2)
 *
 * WHO. `requireCapability(OUTREACH_JOURNEY_APPROVE)` in `companyId`: held through
 * COMPANY_ADMIN and CONTENT_REVIEWER only, and decided per organisation (CPG-060), so a
 * role in another tenant never satisfies it. `enforceRole` is NOT used: SUPER_ADMIN passes
 * every `enforceRole` list. A platform super-admin is refused here outright even when they
 * also hold a tenant role — they are not the routine approver; the platform override is
 * `/api/super-admin/outreach/approve`, and its rows are labelled `platform`.
 *
 * The approver is the authenticated principal, never a body field.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../backend/security/requireCapability';
import { isPlatformSuperAdminPrincipal } from '../../../backend/security/platformCapabilities';
import { authRequestIpOrNull } from '../../../backend/auth/requestClientIp';
import { requireAdminRateLimit } from '../../../backend/services/requestAccessService';
import { OUTREACH_JOURNEY_APPROVE } from '../../../shared/contracts/security/SecurityCapabilities';
import {
  approveTenantJourneyTask,
  beginTenantJourneyApproval,
  resubmitTenantJourneyTask,
  revokeTenantJourneyApproval,
  type TenantApprovalRefusal,
} from '../../../backend/services/orchestration/journeyApproval';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

const STATUS: Record<TenantApprovalRefusal, number> = {
  task_not_found: 404,
  not_a_journey_task: 409,
  expected_hash_required: 400,
  approval_stale: 409,
  binding_unavailable: 409,
  self_approval_not_permitted: 403,
  self_approval_unverifiable: 403,
  passkey_required: 401,
  passkey_wrong_binding: 401,
  passkey_stale: 401,
  passkey_replayed: 401,
  passkey_rejected: 401,
  decision_refused: 409,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})) as Record<string, unknown>;
  const companyId = str(body.companyId);
  const taskId = str(body.taskId);
  const action = str(body.action);
  if (!companyId || !taskId || (action !== 'begin' && action !== 'approve' && action !== 'revoke' && action !== 'resubmit')) {
    return res.status(400).json({ error: 'companyId, taskId and action (begin | approve | revoke | resubmit) are required' });
  }

  const guard = await requireCapability(req, res, {
    capability: OUTREACH_JOURNEY_APPROVE,
    organizationId: companyId,
    reason: `tenant approver ${action} on a journey outreach task`,
    resourceId: taskId,
  });
  // { ok: false, sent: true } is truthy: compare the discriminant.
  if (guard.ok !== true) return;
  const principal = guard.principal;
  if (principal.legacyCookieSuperAdmin || isPlatformSuperAdminPrincipal(principal)) {
    return res.status(403).json({
      error: 'a platform super-admin is not a routine approver; use the platform override',
      code: 'PLATFORM_PRINCIPAL_NOT_ROUTINE_APPROVER',
    });
  }
  const approverUserId = str(principal.userId);
  if (!approverUserId) return res.status(403).json({ error: 'no attributable approver identity on the request' });
  // W2 — every `begin` writes a WebAuthn challenge row; bounded by the existing limiter.
  if (action === 'begin' && !(await requireAdminRateLimit(req, res, 'rl:outreach:journey-approval-begin', 30, 60))) return;

  const actor = {
    organizationId: companyId, taskId, approverUserId,
    ip: authRequestIpOrNull(req),
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
  };
  const out = action === 'begin'
    ? await beginTenantJourneyApproval(actor)
    : action === 'approve'
      ? await approveTenantJourneyTask({ ...actor, expectedContentHash: body.expectedContentHash, passkey: body.passkey, reason: str(body.reason), notes: str(body.notes) })
      : action === 'resubmit'
        ? await resubmitTenantJourneyTask({ ...actor, reason: str(body.reason) })
        : await revokeTenantJourneyApproval({ ...actor, reason: str(body.reason), notes: str(body.notes) });

  if (out.ok !== true) return res.status(STATUS[out.code] ?? 409).json({ ok: false, code: out.code, reason: out.reason });
  return res.status(200).json(out);
}

export default __createApiRoute(handler, { route: '/api/outreach/journey-approval' });
