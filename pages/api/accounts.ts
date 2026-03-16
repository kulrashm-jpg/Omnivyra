import { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '@/backend/db/supabaseClient';
import { getConnectionStatus } from '@/backend/services/connectionHealthStatus';

const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const cookieEntries = Object.entries(req.cookies || {});
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return directToken;
  for (const [name, value] of cookieEntries) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value as string);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch {
      // ignore malformed cookie
    }
  }
  return null;
};

async function requireUserId(req: NextApiRequest, res: NextApiResponse): Promise<string | null> {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED' });
    return null;
  }
  return data.user.id;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = await requireUserId(req, res);
    if (!userId) return;

    const { data: accounts, error } = await supabase
      .from('social_accounts')
      .select('id, platform, account_name, username, follower_count, last_sync_at, token_expires_at, is_active')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    const list = (accounts || []).map((row: any) => ({
      id: row.id,
      platform: row.platform,
      account_name: row.account_name ?? null,
      username: row.username ?? null,
      follower_count: row.follower_count ?? 0,
      last_sync_at: row.last_sync_at ?? null,
      token_expires_at: row.token_expires_at ?? null,
      is_active: Boolean(row.is_active),
      connection_status: getConnectionStatus(row.token_expires_at),
    }));

    return res.status(200).json(list);
  } catch (err: any) {
    console.error('Error fetching accounts:', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
