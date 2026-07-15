import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * POST /api/super-admin/free-credits/grant
 *
 * Manually grant credits to any org (with optional user tagging).
 * Logs to manual_credit_grants + applies via creditExecutionService.createCredit().
 *
 * Body: { organizationId, userId?, creditsAmount, category, reason, referenceId?, note? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { createCredit, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { requireCapability } from '@/backend/security/requireCapability';
import { BILLING_GRANT_FREE_CREDITS } from '@/shared/contracts/security';

const VALID_CATEGORIES = [
  'manual','recommendation','first_campaign','referral',
  'feedback','setup','connect_social','invite_friend','promotion','compensation',
] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { organizationId, userId, creditsAmount, category = 'manual', reason, referenceId, note } = body as {
    organizationId: string;
    userId?: string;
    creditsAmount: number;
    category?: string;
    reason: string;
    referenceId?: string;
    note?: string;
  };

  if (!organizationId) return res.status(400).json({ error: 'organizationId is required' });
  if (!creditsAmount || creditsAmount <= 0) return res.status(400).json({ error: 'creditsAmount must be positive' });
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  if (!VALID_CATEGORIES.includes(category as any)) return res.status(400).json({ error: 'Invalid category' });

  // Phase: Platform Authority Isolation. billing.grant_free_credits is a
  // SUPER_ADMIN-only platform-tier capability; replaces the previous
  // BILLING_MANAGE gate which is per-tenant (any COMPANY_ADMIN of the
  // target org would have satisfied it — including granting themselves
  // free credits). The capability is policy-marked for phishing-resistant
  // step-up (see STEP_UP_REQUIRED_CAPABILITIES). organizationId is recorded
  // for audit linkage (target org), NOT used as the actor's membership
  // binding — this is a platform action targeting an org.
  const guard = await requireCapability(req, res, {
    capability: BILLING_GRANT_FREE_CREDITS,
    reason: `super-admin grants ${creditsAmount} ${category} credits to org`,
    resourceId: organizationId,
  });
  if (guard.ok !== true) return;

  const sb = supabase;
  const grantedBy = guard.principal.userId;

  // ── 1. Log grant record FIRST — the grantId becomes the idempotency anchor ─
  // If this endpoint is retried, the same grantId produces the same idempotency
  // key → createCredit is a no-op → exactly-once credit guaranteed.
  const { data: grant, error: logErr } = await sb.from('manual_credit_grants').insert({
    organization_id: organizationId,
    user_id:         userId ?? null,
    granted_by:      grantedBy,
    credits_amount:  creditsAmount,
    category,
    reason,
    reference_id:    referenceId ?? null,
    note:            note ?? null,
  }).select('id').single();

  if (logErr || !grant?.id) {
    console.error('[free-credits/grant] log failed:', logErr?.message);
    return res.status(500).json({ error: 'Failed to record grant: ' + (logErr?.message ?? 'unknown') });
  }

  // ── 2. Apply credit via creditExecutionService (idempotent on grantId) ─────
  try {
    await createCredit({
      orgId:          organizationId,
      amount:         creditsAmount,
      category:       'paid',
      referenceType:  'manual_grant',
      referenceId:    grant.id,
      note:           `[${category}] ${reason}`,
      performedBy:    grantedBy ?? organizationId,
      idempotencyKey: makeIdempotencyKey(
        grantedBy ?? organizationId,
        `admin_grant:${category}`,
        grant.id,
      ),
    });
  } catch (txErr: any) {
    console.error('[free-credits/grant] credit grant failed:', txErr.message);
    return res.status(500).json({ error: 'Credit transaction failed: ' + txErr.message });
  }

  // ── 3. If a specific user is tagged, ensure they are COMPANY_ADMIN ─────────
  if (userId) {
    const { data: existingRole } = await sb
      .from('user_company_roles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('company_id', organizationId)
      .maybeSingle();

    if (!existingRole) {
      await sb.from('user_company_roles').insert({
        user_id:    userId,
        company_id: organizationId,
        role:       'COMPANY_ADMIN',
        status:     'active',
      });
    } else if (existingRole.role === 'SUPER_ADMIN') {
      await sb.from('user_company_roles')
        .update({ role: 'COMPANY_ADMIN' })
        .eq('id', existingRole.id);
    }
  }

  return res.status(200).json({ success: true, grantId: grant.id });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/free-credits/grant' });
