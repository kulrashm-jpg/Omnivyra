import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/outreach/approve
 *
 * WS-6A — the human gate, exposed.
 *
 * WHY THIS IS A SEPARATE ROUTE FROM ACTIVATION. WS-3 built the approval
 * workflow (M3) BEFORE it built any capability to dispatch, so that the gate
 * provably blocked before there was anything to block. Folding approval into
 * the activation call would collapse that ordering into a single operator
 * action and make "materialise" and "authorise a real action" the same click.
 * They are different decisions and they stay different endpoints.
 *
 * It drives the documented path — `submitForApproval` then
 * `approveOutreachTask` — rather than writing task state directly, so the
 * compare-and-set transitions that make a contested approval safe still apply:
 * exactly one approver can win.
 *
 * The approver's identity is taken from the AUTHENTICATED principal, never from
 * the request body. An approval attributed to a caller-supplied string is not an
 * audit record, and this table is append-only precisely so that it is one.
 *
 * Auth: requireAdminRateLimit + requireCapability(SUPER_ADMIN_DASHBOARD_VIEW).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security/SecurityCapabilities';
import { approveOutreachTaskForOperator } from '../../../../backend/services/leadOutreachActivation';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:outreach-approve', 60, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'operator approves a lead outreach task',
  });
  // { ok: false, sent: true } is TRUTHY — a falsy check here would let a denied
  // request continue into execution. Compare the discriminant explicitly.
  if (guard.ok !== true) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(body.companyId);
  const taskId = str(body.taskId);
  const reason = str(body.reason);
  if (!companyId || !taskId || !reason) {
    return res.status(400).json({ error: 'companyId, taskId and reason are required' });
  }

  // Identity from the resolved principal, not the body. `requireCapability`
  // already authenticated the caller; trusting a body field here would let one
  // operator record an approval under another's name in an append-only audit
  // table, which is the one thing that table exists to prevent.
  const approverUserId = str(guard.principal.userId);
  if (!approverUserId) {
    return res.status(403).json({ error: 'no attributable approver identity on the request' });
  }

  const result = await approveOutreachTaskForOperator(
    companyId,
    taskId,
    approverUserId,
    reason,
    str(body.notes),
  );

  return res.status(result.ok ? 200 : 409).json({ ok: result.ok, status: result.status, reason: result.reason });
}

export default __createApiRoute(handler, { route: '/api/super-admin/outreach/approve' });
