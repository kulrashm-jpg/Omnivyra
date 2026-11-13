import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/admin/revoke-super-admin
 *
 * Revokes platform super-admin status from a user, atomically (public.revoke_super_admin, 20270217000052):
 *  1. Downgrading users.role from SUPER_ADMIN to COMPANY_ADMIN
 *  2. Downgrading any SUPER_ADMIN role in user_company_roles to COMPANY_ADMIN
 * Refused with 409 LAST_SUPER_ADMIN when the target is the last active super-admin.
 *
 * Authorization: capability `identity.admin.revoke` + step-up policy
 * (phishing-resistant + trusted device, 10-minute window). Bridge
 * principals cannot satisfy step-up and are rejected.
 *
 * Body: { userId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '@/backend/security/requireCapability';
import { requireAdminRateLimit } from '@/backend/services/requestAccessService';
import { IDENTITY_ADMIN_REVOKE } from '@/shared/contracts/security';
import { insertAuditLogStrict } from '@/backend/services/auditActorService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:revoke-super-admin', 5, 60, { sensitive: true }))) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const { userId } = body as { userId?: string };

  if (!userId) return res.status(400).json({ error: 'Missing required field: userId' });

  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_REVOKE,
    reason: 'super-admin revokes platform super-admin status from another user',
    resourceId: userId,
  });
  if (guard.ok !== true) return;

  try {
    const now = new Date().toISOString();

    // M2 (e1, e9-approved BLOCKING 2026-11-13; 20270217000052): ONE transaction under the super-admin lock shared with
    // bootstrap - it refuses to revoke the LAST active super-admin (self-revoke included) and downgrades users.role and
    // every SUPER_ADMIN membership together, so a half-revoked user can no longer exist. There is NO fallback to the
    // former two-statement downgrade: if the function is missing the route fails closed.
    const { data: rpcData, error: rpcErr } = await supabase.rpc('revoke_super_admin', { p_user_id: userId });
    if (rpcErr) {
      const message = String((rpcErr as { message?: string }).message ?? '');
      const code = (rpcErr as { code?: string }).code;
      if (message.includes('LAST_SUPER_ADMIN')) {
        return res.status(409).json({
          error: 'This is the last active super-admin; promote another super-admin before revoking this one.',
          code: 'LAST_SUPER_ADMIN',
          retryable: false,
        });
      }
      if (code === 'PGRST202' || code === '42883') {
        console.error('[revoke-super-admin] revoke_super_admin is not deployed:', message);
        return res.status(503).json({ error: 'Revocation is temporarily unavailable', code: 'REVOKE_UNAVAILABLE', retryable: true });
      }
      console.error('[revoke-super-admin] revoke failed:', message);
      return res.status(500).json({ error: 'Internal server error', code: 'REVOKE_FAILED' });
    }
    const downgradedMemberships = ((rpcData as { downgraded_company_ids?: string[] } | null)?.downgraded_company_ids ?? []);

    // Closure-015J (R-10): the governed revoke now writes its own business audit
    // row (it had only the requireCapability security event). The revocation has
    // already taken effect; an audit-write failure is reported truthfully, not as
    // a failed revocation.
    const audit = await insertAuditLogStrict({
      actorUserId: guard.principal.userId,
      action: 'SUPER_ADMIN_REVOKE',
      targetUserId: userId,
      metadata: { downgraded_memberships: downgradedMemberships, downgraded_count: downgradedMemberships.length },
    });
    if (!audit.ok) {
      return res.status(500).json({ error: 'REVOKED_AUDIT_FAILED', revoked: true, downgraded_count: downgradedMemberships.length });
    }

    return res.status(200).json({
      success:    true,
      message:    'Super admin privileges revoked successfully',
      user_id:    userId,
      revoked_at: now,
    });
  } catch (err: any) {
    console.error('[revoke-super-admin]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/revoke-super-admin' });
