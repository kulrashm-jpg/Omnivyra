/**
 * GET  /api/notifications          — list unread notifications for the authed user
 * PATCH /api/notifications         — mark all as read
 * PATCH /api/notifications?id=xxx  — mark one as read
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as supabaseAdmin } from '@/backend/db/supabaseClient';

async function getUser(req: NextApiRequest) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (!token) return null;
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  return user ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('notifications')
      .select('id, type, title, message, metadata, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ notifications: data ?? [] });
  }

  if (req.method === 'PATCH') {
    const { id } = req.query as { id?: string };
    const filter = supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id);

    const { error } = id ? await filter.eq('id', id) : await filter.eq('is_read', false);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  res.setHeader('Allow', 'GET, PATCH');
  return res.status(405).end();
}
