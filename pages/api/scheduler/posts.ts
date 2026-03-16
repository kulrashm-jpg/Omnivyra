import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';

const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return directToken;
  for (const [name, value] of Object.entries(req.cookies || {})) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value as string);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch { /* ignore */ }
  }
  return null;
};

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
    return null;
  }
  return data.user.id;
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
