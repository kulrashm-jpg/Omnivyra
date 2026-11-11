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
 * Auth (Closure-009, owner decision): requireAdminRateLimit +
 * requireCapability(OUTREACH_PLATFORM_MANAGE) — the dedicated outreach write
 * capability, with its passkey + trusted-device step-up — + platform write
 * authority (an ACTIVE platform SUPER_ADMIN role on a canonical principal, so a
 * direct capability_assignments grant alone is refused). All of it runs before
 * the task is read or anything is written.
 *
 * D-02: this is the PLATFORM OVERRIDE, not the routine approver (that is the tenant route
 * /api/outreach/journey-approval). Its rows are labelled `platform`. `{ phase: 'begin' }`
 * returns the content hash and, for an external channel, a passkey ceremony bound to this
 * one approval; the approval then carries `passkey` (and optionally `expectedContentHash`)
 * and is refused without a fresh, matching, unused verification.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { requirePlatformWriteAuthority } from '../../../../backend/security/platformWriteAuthority';
import { authRequestIpOrNull } from '../../../../backend/auth/requestClientIp';
import { OUTREACH_PLATFORM_MANAGE } from '../../../../shared/contracts/security/SecurityCapabilities';
import { approveOutreachTaskForOperator, beginOperatorApproval } from '../../../../backend/services/leadOutreachActivation';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:outreach-approve', 60, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: OUTREACH_PLATFORM_MANAGE,
    reason: 'operator approves a lead outreach task',
  });
  // { ok: false, sent: true } is TRUTHY — a falsy check here would let a denied
  // request continue into execution. Compare the discriminant explicitly.
  if (guard.ok !== true) return;
  if (!requirePlatformWriteAuthority(res, guard.principal, 'outreach.approve')) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const companyId = str(body.companyId);
  const taskId = str(body.taskId);
  const reason = str(body.reason);
  const begin = body.phase === 'begin';
  if (!companyId || !taskId || (!reason && !begin)) {
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

  // Same platform-trusted client IP the tenant route records (never the first X-Forwarded-For hop).
  const meta = { ip: authRequestIpOrNull(req), userAgent: typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null };
  if (begin) {
    const started = await beginOperatorApproval(companyId, taskId, approverUserId, meta);
    return res.status(started.ok ? 200 : 409).json(started);
  }

  const result = await approveOutreachTaskForOperator(
    companyId,
    taskId,
    approverUserId,
    reason as string,
    str(body.notes),
    // D-02 — an external channel always needs the per-approval passkey; there is no opt-out.
    { passkey: body.passkey ?? null, expectedContentHash: str(body.expectedContentHash), ...meta },
  );

  // The decision took effect and its audit record did not. Not a success and not
  // a conflict: the operator is told both facts, not the database's error text.
  if (result.auditFailed) {
    return res.status(500).json({
      ok: false,
      status: result.status,
      auditFailed: true,
      reason: 'the task moved to approved but the approval record could not be written',
    });
  }

  const passkeyRefused = typeof result.reason === 'string' && result.reason.startsWith('passkey_');
  return res.status(result.ok ? 200 : passkeyRefused ? 401 : 409).json({ ok: result.ok, status: result.status, reason: result.reason });
}

export default __createApiRoute(handler, { route: '/api/super-admin/outreach/approve' });
