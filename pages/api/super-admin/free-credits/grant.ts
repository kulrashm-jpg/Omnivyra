/**
 * POST /api/super-admin/free-credits/grant
 *
 * Manually grant credits to any org (with optional user tagging).
 * Logs to manual_credit_grants + applies via apply_credit_transaction RPC.
 *
 * Body: { organizationId, userId?, creditsAmount, category, reason, referenceId?, note? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';
import { isPlatformSuperAdmin } from '@/backend/services/rbacService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';

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

const VALID_CATEGORIES = [
  'manual','recommendation','first_campaign','referral',
  'feedback','setup','connect_social','invite_friend','promotion','compensation',
] as const;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

  const sb = serviceSupabase();
  const grantedBy = adminId === 'cookie' ? null : adminId;

  // Apply the credit transaction
  const { error: txErr } = await sb.rpc('apply_credit_transaction', {
    p_organization_id:  organizationId,
    p_transaction_type: 'purchase',
    p_credits_delta:    creditsAmount,
    p_usd_equivalent:   null,
    p_reference_type:   'free_credits',
    p_reference_id:     referenceId ?? null,
    p_note:             `[${category}] ${reason}`,
    p_performed_by:     grantedBy,
  });

  if (txErr) {
    console.error('[free-credits/grant] rpc failed:', txErr.message);
    return res.status(500).json({ error: 'Credit transaction failed: ' + txErr.message });
  }

  // If a specific user is tagged, ensure they are COMPANY_ADMIN (not SUPER_ADMIN)
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

  // Log to manual_credit_grants
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

  if (logErr) {
    console.error('[free-credits/grant] log failed:', logErr.message);
    // Non-fatal — transaction already applied
  }

  return res.status(200).json({ success: true, grantId: grant?.id });
}
