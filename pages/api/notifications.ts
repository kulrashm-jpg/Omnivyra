import { createApiRoute as __createApiRoute } from '../../lib/platform/routeFactory';
import { setPrivateCache, CACHE_TTL } from '../../lib/platform/httpCache';

/**
 * GET  /api/notifications       — fetch recent notifications for the current user
 * PATCH /api/notifications      — mark all notifications as read
 * PATCH /api/notifications?id=  — mark a single notification as read
 *
 * Auth: Bearer token or Supabase session cookie.
 *
 * Caching (OPT-002): GET 200 is P3 private, NEAR_LIVE (30 s). Invalidation:
 * NotificationBell updates local state optimistically after PATCH; the
 * mark-all PATCH shares this URI so the browser also auto-invalidates.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../backend/services/supabaseAuthService';

/**
 * STEP 3AH-91: the canonical resolver is the ONLY identity path. It already
 * reads the Supabase session cookie, and it applies the deleted / suspended /
 * revoked-session / invited checks. The former @supabase/ssr + supabase_uid
 * fallback ran only when the resolver had refused the caller, so it could only
 * re-admit sessions that must be refused (same class as SEC91-W2B-1).
 */
async function resolveUserId(req: NextApiRequest): Promise<string | null> {
  const { user } = await getSupabaseUserFromRequest(req);
  return user?.id ?? null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = await resolveUserId(req);
  if (!userId) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, title, message, metadata, is_read, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    setPrivateCache(res, CACHE_TTL.NEAR_LIVE);
    return res.status(200).json({ notifications: data ?? [] });
  }

  if (req.method === 'PATCH') {
    const id = typeof req.query.id === 'string' ? req.query.id : null;
    const query = supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId);

    const { error } = await (id ? query.eq('id', id) : query);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/notifications' });
