import type { NextApiRequest } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyFirebaseIdToken } from '../../lib/firebaseAdmin';

// Database-only client — no auth calls
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const extractAccessToken = (req: NextApiRequest): string | null => {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
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

  // ── Verify Firebase ID token ──────────────────────────────────────────────
  let firebaseUid: string | null = null;
  let firebaseEmail: string | null = null;

  try {
    const decoded = await verifyFirebaseIdToken(token);
    firebaseUid = decoded.uid;
    firebaseEmail = decoded.email ?? null;
  } catch {
    return { user: null, error: 'INVALID_AUTH' };
  }

  if (!firebaseUid) {
    return { user: null, error: 'INVALID_AUTH' };
  }

  // ── Look up user row by firebase_uid ──────────────────────────────────────
  const { data: uidRow } = await db
    .from('users')
    .select('id, email, is_deleted')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();

  if (uidRow) {
    if ((uidRow as any).is_deleted) {
      // User was soft-deleted — treat as non-existent to prevent ghost access.
      return { user: null, error: 'ACCOUNT_DELETED' };
    }
    return { user: { id: (uidRow as any).id, email: (uidRow as any).email }, error: null };
  }

  // ── Email fallback — firebase_uid not yet written (race on first login) ───
  if (firebaseEmail) {
    const { data: emailRow } = await db
      .from('users')
      .select('id, email, is_deleted')
      .eq('email', firebaseEmail)
      .maybeSingle();

    if (emailRow) {
      if ((emailRow as any).is_deleted) {
        return { user: null, error: 'ACCOUNT_DELETED' };
      }
      // Back-fill firebase_uid so future calls hit the fast path
      await db
        .from('users')
        .update({ firebase_uid: firebaseUid })
        .eq('id', (emailRow as any).id);

      return { user: { id: (emailRow as any).id, email: (emailRow as any).email }, error: null };
    }
  }

  return { user: null, error: 'INVALID_AUTH' };
};
