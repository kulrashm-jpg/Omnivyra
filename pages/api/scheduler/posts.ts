import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '@/backend/services/supabaseAuthService';

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = await requireUserId(req, res);
  if (!userId) return;

  try {
    const { data: posts, error } = await supabase
      .from('scheduled_posts')
      .select('id, platform, content, scheduled_for, status, error_message, platform_post_id')
      .eq('user_id', userId)
      .order('scheduled_for', { ascending: true });

    if (error) {
      console.error('[scheduler/posts] query error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json(posts || []);
  } catch (error: any) {
    console.error('[scheduler/posts] error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
