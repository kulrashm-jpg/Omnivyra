import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/super-admin/free-credits/profiles
 *
 * All free_credit_profiles with their claim history and credit balance.
 * Query params: page, limit, search (email / phone / company)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '@/backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '@/shared/contracts/security';

async function requireSuperAdmin(req: NextApiRequest, res: NextApiResponse): Promise<boolean> {
  // Phase 2: bridge cookie + content-architect cookie + Supabase fallback
  // collapsed into a single canonical capability gate. Bridge principal
  // and (post-Phase-1) canonical content-architect role both satisfy
  // SUPER_ADMIN_DASHBOARD_VIEW for this read-only listing.
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'free-credits profiles list',
  });
  return guard.ok === true;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!await requireSuperAdmin(req, res)) return;

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

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/super-admin/free-credits/profiles' });
