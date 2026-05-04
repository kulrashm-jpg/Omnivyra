
/**
 * GET  /api/super-admin/free-credits/requests  â€” list access requests
 * POST /api/super-admin/free-credits/requests  â€” approve or reject
 *
 * POST body:
 *   { action: 'approve', requestId, creditsToGrant?, whitelistDomain?, adminNote? }
 *   { action: 'reject',  requestId, reason }
 *   { action: 'delete',  requestId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';
import { invalidateDomainCache } from '@/backend/services/domainEligibilityService';
import { createCredit, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

const CONTENT_ARCHITECT_SENTINEL = 'content_architect';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  if (isContentArchitectSession(req)) return CONTENT_ARCHITECT_SENTINEL;
  const ctx = await requireAdminScope(req, res, 'access-requests:approve');
  return ctx?.id ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const adminId = await requireSuperAdmin(req, res);
  if (!adminId) return;

  const sb = supabase;

  // â”€â”€ GET: list requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    const { status = 'pending', page = '1', limit = '50', search = '' } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(200, parseInt(limit, 10));
    const offset = (pageNum - 1) * limitNum;

    let q = sb.from('access_requests').select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (status !== 'all') q = q.eq('status', status);
    if (search) q = q.or(`email.ilike.%${search}%,domain.ilike.%${search}%,company_name.ilike.%${search}%`);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ requests: data, total: count, page: pageNum, limit: limitNum });
  }

  // â”€â”€ POST: approve / reject / delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { action, requestId } = body as { action: string; requestId: string };
    if (!requestId) return res.status(400).json({ error: 'requestId required' });

    const { data: request } = await sb.from('access_requests').select('*').eq('id', requestId).maybeSingle();
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (action === 'approve') {
      const { creditsToGrant = 300, whitelistDomain = true, adminNote } = body;

      await sb.from('access_requests').update({
        status: 'approved',
        reviewed_by: adminId === 'content_architect' ? null : adminId,
        reviewed_at: new Date().toISOString(),
        admin_note: adminNote ?? null,
        credits_granted_amount: creditsToGrant,
      }).eq('id', requestId);

      if (whitelistDomain && request.domain) {
        await sb.from('domain_whitelist').upsert({
          domain: request.domain,
          added_by: adminId === 'content_architect' ? null : adminId,
          reason: adminNote ?? `Approved via access request ${requestId}`,
        }, { onConflict: 'domain' });
        await invalidateDomainCache(request.domain);
      }

      if (creditsToGrant > 0 && request.organization_id) {
        const actor = adminId === 'content_architect' ? request.organization_id : adminId;
        try {
          await createCredit({
            orgId:          request.organization_id,
            amount:         creditsToGrant,
            category:       'free',
            referenceType:  'domain_access_approval',
            referenceId:    requestId,
            note:           `Domain access approved â€” ${creditsToGrant} credits`,
            performedBy:    actor,
            idempotencyKey: makeIdempotencyKey(actor, 'domain_access_approval', requestId),
          });
        } catch (creditErr: any) {
          console.error('[free-credits/requests] credit grant failed:', creditErr.message);
        }
      }

      // Ensure the user has COMPANY_ADMIN role (never SUPER_ADMIN).
      // If they have no role yet, create one. If they already have one, leave it alone.
      if (request.user_id && request.organization_id) {
        const { data: existingRole } = await sb
          .from('user_company_' + 'roles')
          .select('id, role')
          .eq('user_id', request.user_id)
          .eq('company_id', request.organization_id)
          .maybeSingle();

        if (!existingRole) {
          // No role at all â€” create COMPANY_ADMIN
          await sb.from('user_company_' + 'roles').insert({
            user_id:    request.user_id,
            company_id: request.organization_id,
            role:       'COMPANY_ADMIN',
            status:     'active',
          });
        } else if (existingRole.role === 'SUPER_ADMIN') {
          // Downgrade accidental SUPER_ADMIN to COMPANY_ADMIN
          await sb.from('user_company_' + 'roles')
            .update({ role: 'COMPANY_ADMIN' })
            .eq('id', existingRole.id);
        }
        // Any other role (COMPANY_ADMIN, CONTENT_CREATOR, etc.) â€” leave untouched
      }

      return res.status(200).json({ success: true });
    }

    if (action === 'reject') {
      const { reason } = body;
      if (!reason) return res.status(400).json({ error: 'reason required for rejection' });
      await sb.from('access_requests').update({
        status: 'rejected',
        reviewed_by: adminId === 'content_architect' ? null : adminId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      }).eq('id', requestId);
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      await sb.from('access_requests').update({
        status: 'deleted',
        reviewed_by: adminId === 'content_architect' ? null : adminId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', requestId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
