import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';
/**
 * POST /api/super-admin/outreach/activate
 *
 * WS-6A — the operator entry point that makes the Lead Outreach Execution
 * runtime reachable from the running application.
 *
 * WHY A ROUTE AND NOT A CRON. WS-3 is the first capability in this platform
 * that can act on the outside world. Its milestone order exists so that
 * governance is proven before capability arrives, and a scheduler would hand
 * that capability an autonomous trigger on day one. An operator-invoked route
 * keeps every execution attributable to a person and a moment, which is also
 * what the frozen rollout asks for: "Dispatch internal tasks first. Confirm
 * work items appear."
 *
 * WHAT THIS DOES. Materialises the lead's already-persisted automation plan
 * into durable outreach tasks, then dispatches those that are ALREADY approved.
 * It never approves — see ./approve.ts for that, deliberately a separate act.
 *
 * WHAT IT CANNOT DO. Dispatch a channel the caller did not permit (default:
 * internal only, the channel that contacts nobody); dispatch for a tenant with
 * no `outreach_governance_config` row, which governance blocks at the first
 * gate; or send email, which is additionally gated by
 * `LEAD_OUTREACH_EMAIL_ENABLED`. Widening `channels` does not bypass either —
 * it only widens what this caller will offer to a runtime that still decides.
 *
 * Auth (Closure-009, owner decision): requireAdminRateLimit +
 * requireCapability(OUTREACH_PLATFORM_MANAGE) with its passkey + trusted-device
 * step-up + platform write authority (an ACTIVE platform SUPER_ADMIN role on a
 * canonical principal). The platform tier is required because this triggers
 * real execution against an arbitrary tenant named in the body.
 *
 * RECIPIENT. The caller may NOT supply `recipient`. Outreach has no recipient
 * model to validate an address against (no lead/task contact binding exists),
 * so a body address was an arbitrary redirect of real outreach to whoever the
 * caller named. It is refused (400 RECIPIENT_OVERRIDE_NOT_PERMITTED) before
 * anything is read or written; until a verified recipient model exists the
 * email transport receives no recipient and refuses (invalid_recipient).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { requirePlatformWriteAuthority } from '../../../../backend/security/platformWriteAuthority';
import { OUTREACH_PLATFORM_MANAGE } from '../../../../shared/contracts/security/SecurityCapabilities';
import { runOutreachActivation } from '../../../../backend/services/leadOutreachActivation';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!(await requireAdminRateLimit(req, res, 'rl:super-admin:outreach-activate', 30, 60))) return;

  const guard = await requireCapability(req, res, {
    capability: OUTREACH_PLATFORM_MANAGE,
    reason: 'operator activates lead outreach execution',
  });
  // { ok: false, sent: true } is TRUTHY — a falsy check here would let a denied
  // request continue into execution. Compare the discriminant explicitly.
  if (guard.ok !== true) return;
  if (!requirePlatformWriteAuthority(res, guard.principal, 'outreach.activate')) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (body.recipient !== undefined && body.recipient !== null) {
    return res.status(400).json({
      error: 'recipient may not be supplied by the caller: outreach has no verified recipient model to validate it against',
      code: 'RECIPIENT_OVERRIDE_NOT_PERMITTED',
    });
  }
  const companyId = str(body.companyId);
  const leadId = str(body.leadId);
  if (!companyId || !leadId) {
    return res.status(400).json({ error: 'companyId and leadId are required' });
  }

  // Channels are an explicit widening, never a default. An empty or malformed
  // list falls back to the internal-only default rather than to "everything",
  // because the failure mode of the alternative is contacting someone.
  const channels = Array.isArray(body.channels)
    ? (body.channels as unknown[]).map((c) => str(c)).filter((c): c is string => c !== null)
    : undefined;

  const report = await runOutreachActivation(companyId, leadId, {
    channels: channels && channels.length > 0 ? channels : undefined,
    previewOnly: body.previewOnly === true,
    region: str(body.region),
  });

  return res.status(200).json({ ok: true, report });
}

export default __createApiRoute(handler, { route: '/api/super-admin/outreach/activate' });
