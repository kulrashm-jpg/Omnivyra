/**
 * POST /api/admin/access-requests/approve
 *
 * Super-admin only. Approves an influencer/public-email access request.
 *
 * On approval (Option A):
 *  1. Creates a company for the approved user (name = request.name or brand)
 *     admin_email_domain = NULL (public domain — no domain claim)
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
 *   brandName — override for company name (defaults to request.name)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization ?? '';
  const isSuperAdminCookie = req.cookies?.super_admin_session === '1';

  if (!isSuperAdminCookie) {
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Resolve admin identity (Bearer or cookie session)
  let adminUserId: string | null = null;
  if (!isSuperAdminCookie) {
    const { user, error: userErr } = await getSupabaseUserFromRequest(req);
    if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });
    adminUserId = user.id;

    adminUserId = user.id;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { requestId, adminNote, brandName } = body as {
    requestId:  string;
    adminNote?: string;
    brandName?: string;
  };

  if (!requestId) return res.status(400).json({ error: 'requestId is required' });

  // ── Fetch the access request ───────────────────────────────────────────────
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

  // ── Guard: one organization per email ─────────────────────────────────────
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
    // Mark this duplicate request as approved and point it at the existing org —
    // do NOT create a second company.
    await supabase
      .from('access_requests')
      .update({
        status:          'approved',
        organization_id: priorApproval.organization_id,
        reviewed_by:     adminUserId ?? null,
        reviewed_at:     now,
        admin_note:      adminNote ?? 'Duplicate — linked to existing organization',
      })
      .eq('id', requestId);

    return res.status(200).json({
      success:      true,
      requestId,
      companyId:    priorApproval.organization_id,
      deduplicated: true,
    });
  }

  // ── 1. Create company for the approved user ────────────────────────────────
  // admin_email_domain = NULL — public email domain cannot claim a domain slot.
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

  // ── 2. Update access_requests: status + link organization_id ──────────────
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
