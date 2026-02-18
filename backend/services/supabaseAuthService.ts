import type { NextApiRequest } from 'next';
import { supabase } from '../db/supabaseClient';

const extractBearerToken = (req: NextApiRequest): string | null => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
};

export const getSupabaseUserFromRequest = async (
  req: NextApiRequest
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, error: 'MISSING_AUTH' };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { user: null, error: 'INVALID_AUTH' };
  }
  return { user: { id: data.user.id, email: data.user.email }, error: null };
};
