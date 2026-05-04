import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET  /api/credits/earn/referral  â€” get referral code + stats
 * POST /api/credits/earn/referral  â€” record an invite sent to a specific email
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { getSupabaseUserFromRequest } from '../../../../backend/services/supabaseAuthService';

function referralCodeFromUserId(userId: string): string {
  // Deterministic 10-char code â€” same user always gets same code
  return userId.replace(/-/g, '').slice(0, 10).toLowerCase();
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: roleRow } = await supabase
    .from('user_company_' + 'roles')
    .select('company_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (!roleRow) return res.status(400).json({ error: 'No active company' });
  const orgId = (roleRow as any).company_id as string;
  const code  = referralCodeFromUserId(user.id);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.omnivyra.com';

  // â”€â”€ GET â€” return code + referral history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET') {
    const { data: referrals } = await supabase
      .from('referrals')
      .select('id, invited_email, status, completed_at, created_at')
      .eq('referrer_user_id', user.id)
      .order('created_at', { ascending: false });

    return res.status(200).json({
      code,
      referral_link: `${appUrl}/create-account?ref=${code}`,
      referrals:     referrals ?? [],
      pending:       (referrals ?? []).filter((r: any) => r.status === 'pending').length,
      completed:     (referrals ?? []).filter((r: any) => r.status === 'completed').length,
      credits_per_referral: 200,
    });
  }

  // â”€â”€ POST â€” record an invite sent â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'POST') {
    const body         = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const invitedEmail = (body as any).invitedEmail?.trim().toLowerCase() ?? '';

    if (!invitedEmail) return res.status(400).json({ error: 'invitedEmail required' });

    // Can't invite yourself
    if (invitedEmail === user.email?.toLowerCase()) {
      return res.status(400).json({ error: 'Cannot invite yourself.' });
    }

    await supabase.from('referrals').upsert({
      referrer_user_id: user.id,
      referrer_org_id:  orgId,
      referral_code:    code,
      invited_email:    invitedEmail,
      status:           'pending',
    }, { onConflict: 'referral_code,invited_email', ignoreDuplicates: true });

    return res.status(200).json({
      success:       true,
      referral_link: `${appUrl}/create-account?ref=${code}`,
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).end();
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

