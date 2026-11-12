import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

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
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { requireAdminRateLimit } from '../../../../backend/services/requestAccessService';
import { IDENTITY_ADMIN_ASSIGN } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (!(await requireAdminRateLimit(req, res, 'rl:admin:access-requests:approve', 20, 60, { sensitive: true }))) return;

  // Approving access requests grants org membership — IDENTITY_ADMIN_ASSIGN
  // gates this with phishing-resistant step-up. Bridge principal cannot
  // satisfy step-up so this surface is canonical-session-only post-Phase-2.
  const guard = await requireCapability(req, res, {
    capability: IDENTITY_ADMIN_ASSIGN,
    reason: 'access request approve',
  });
  if (guard.ok !== true) return;
  const adminUserId: string | null = guard.principal.userId;

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

  // A failed read is not "not found". (CLASS 1, 2026-11-12)
  if (fetchErr) return res.status(503).json({ error: 'Could not read the access request', retryable: true });
  if (!request) return res.status(404).json({ error: 'Access request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: `Request is already ${request.status}` });
  }

  const now     = new Date().toISOString();
  const company = brandName?.trim() || request.name?.trim() || request.email.split('@')[0];

  // ── Guard: one organization per email ─────────────────────────────────────
  // Another request for this email may already have been approved (duplicate
  // submission, re-application after rejection, etc.). Reuse the existing org
  // rather than creating a second company for the same person.
  // A failed read here would create a SECOND company for this person. Refuse.
  const { data: priorApproval, error: priorErr } = await supabase
    .from('access_requests')
    .select('id, organization_id')
    .eq('email', request.email)
    .eq('status', 'approved')
    .not('organization_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (priorErr) return res.status(503).json({ error: 'Could not check for an earlier approval', retryable: true });

  // CLASS 2 (2026-11-12): every status write below is a CAS on 'pending' with a
  // row-count check. The status read above is only an early answer: a
  // concurrent reject / delete / second approve lands between it and the write,
  // and an unconditioned update overwrote it (approve racing reject turned a
  // REJECTED request into an approved one -> onboarding makes that user
  // COMPANY_ADMIN; a double approve created two companies).
  if (priorApproval) {
    // Mark this duplicate request as approved and point it at the existing org —
    // do NOT create a second company.
    const { data: linked, error: linkErr } = await supabase
      .from('access_requests')
      .update({
        status:          'approved',
        organization_id: priorApproval.organization_id,
        reviewed_by:     adminUserId ?? null,
        reviewed_at:     now,
        admin_note:      adminNote ?? 'Duplicate — linked to existing organization',
      })
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id');
    if (linkErr) return res.status(500).json({ error: 'Failed to update request status' });
    if (!Array.isArray(linked) || linked.length !== 1) {
      return res.status(409).json({ error: 'The request was changed by someone else; reload and try again', code: 'REQUEST_STATE_CHANGED' });
    }

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
      website:            request.website_url ?? null,
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
  // CAS pending -> approved, WITH the org id in the same write (onboarding only
  // honours approved rows whose organization_id is set, so no half state is
  // ever visible). The loser of a race deletes the company it just created.
  // TRADE-OFF (05): the compensating delete is not atomic - if the process dies
  // between a lost CAS and the delete, the company is ORPHANED (inert: no
  // members, no data). The alternative that creates nothing on a lost race is a
  // claim status (pending -> approving -> approved), which needs a new status
  // value (a CHECK-constraint migration); this commit chose not to add one.
  // Find orphans with:
  //   SELECT c.id FROM companies c
  //    WHERE NOT EXISTS (SELECT 1 FROM user_company_roles r WHERE r.company_id = c.id)
  //      AND NOT EXISTS (SELECT 1 FROM access_requests a WHERE a.organization_id = c.id);
  // The delete below is FK-safe ONLY while nothing references the new company
  // before this CAS - in particular users.active_company_id (an ON DELETE
  // NO ACTION reference) must never be written by this route before it.
  const { data: approved, error: updateErr } = await supabase
    .from('access_requests')
    .update({
      status:          'approved',
      organization_id: newCompany.id,
      reviewed_by:     adminUserId ?? null,
      reviewed_at:     now,
      admin_note:      adminNote ?? null,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');

  if (updateErr || !Array.isArray(approved) || approved.length !== 1) {
    const { error: cleanupErr } = await supabase.from('companies').delete().eq('id', newCompany.id);
    if (cleanupErr) {
      console.error('[access-requests/approve] ORPHANED company after a failed/lost approval:', newCompany.id, cleanupErr.message);
    }
    if (updateErr) {
      console.error('[access-requests/approve] status update failed:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update request status' });
    }
    return res.status(409).json({ error: 'The request was changed by someone else; reload and try again', code: 'REQUEST_STATE_CHANGED' });
  }

  return res.status(200).json({
    success:    true,
    requestId,
    companyId:  newCompany.id,
    companyName: company,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/access-requests/approve' });
