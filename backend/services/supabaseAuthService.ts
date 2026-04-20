import type { NextApiRequest } from 'next';
import { supabase as db } from '../db/supabaseClient';
import { logger } from './logger';

export const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return null;
};

function extractCookieToken(req: NextApiRequest): string | null {
  const cookies = req.headers.cookie || '';
  const patterns = [
    /sb-[a-z0-9]+-auth-token=([^;]+)/i,
    /auth-token=([^;]+)/i,
    /supabase-auth=([^;]+)/i,
  ];

  for (const pattern of patterns) {
    const match = cookies.match(pattern);
    if (!match?.[1]) continue;

    try {
      let cookieValue = decodeURIComponent(match[1]);
      if (cookieValue.startsWith('base64-')) {
        cookieValue = cookieValue.slice(7);
      }

      if (cookieValue.startsWith('eyJ')) {
        try {
          cookieValue = Buffer.from(cookieValue, 'base64').toString('utf-8');
        } catch (error) {
          logger.warn('supabase_cookie_base64_decode_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const parsed = JSON.parse(cookieValue);
      if (parsed?.access_token) {
        return parsed.access_token as string;
      }
    } catch (error) {
      logger.warn('supabase_cookie_parse_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.warn('supabase_cookie_missing', {
    cookieKeys: cookies.split(';').map((part) => part.split('=')[0]).join(','),
  });
  return null;
}

async function resolveAuthUser(token: string): Promise<{ id: string; email?: string | null } | null> {
  let authResult: Awaited<ReturnType<typeof db.auth.getUser>>;
  try {
    authResult = await Promise.race([
      db.auth.getUser(token),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Supabase auth timeout')), 5_000)),
    ]);
  } catch (error) {
    logger.error('supabase_auth_lookup_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const authUser = authResult.data.user;
  if (authResult.error || !authUser) {
    logger.warn('supabase_auth_invalid', {
      message: authResult.error?.message ?? 'unknown',
    });
    return null;
  }

  return {
    id: authUser.id,
    email: authUser.email ?? null,
  };
}

export const getSupabaseUserFromRequest = async (
  req: NextApiRequest,
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  const token = extractAccessToken(req) ?? extractCookieToken(req);
  if (!token) {
    return { user: null, error: 'MISSING_AUTH' };
  }

  const authUser = await resolveAuthUser(token);
  if (!authUser) {
    return { user: null, error: 'INVALID_AUTH' };
  }

  const supabaseUid = authUser.id;
  const email = authUser.email ?? null;

  const { data: uidRow } = await db
    .from('users')
    .select('id, email, is_deleted')
    .eq('supabase_uid', supabaseUid)
    .maybeSingle();

  if (uidRow) {
    if ((uidRow as any).is_deleted) return { user: null, error: 'ACCOUNT_DELETED' };
    return { user: { id: (uidRow as any).id, email: (uidRow as any).email }, error: null };
  }

  if (email) {
    const { data: emailRow } = await db
      .from('users')
      .select('id, email, is_deleted')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (emailRow) {
      if ((emailRow as any).is_deleted) return { user: null, error: 'ACCOUNT_DELETED' };
      await db.from('users').update({ supabase_uid: supabaseUid }).eq('id', (emailRow as any).id);
      return { user: { id: (emailRow as any).id, email: (emailRow as any).email }, error: null };
    }
  }

  return { user: null, error: 'INVALID_AUTH' };
};
