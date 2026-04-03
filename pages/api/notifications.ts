
/**
 * GET  /api/notifications       — fetch recent notifications for the current user
 * PATCH /api/notifications      — mark all notifications as read
 * PATCH /api/notifications?id=  — mark a single notification as read
 *
 * Auth: Bearer token or Supabase session cookie.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServerClient } from '@supabase/ssr';
import { supabase } from '../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../backend/services/supabaseAuthService';

async function resolveUserId(req: NextApiRequest): Promise<string | null> {
  const { user } = await getSupabaseUserFromRequest(req);
  if (user?.id) return user.id;

  try {
    const ssrClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () =>
            Object.entries(req.cookies).map(([name, value]) => ({ name, value: value ?? '' })),
          setAll: () => {},
        },
      }
    );
    const { data: { user: ssrUser } } = await ssrClient.auth.getUser();
    if (!ssrUser?.id) return null;

    const { data: row } = await supabase
      .from('users')
      .select('id')
      .eq('supabase_uid', ssrUser.id)
      .maybeSingle();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
