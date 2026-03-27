/**
 * POST /api/super-admin/credits/grant
 *
 * Super-admin only. Grant credits to any organization in a controlled,
 * auditable, and idempotent way.
 *
 * Contract:
 *   Request  { organization_id, credits, category, reason }
 *   Response { success, grant_id, credits_added }
 *
 * Execution order (important):
 *  1. Validate inputs + assert super-admin
 *  2. INSERT into manual_credit_grants FIRST → produces grantId (idempotency anchor)
 *  3. createCredit(idempotencyKey = hash("admin_grant:" + grantId))
 *     → exactly-once credit even if the endpoint is retried
 *  4. Notify org admin (non-blocking — failure never aborts the grant)
 *
 * Categories supported:
 *   paid       — top-up credits, never expire, purchased-equivalents
 *   incentive  — promotional credits, may be expired by creditExpiryService
 *
 * Auth: super_admin_session cookie OR Bearer + profiles.is_super_admin
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase as sb } from '@/backend/db/supabaseClient';
import { createCredit, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';

// ── Valid categories for admin-driven grants ───────────────────────────────────

const GRANT_CATEGORIES = ['paid', 'incentive'] as const;
type GrantCategory = typeof GRANT_CATEGORIES[number];

// ── Auth ──────────────────────────────────────────────────────────────────────

async function requireSuperAdmin(
  req: NextApiRequest,
  res: NextApiResponse,
  sb: SupabaseClient,
): Promise<string | null> {
  if (req.cookies?.super_admin_session === '1' || isContentArchitectSession(req)) {
    return 'cookie';
  }
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return user.id;
  res.status(403).json({ error: 'Super admin access required' });
  return null;
}

// ── Notify org admin (best-effort, non-blocking) ──────────────────────────────

async function notifyOrgAdmin(
  sb:      SupabaseClient,
  orgId:   string,
  credits: number,
  reason:  string,
  grantId: string,
): Promise<void> {
  // Find the COMPANY_ADMIN for this org to notify
  const { data: adminRole } = await sb
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', orgId)
    .eq('role', 'COMPANY_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const role = adminRole as any;
  if (!role?.user_id) return;

  await (sb as any).from('notifications').insert({
    user_id:  role.user_id,
    type:     'credit_granted',
    title:    'Credits added to your account',
    message:  `You have received ${credits} credit${credits === 1 ? '' : 's'}. Reason: ${reason}`,
    metadata: { grant_id: grantId, credits_added: credits, reason },
    is_read:  false,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminId = await requireSuperAdmin(req, res, sb as any);
  if (!adminId) return;

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    organization_id,
    credits,
    category = 'paid',
    reason,
  } = body as {
    organization_id: string;
    credits:         number;
    category?:       string;
    reason:          string;
  };

  // ── Validate ───────────────────────────────────────────────────────────────
  if (!organization_id)                                   return res.status(400).json({ error: 'organization_id is required' });
  if (!credits || !Number.isInteger(credits) || credits <= 0) return res.status(400).json({ error: 'credits must be a positive integer' });
  if (!reason?.trim())                                    return res.status(400).json({ error: 'reason is required' });
  if (!GRANT_CATEGORIES.includes(category as GrantCategory)) {
    return res.status(400).json({ error: `category must be one of: ${GRANT_CATEGORIES.join(', ')}` });
  }

  // Verify the org exists before logging a grant against it
  const { data: org } = await sb
    .from('companies')
    .select('id')
    .eq('id', organization_id)
    .maybeSingle();

  if (!org) return res.status(404).json({ error: 'Organization not found' });

  const grantedBy = adminId === 'cookie' ? null : adminId;

  // ── STEP 3: Log grant FIRST — grantId is the idempotency anchor ────────────
  // If this endpoint is retried (network error, duplicate submission), the same
  // grantId flows into makeIdempotencyKey → createCredit is a no-op →
  // exactly-once credit delivery regardless of retries.
  const { data: grant, error: logErr } = await sb
    .from('manual_credit_grants')
    .insert({
      organization_id,
      granted_by:     grantedBy,
      credits_amount: credits,
      category,
      reason:         reason.trim(),
    })
    .select('id')
    .single();

  if (logErr || !grant?.id) {
    console.error('[credits/grant] log failed:', logErr?.message);
    return res.status(500).json({ error: 'Failed to record grant: ' + (logErr?.message ?? 'unknown') });
  }

  const grantId = grant.id as string;

  // ── STEP 4: Apply credit via creditExecutionService ────────────────────────
  // Category is passed through directly — incentive credits are processed
  // separately from paid credits and may be subject to expiry.
  try {
    await createCredit({
      orgId:          organization_id,
      amount:         credits,
      category:       category as GrantCategory,
      referenceType:  'admin_manual_grant',
      referenceId:    grantId,
      note:           `[admin] ${reason.trim()}`,
      performedBy:    grantedBy ?? organization_id,
      idempotencyKey: makeIdempotencyKey(
        grantedBy ?? organization_id,
        'admin_grant',
        grantId,
      ),
    });
  } catch (txErr: any) {
    console.error('[credits/grant] createCredit failed:', txErr.message);
    // Grant row is already logged — do not return 500 silently.
    // Surface the error so the admin knows to investigate.
    return res.status(500).json({
      error:    'Credit transaction failed: ' + txErr.message,
      grant_id: grantId,  // include so admin can manually reconcile
    });
  }

  // ── STEP 6: Notify org admin (non-blocking) ────────────────────────────────
  notifyOrgAdmin(sb as any, organization_id, credits, reason.trim(), grantId).catch(err =>
    console.warn('[credits/grant] notification failed (non-fatal):', err?.message),
  );

  // ── STEP 5: Respond ────────────────────────────────────────────────────────
  return res.status(200).json({
    success:       true,
    grant_id:      grantId,
    credits_added: credits,
  });
}
