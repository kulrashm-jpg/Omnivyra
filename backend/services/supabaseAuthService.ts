import type { NextApiRequest } from 'next';
import { supabase } from '../db/supabaseClient';

export const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const directToken = req.cookies?.['sb-access-token'];
  if (directToken) return String(directToken);
  const cookieEntries = Object.entries(req.cookies || {});
  for (const [name, value] of cookieEntries) {
    if (!name.startsWith('sb-') || !name.endsWith('-auth-token')) continue;
    try {
      const parsed = JSON.parse(value);
      if (parsed?.access_token) return String(parsed.access_token);
    } catch {
      // ignore malformed cookie
    }
  }
  return null;
};

export const getSupabaseUserFromRequest = async (
  req: NextApiRequest
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  const token = extractAccessToken(req);
  if (!token) {
    return { user: null, error: 'MISSING_AUTH' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: 'INVALID_AUTH' };
  }
  return { user: { id: data.user.id, email: data.user.email }, error: null };
};
