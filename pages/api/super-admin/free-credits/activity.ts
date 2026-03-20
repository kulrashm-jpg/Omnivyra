/**
 * GET /api/super-admin/free-credits/activity
 *
 * All free credit activity: claims + manual grants + approved access requests.
 * Query params: source (claim|manual|access_request|all), page, limit, search
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

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  if (req.cookies?.super_admin_session === '1' || isContentArchitectSession(req)) return true;
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (!error && user?.id && await isPlatformSuperAdmin(user.id)) return true;
  res.status(403).json({ error: 'Forbidden' });
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireSuperAdmin(req, res)) return;

  const { source = 'all', page = '1', limit = '100', search = '' } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(500, parseInt(limit, 10));
  const offset = (pageNum - 1) * limitNum;

  const sb = serviceSupabase();
  const results: any[] = [];

  // 1. Free credit claims (automated: initial, invite_friend, first_campaign, etc.)
  if (source === 'all' || source === 'claim') {
    const { data: claims } = await sb
      .from('free_credit_claims')
      .select('id, user_id, organization_id, category, credits_granted, claimed_at')
      .order('claimed_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    for (const c of claims ?? []) {
      results.push({
        source: 'claim',
        id: c.id,
        user_id: c.user_id,
        organization_id: c.organization_id,
        category: c.category,
        credits_amount: c.credits_granted,
        reason: 'Automated claim',
        created_at: c.claimed_at,
      });
    }
  }

  // 2. Manual grants
  if (source === 'all' || source === 'manual') {
    let q = sb.from('manual_credit_grants')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limitNum - 1);

    if (search) q = q.or(`reason.ilike.%${search}%`);

    const { data: grants } = await q;
    for (const g of grants ?? []) {
      results.push({ source: 'manual', ...g });
    }
  }

  // 3. Approved access requests (with credit grants)
  if (source === 'all' || source === 'access_request') {
    const { data: approved } = await sb
      .from('access_requests')
      .select('id, user_id, organization_id, email, domain, company_name, credits_granted_amount, admin_note, reviewed_at')
      .eq('status', 'approved')
      .not('credits_granted_amount', 'is', null)
      .gt('credits_granted_amount', 0)
      .order('reviewed_at', { ascending: false });

    for (const ar of approved ?? []) {
      results.push({
        source: 'access_request',
        id: ar.id,
        user_id: ar.user_id,
        organization_id: ar.organization_id,
        email: ar.email,
        category: 'domain_approval',
        credits_amount: ar.credits_granted_amount,
        reason: ar.admin_note ?? `Domain: ${ar.domain}`,
        created_at: ar.reviewed_at,
      });
    }
  }

  // Sort combined by created_at desc
  results.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());

  return res.status(200).json({ activity: results.slice(0, limitNum), page: pageNum });
}
