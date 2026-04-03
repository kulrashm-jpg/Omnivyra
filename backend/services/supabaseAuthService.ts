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
 * Supports both Bearer tokens and session cookies.
 */
export const getSupabaseUserFromRequest = async (
  req: NextApiRequest,
): Promise<{ user: { id: string; email?: string | null } | null; error: string | null }> => {
  let token = extractAccessToken(req);
  let authUser = null;

  if (token) {
    // Bearer token provided - verify it
    const { data: { user }, error } = await db.auth.getUser(token);
    if (error || !user) {
      console.error('❌ Bearer token invalid:', error?.message);
      return { user: null, error: 'INVALID_AUTH' };
    }
    console.log('✅ Authenticated via Bearer token');
    authUser = user;
  } else {
    // No Bearer token - try to get session from cookies
    try {
      const cookies = req.headers.cookie || '';
      console.log('🔍 Parsing cookies (length:', cookies.length, ')');
      console.log('🔍 Raw cookies:', cookies.substring(0, 100), '...');
      
      // Try multiple Supabase cookie patterns
      const patterns = [
        /sb-[a-z0-9]+-auth-token=([^;]+)/i,  // Standard pattern
        /auth-token=([^;]+)/i,                 // Fallback
        /supabase-auth=([^;]+)/i,              // Alternative
      ];
      
      let sessionJson = null;
      for (const pattern of patterns) {
        const match = cookies.match(pattern);
        if (match?.[1]) {
          try {
            console.log('🔍 Found auth cookie, decoding...');
            let cookieValue = decodeURIComponent(match[1]);
            console.log('🔍 After URL decode:', cookieValue.substring(0, 50), '...');
            
            // Strip "base64-" prefix if present
            if (cookieValue.startsWith('base64-')) {
              cookieValue = cookieValue.substring(7);
              console.log('🔍 After stripping base64- prefix:', cookieValue.substring(0, 50), '...');
            }
            
            // Try base64 decoding if it looks like base64
            if (cookieValue.startsWith('eyJ')) {
              try {
                const decoded = Buffer.from(cookieValue, 'base64').toString('utf-8');
                console.log('🔍 After base64 decode:', decoded.substring(0, 50), '...');
                cookieValue = decoded;
              } catch (e) {
                console.log('🔍 Base64 decode failed, using as-is:', e instanceof Error ? e.message : e);
                // Not base64, use as-is
              }
            }
            
            sessionJson = JSON.parse(cookieValue);
            console.log('🔍 Parsed JSON - has access_token?', !!sessionJson.access_token);
            if (sessionJson.access_token) {
              token = sessionJson.access_token;
              console.log('✅ Extracted token from cookie:', token.substring(0, 20), '...');
              break;
            }
          } catch (e) {
            console.log('⚠️ Cookie parse attempt failed:', e instanceof Error ? e.message : e);
          }
        }
      }
      
      if (token) {
        const { data: { user }, error } = await db.auth.getUser(token);
        if (error || !user) {
          console.error('❌ Cookie token invalid:', error?.message);
          return { user: null, error: 'INVALID_AUTH' };
        }
        console.log('✅ Authenticated via cookie token');
        authUser = user;
      } else {
        console.warn('⚠️ No valid auth cookie found. Cookies available:', cookies.split(';').map(c => c.split('=')[0]).join(', '));
      }
    } catch (e) {
      console.error('❌ Cookie extraction error:', e instanceof Error ? e.message : e);
    }

    if (!authUser) {
      return { user: null, error: 'MISSING_AUTH' };
    }
  }

  if (!authUser) {
    return { user: null, error: 'MISSING_AUTH' };
  }

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
