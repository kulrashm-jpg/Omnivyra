
/**
 * POST /api/admin/access-requests/approve
 *
 * Super-admin only. Approves an influencer/public-email access request.
 *
 * On approval (Option A):
 *  1. Creates a company for the approved user (name = request.name or brand)
 *     admin_email_domain = NULL (public domain â€” no domain claim)
 *  2. Stores the new company's ID in access_requests.organization_id
 *  3. Marks the request as 'approved'
 *
 * Credits: NOT auto-granted. Admin can issue credits manually via
 *   POST /api/super-admin/purchases/complete or manual_credit_grants.
 *
 * Domain: NOT whitelisted. Approval is per-user, not per-domain.
 *   The user bypasses domain eligibility by holding an approved request,
 *   checked at onboarding time by email match.
 *
 * Body: { requestId, adminNote?, brandName? }
 *   brandName â€” override for company name (defaults to request.name)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '../../../../backend/services/requestAccessService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireAdminScope(req, res, 'access-requests:approve');
  if (!ctx) return;
  if (process.env.NODE_ENV !== 'production') {
    console.warn('[ADMIN_SCOPE]', '/api/admin/access-requests/approve', 'access-requests:approve');
  }
  const adminUserId = ctx.id;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId, adminNote, brandName } = body as {
    requestId:  string;
    adminNote?: string;
    brandName?: string;
  };

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  // â”€â”€ Fetch the access request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: request, error: fetchErr } = await supabase
    .from('access_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (fetchErr || !request) return res.status(404).json({ error: 'Access request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: `Request is already ${request.status}` });
  }

  const now     = new Date().toISOString();
  const company = brandName?.trim() || request.name?.trim() || request.email.split('@')[0];

  // â”€â”€ Guard: one organization per email â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Another request for this email may already have been approved (duplicate
  // submission, re-application after rejection, etc.). Reuse the existing org
  // rather than creating a second company for the same person.
  const { data: priorApproval } = await supabase
    .from('access_requests')
    .select('id, organization_id')
    .eq('email', request.email)
    .eq('status', 'approved')
    .not('organization_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (priorApproval) {
    // Mark this duplicate request as approved and point it at the existing org â€”
    // do NOT create a second company.
    await supabase
      .from('access_requests')
      .update({
        status:          'approved',
        organization_id: priorApproval.organization_id,
        reviewed_by:     adminUserId ?? null,
        reviewed_at:     now,
        admin_note:      adminNote ?? 'Duplicate â€” linked to existing organization',
      })
      .eq('id', requestId);

    return res.status(200).json({
      success:      true,
      requestId,
      companyId:    priorApproval.organization_id,
      deduplicated: true,
    });
  }

  // â”€â”€ 1. Create company for the approved user â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // admin_email_domain = NULL â€” public email domain cannot claim a domain slot.
  // The user is approved per-email, not per-domain.
  const { data: newCompany, error: companyErr } = await supabase
    .from('companies')
    .insert({
      name:               company,
      website:            request.website_url ?? requestId, // NOT NULL placeholder if blank
      admin_email_domain: null,
      status:             'active',
      created_at:         now,
      updated_at:         now,
    })
    .select('id')
    .single();

  if (companyErr) {
    console.error('[access-requests/approve] company creation failed:', companyErr.message);
    return res.status(500).json({ error: 'Failed to create company for approved user' });
  }

  // â”€â”€ 2. Update access_requests: status + link organization_id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // organization_id is stored so onboarding can find the pre-created company
  // by doing: SELECT * FROM access_requests WHERE email=$email AND status='approved'
  const { error: updateErr } = await supabase
    .from('access_requests')
    .update({
      status:          'approved',
      organization_id: newCompany.id,
      reviewed_by:     adminUserId ?? null,
      reviewed_at:     now,
      admin_note:      adminNote ?? null,
    })
    .eq('id', requestId);

  if (updateErr) {
    console.error('[access-requests/approve] status update failed:', updateErr.message);
    return res.status(500).json({ error: 'Failed to update request status' });
  }

  return res.status(200).json({
    success:    true,
    requestId,
    companyId:  newCompany.id,
    companyName: company,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
