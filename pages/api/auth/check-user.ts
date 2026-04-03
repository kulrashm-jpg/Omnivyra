
/**
 * POST /api/auth/check-user
 * Body: { email: string }
 *
 * Checks whether an email is registered. Returns { exists: boolean }.
 *
 * Strategy (fastest-first):
 *  1. public.users  — covers all users who completed onboarding
 *  2. Supabase Admin REST — covers super-admin accounts and users who signed up
 *     outside the normal onboarding flow
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ exists: boolean; error?: string }>
) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email?.trim()) return res.status(200).json({ exists: false });

  const normalised = email.trim().toLowerCase();

  try {
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // ── 1. Check public.users (fast path) ────────────────────────────────────
    // Exclude soft-deleted rows: a deleted account should appear as "not found"
    // so the login page doesn't reveal that an email was previously registered.
    const { data: publicUsers } = await adminClient
      .from('users')
      .select('id, is_deleted')
      .ilike('email', normalised)
      .limit(1);

    if (Array.isArray(publicUsers) && publicUsers.length > 0) {
      const row = publicUsers[0] as any;
      // Treat soft-deleted as non-existent — the login flow will surface
      // ACCOUNT_DELETED at the appropriate point (sync-firebase-user / post-login-route).
      if (row.is_deleted) {
        return res.status(200).json({ exists: false });
      }
      return res.status(200).json({ exists: true });
    }

    // ── 2. Fallback: query auth.users via Supabase Admin REST API ────────────
    //    Uses email filter param supported by Supabase Auth Admin endpoint.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    const authRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(normalised)}`,
      {
        headers: {
          apikey:        serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    );

    if (authRes.ok) {
      const authJson = await authRes.json() as { users?: { email?: string }[] };
      const found = authJson.users?.some(u => u.email?.toLowerCase() === normalised);
      return res.status(200).json({ exists: !!found });
    }

    // Auth API failed — fail open so legitimate users aren't blocked
    console.warn('[check-user] Auth admin API returned', authRes.status, '— failing open');
    return res.status(200).json({ exists: true });

  } catch (err) {
    console.error('[check-user] Error:', err);
    return res.status(200).json({ exists: true }); // fail open
  }
}
