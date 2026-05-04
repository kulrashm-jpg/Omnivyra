
/**
 * GET /api/super-admin/free-credits/profiles
 *
 * All free_credit_profiles with their claim history and credit balance.
 * Query params: page, limit, search (email / phone / company)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '@/backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { requireAdminScope } from '@/backend/services/requestAccessService';
import { isContentArchitectSession } from '@/backend/services/contentArchitectService';
import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isContentArchitectSession(req)) {
    const ctx = await requireAdminScope(req, res, 'credits:view');
    if (!ctx) return;
  }

  const { page = '1', limit = '50', search = '' } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, parseInt(limit, 10));
  const offset = (pageNum - 1) * limitNum;

  const sb = supabase;

  let q = sb.from('free_credit_profiles')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (search) {
    q = q.or(`phone_number.ilike.%${search}%,intent_team.ilike.%${search}%`);
  }

  const { data: profiles, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // Attach claim counts
  const userIds = (profiles ?? []).map(p => p.user_id).filter(Boolean);
  const { data: claims } = await sb
    .from('free_credit_claims')
    .select('user_id, category, credits_granted')
    .in('user_id', userIds);

  const claimsByUser: Record<string, { categories: string[]; total: number }> = {};
  for (const c of claims ?? []) {
    if (!claimsByUser[c.user_id]) claimsByUser[c.user_id] = { categories: [], total: 0 };
    claimsByUser[c.user_id].categories.push(c.category);
    claimsByUser[c.user_id].total += c.credits_granted;
  }

  const enriched = (profiles ?? []).map(p => ({
    ...p,
    claims: claimsByUser[p.user_id] ?? { categories: [], total: 0 },
  }));

  return res.status(200).json({ profiles: enriched, total: count, page: pageNum, limit: limitNum });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiredRole: 'SUPER_ADMIN',
  allowSuperAdminOverride: true,
})(handler);
