import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

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
import { supabase } from '@/backend/db/supabaseClient';
import { invalidateDomainCache } from '@/backend/services/domainEligibilityService';
import { createCredit, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { requireCapability } from '@/backend/security/requireCapability';
import { requireAdminRateLimit } from '@/backend/services/requestAccessService';
import { BILLING_GRANT_FREE_CREDITS } from '@/shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Closure-014 (D): per-route write rate limit (before authorization and any business work).
  if (req.method !== 'GET' && !(await requireAdminRateLimit(req, res, 'rl:super-admin:free-credits:requests', 30, 60))) return;

  // Phase: Platform Authority Isolation. billing.grant_free_credits is a
  // SUPER_ADMIN-only platform-tier capability; replaces the previous
  // BILLING_MANAGE gate which is per-tenant.
  const guard = await requireCapability(req, res, {
    capability: BILLING_GRANT_FREE_CREDITS,
    reason: `super-admin reviews free-credit access request (${req.method})`,
  });
  if (guard.ok !== true) return;
  const adminId = guard.principal.userId;

  const sb = supabase;

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

    // A failed read is not "no such request" (404). 503, nothing changed.
    const { data: request, error: requestErr } = await sb.from('access_requests').select('*').eq('id', requestId).maybeSingle();
    if (requestErr) return res.status(503).json({ error: 'request lookup unavailable', retryable: true });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (action === 'approve') {
      const { creditsToGrant = 300, whitelistDomain = true, adminNote } = body;

      // MONEY: the approval must be recorded BEFORE credits move. An unread
      // failure used to grant credits against a request still 'pending' (which
      // could then be rejected). Retrying approve is safe: the credit key is
      // per request.
      // STATE CAS (05, 2026-11-12): approve only a request that is still
      // 'pending' - or already 'approved' (a retry after CREDIT_GRANT_FAILED,
      // re-attempting the idempotent grant). DEPENDS ON the grant's idempotency
      // key being per REQUEST (makeIdempotencyKey(..., requestId) below): if it
      // ever became per-attempt, re-approve would grant TWICE through this CAS.
      // Never a rejected / deleted one:
      // approving those used to GRANT CREDITS on a decision already reversed.
      // Exactly one row must move; 0 rows = the state changed -> 409.
      const { data: approvedRows, error: approveErr } = await sb.from('access_requests').update({
        status: 'approved',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        admin_note: adminNote ?? null,
        credits_granted_amount: creditsToGrant,
      }).eq('id', requestId).in('status', ['pending', 'approved']).select('id');
      if (approveErr) {
        console.error('[free-credits/requests] approval write failed - nothing granted:', requestId, approveErr.message);
        return res.status(500).json({ error: 'approval not recorded', code: 'APPROVAL_WRITE_FAILED', retryable: true });
      }
      if (!Array.isArray(approvedRows) || approvedRows.length !== 1) {
        return res.status(409).json({ error: 'request is not pending', code: 'NOT_PENDING' });
      }
      const warnings: string[] = [];

      if (whitelistDomain && request.domain) {
        // best-effort: the approval stands; a missing whitelist entry is
        // reported to the operator.
        const { error: wlErr } = await sb.from('domain_whitelist').upsert({
          domain: request.domain,
          added_by: adminId,
          reason: adminNote ?? `Approved via access request ${requestId}`,
        }, { onConflict: 'domain' });
        if (wlErr) {
          console.error('[free-credits/requests] domain whitelist write failed:', request.domain, wlErr.message);
          warnings.push('domain NOT whitelisted (write failed) - retry approve');
        } else {
          await invalidateDomainCache(request.domain);
        }
      }

      if (creditsToGrant > 0 && request.organization_id) {
        const actor = adminId;
        // ONE GRANT PER REQUEST (2026-11-12, found via 05's dependency review):
        // the key used to be makeIdempotencyKey(ADMIN, ..., requestId) - per
        // admin AND request - so a second admin re-approving (now a supported
        // retry path through the CAS above, and with no CAS at all before)
        // granted the credits AGAIN. Two guards:
        //  1. the ledger already holds a grant for this request (under ANY key,
        //     including the old admin-based one) -> do not grant again; a read
        //     error refuses (never "not granted yet" on an unread answer);
        //  2. new grants use a per-REQUEST key (no actor), so concurrent
        //     re-approvals by different admins collapse into one.
        const { data: priorGrant, error: priorGrantErr } = await sb
          .from('credit_transactions')
          .select('id')
          .eq('reference_type', 'domain_access_approval')
          .eq('reference_id', requestId)
          .limit(1)
          .maybeSingle();
        if (priorGrantErr) {
          console.error('[free-credits/requests] prior-grant read failed - not granted:', requestId, priorGrantErr.message);
          return res.status(500).json({ error: 'credits not granted', code: 'CREDIT_GRANT_FAILED', approved: true, retryable: true });
        }
        if (!priorGrant) try {
          await createCredit({
            orgId:          request.organization_id,
            amount:         creditsToGrant,
            category:       'free',
            referenceType:  'domain_access_approval',
            referenceId:    requestId,
            note:           `Domain access approved — ${creditsToGrant} credits`,
            performedBy:    actor,
            // MUST stay per REQUEST (no actor): the approve CAS above allows
            // re-approving an 'approved' request (retry after
            // CREDIT_GRANT_FAILED) and relies on this key - plus the prior-grant
            // check above for grants made under the old admin-based key - to
            // make that retry a no-op instead of a second grant.
            idempotencyKey: makeIdempotencyKey(request.organization_id, 'domain_access_approval', requestId),
          });
        } catch (creditErr: any) {
          // Never answer success for credits that were not granted. The approval
          // is recorded; retrying approve re-attempts the grant idempotently.
          console.error('[free-credits/requests] credit grant failed:', creditErr.message);
          return res.status(500).json({ error: 'credits not granted', code: 'CREDIT_GRANT_FAILED', approved: true, retryable: true });
        }
      }

      // Ensure the user has COMPANY_ADMIN role (never SUPER_ADMIN).
      // If they have no role yet, create one. If they already have one, leave it alone.
      if (request.user_id && request.organization_id) {
        // PRIVILEGE: a membership is created only on a CLEAN "no existing role"
        // read - an unread error used to look like "no role" and insert a
        // COMPANY_ADMIN row for a user who may already hold another role.
        const { data: existingRole, error: roleReadErr } = await sb
          .from('user_company_roles')
          .select('id, role')
          .eq('user_id', request.user_id)
          .eq('company_id', request.organization_id)
          .maybeSingle();

        if (roleReadErr) {
          console.error('[free-credits/requests] role read failed - membership not changed:', requestId, roleReadErr.message);
          warnings.push('company-admin membership NOT ensured (role read failed) - retry approve');
        } else if (!existingRole) {
          // No role at all — create COMPANY_ADMIN
          const { error: roleInsertErr } = await sb.from('user_company_roles').insert({
            user_id:    request.user_id,
            company_id: request.organization_id,
            role:       'COMPANY_ADMIN',
            status:     'active',
          });
          if (roleInsertErr) {
            console.error('[free-credits/requests] role insert failed:', requestId, roleInsertErr.message);
            warnings.push('company-admin membership NOT created - retry approve');
          }
        }
        // Closure-015J (R-6): an existing SUPER_ADMIN membership is left untouched — it
        // already exceeds COMPANY_ADMIN, and platform super-admin authority changes only
        // through identity.admin.assign / identity.admin.revoke. (This formerly
        // "downgraded accidental SUPER_ADMIN to COMPANY_ADMIN", a legacy cleanup that
        // silently removed governed platform authority.) Any other existing role is
        // likewise left as is.
        // Any other role (COMPANY_ADMIN, CONTENT_CREATOR, etc.) — leave untouched
      }

      return res.status(200).json({ success: true, ...(warnings.length ? { warnings } : {}) });
    }

    if (action === 'reject') {
      const { reason } = body;
      if (!reason) return res.status(400).json({ error: 'reason required for rejection' });
      // STATE CAS: only a pending request can be rejected (rejecting an approved
      // one would leave its credits granted under a 'rejected' record).
      const { data: rejectedRows, error: rejectErr } = await sb.from('access_requests').update({
        status: 'rejected',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      }).eq('id', requestId).eq('status', 'pending').select('id');
      if (rejectErr) return res.status(500).json({ error: 'rejection not recorded', retryable: true });
      if (!Array.isArray(rejectedRows) || rejectedRows.length !== 1) {
        return res.status(409).json({ error: 'request is not pending', code: 'NOT_PENDING' });
      }
      return res.status(200).json({ success: true });
    }

    if (action === 'delete') {
      // STATE CAS: an APPROVED request (credits granted) is never soft-deleted -
      // it would vanish from the grant activity view.
      const { data: deletedRows, error: deleteErr } = await sb.from('access_requests').update({
        status: 'deleted',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      }).eq('id', requestId).in('status', ['pending', 'rejected']).select('id');
      if (deleteErr) return res.status(500).json({ error: 'deletion not recorded', retryable: true });
      if (!Array.isArray(deletedRows) || deletedRows.length !== 1) {
        return res.status(409).json({ error: 'only a pending or rejected request can be deleted', code: 'NOT_DELETABLE' });
      }
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/free-credits/requests' });
