import type { NextApiRequest } from 'next';
import { supabase as db } from '../db/supabaseClient';

export const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return null;
};

/**
 * Verify a Supabase access token and resolve the matching public.users row.
 * Returns { id, email } where id is the public.users UUID (not the auth UUID).
 */
export const getSupabaseUserFromRequest = async (
  req: NextApiRequest,
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  const token = extractAccessToken(req);
  if (!token) return { user: null, error: 'MISSING_AUTH' };

  // Verify the Supabase JWT and get the auth user
  const { data: { user: authUser }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !authUser) return { user: null, error: 'INVALID_AUTH' };

  const supabaseUid = authUser.id;
  const email       = authUser.email ?? null;

  // Fast path: look up by supabase_uid
  const { data: uidRow } = await db
    .from('users')
    .select('id, email, is_deleted')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();

  if (uidRow) {
    if ((uidRow as any).is_deleted) return { user: null, error: 'ACCOUNT_DELETED' };
    return { user: { id: (uidRow as any).id, email: (uidRow as any).email }, error: null };
  }

  // Fallback: look up by email (supabase_uid not yet stamped — race on first login)
  if (email) {
    const { data: emailRow } = await db
      .from('users')
      .select('id, email, is_deleted')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (emailRow) {
      if ((emailRow as any).is_deleted) return { user: null, error: 'ACCOUNT_DELETED' };
      // Back-fill supabase_uid so future calls hit the fast path
      await db.from('users').update({ supabase_uid: supabaseUid }).eq('id', (emailRow as any).id);
      return { user: { id: (emailRow as any).id, email: (emailRow as any).email }, error: null };
    }
  }

  return { user: null, error: 'INVALID_AUTH' };
};
