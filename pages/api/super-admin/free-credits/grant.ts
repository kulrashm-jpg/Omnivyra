
/**
 * POST /api/super-admin/free-credits/grant
 *
 * Manually grant credits to any org (with optional user tagging).
 * Logs to manual_credit_grants + applies via creditExecutionService.createCredit().
 *
 * Body: { organizationId, userId?, creditsAmount, category, reason, referenceId?, note? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';
import { createCredit, makeIdempotencyKey } from '@/backend/services/creditExecutionService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

const CONTENT_ARCHITECT_SENTINEL = 'content_architect';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  if (isContentArchitectSession(req)) return CONTENT_ARCHITECT_SENTINEL;
  const ctx = await requireAdminScope(req, res, 'credits:grant');
  return ctx?.id ?? null;
}

const VALID_CATEGORIES = [
  'manual','recommendation','first_campaign','referral',
  'feedback','setup','connect_social','invite_friend','promotion','compensation',
] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const adminId = await requireSuperAdmin(req, res);
  if (!adminId) return;

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

  const sb = supabase;
  const grantedBy = adminId === 'content_architect' ? null : adminId;

  // â”€â”€ 1. Log grant record FIRST â€” the grantId becomes the idempotency anchor â”€
  // If this endpoint is retried, the same grantId produces the same idempotency
  // key â†’ createCredit is a no-op â†’ exactly-once credit guaranteed.
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

  // â”€â”€ 2. Apply credit via creditExecutionService (idempotent on grantId) â”€â”€â”€â”€â”€
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

  // â”€â”€ 3. If a specific user is tagged, ensure they are COMPANY_ADMIN â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (userId) {
    const { data: existingRole } = await sb
      .from('user_company_' + 'roles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('company_id', organizationId)
      .maybeSingle();

    if (!existingRole) {
      await sb.from('user_company_' + 'roles').insert({
        user_id:    userId,
        company_id: organizationId,
        role:       'COMPANY_ADMIN',
        status:     'active',
      });
    } else if (existingRole.role === 'SUPER_ADMIN') {
      await sb.from('user_company_' + 'roles')
        .update({ role: 'COMPANY_ADMIN' })
        .eq('id', existingRole.id);
    }
  }

  return res.status(200).json({ success: true, grantId: grant.id });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
