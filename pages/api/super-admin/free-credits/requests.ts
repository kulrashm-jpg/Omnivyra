/**
 * GET  /api/super-admin/free-credits/requests  — list access requests
 * POST /api/super-admin/free-credits/requests  — approve or reject
 *
 * POST body:
 *   { action: 'approve', requestId, creditsToGrant?, whitelistDomain?, adminNote? }
 *   { action: 'reject',  requestId, reason }
 *   { action: 'delete',  requestId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';
import { invalidateDomainCache } from '@/backend/services/domainEligibilityService';
import { createCredit, makeIdempotencyKey } from '@/backend/services/creditExecutionService';

const serviceSupabase = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  if (req.cookies?.super_admin_session === '1' || isContentArchitectSession(req)) return 'cookie';
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return user.id;
  res.status(403).json({ error: 'Forbidden' });
  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const adminId = await requireSuperAdmin(req, res);
  if (!adminId) return;

  const sb = serviceSupabase();

  // ── GET: list requests ────────────────────────────────────────────────────
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

  // ── POST: approve / reject / delete ──────────────────────────────────────
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
        reviewed_by: adminId === 'cookie' ? null : adminId,
        reviewed_at: new Date().toISOString(),
        admin_note: adminNote ?? null,
        credits_granted_amount: creditsToGrant,
      }).eq('id', requestId);

      if (whitelistDomain && request.domain) {
        await sb.from('domain_whitelist').upsert({
          domain: request.domain,
          added_by: adminId === 'cookie' ? null : adminId,
          reason: adminNote ?? `Approved via access request ${requestId}`,
        }, { onConflict: 'domain' });
        await invalidateDomainCache(request.domain);
      }

      if (creditsToGrant > 0 && request.organization_id) {
        const actor = adminId === 'cookie' ? request.organization_id : adminId;
        try {
          await createCredit({
            orgId:          request.organization_id,
            amount:         creditsToGrant,
            category:       'free',
            referenceType:  'domain_access_approval',
            referenceId:    requestId,
            note:           `Domain access approved — ${creditsToGrant} credits`,
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
          .from('user_company_roles')
          .select('id, role')
          .eq('user_id', request.user_id)
          .eq('company_id', request.organization_id)
          .maybeSingle();

        if (!existingRole) {
          // No role at all — create COMPANY_ADMIN
          await sb.from('user_company_roles').insert({
            user_id:    request.user_id,
            company_id: request.organization_id,
            role:       'COMPANY_ADMIN',
            status:     'active',
          });
        } else if (existingRole.role === 'SUPER_ADMIN') {
          // Downgrade accidental SUPER_ADMIN to COMPANY_ADMIN
          await sb.from('user_company_roles')
            .update({ role: 'COMPANY_ADMIN' })
            .eq('id', existingRole.id);
        }
        // Any other role (COMPANY_ADMIN, CONTENT_CREATOR, etc.) — leave untouched
      }

      return res.status(200).json({ success: true });
    }

    if (action === 'reject') {
      const { reason } = body;
      if (!reason) return res.status(400).json({ error: 'reason required for rejection' });
      await sb.from('access_requests').update({
        status: 'rejected',
        reviewed_by: adminId === 'cookie' ? null : adminId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      }).eq('id', requestId);
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      await sb.from('access_requests').update({
        status: 'deleted',
        reviewed_by: adminId === 'cookie' ? null : adminId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', requestId);
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
