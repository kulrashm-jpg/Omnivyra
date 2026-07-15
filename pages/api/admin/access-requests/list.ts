import { createApiRoute as __createApiRoute } from '../../../../lib/platform/routeFactory';

/**
 * GET /api/admin/access-requests/list
 *
 * Super-admin only. Returns access requests filterable by status.
 * Query params: status (pending|approved|rejected|deleted|all), page, limit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { requireCapability } from '../../../../backend/security/requireCapability';
import { SUPER_ADMIN_DASHBOARD_VIEW } from '../../../../shared/contracts/security';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Read-only listing of access requests. Drops the dead profiles.is_super_admin
  // lookup (Phase 1 audit P0-4) in favor of the capability gate.
  const guard = await requireCapability(req, res, {
    capability: SUPER_ADMIN_DASHBOARD_VIEW,
    reason: 'access requests list',
  });
  if (guard.ok !== true) return;

  const { status = 'pending', page = '1', limit = '50' } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from('access_requests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ requests: data, total: count, page: pageNum, limit: limitNum });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/admin/access-requests/list' });
