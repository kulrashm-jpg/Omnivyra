/**
 * POST /api/super-admin/login
 *
 * Replaces the legacy plaintext username/password cookie flow.
 *
 * NOW: Supabase email OTP — the super-admin signs in with their registered
 * Supabase account. After OTP confirmation the client holds a JWT.
 * `profiles.is_super_admin = true` is the authoritative gate (checked by
 * requireSuperAdmin middleware on every protected endpoint).
 *
 * This endpoint is kept ONLY to issue the magic-link email so the
 * super-admin login page has a backend entry point.  It does NOT set cookies.
 *
 * Body: { email: string }
 * Response: { success: true }  — always (prevents email enumeration)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

  if (!email) return res.status(400).json({ error: 'email is required' });

  const ipAddress  = (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket?.remoteAddress ?? null;
  const userAgent  = req.headers['user-agent'] ?? null;

  // Verify the email belongs to a confirmed super-admin before sending the link.
  // This prevents the magic-link endpoint being used to send emails to arbitrary addresses.
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // Look up the user by email via admin API
  const { data: usersPage } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const matchedUser = usersPage?.users?.find(u => u.email?.toLowerCase() === email);

  if (matchedUser) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', matchedUser.id)
      .maybeSingle();

    if (profile?.is_super_admin) {
      // Send magic link — client exchanges it for a JWT session
      await anonClient.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/super-admin/auth-callback`,
          shouldCreateUser: false,
        },
      });

      await supabase.from('super_admin_audit_logs').insert({
        user_id:    matchedUser.id,
        action:     'login_otp_sent',
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: new Date().toISOString(),
      }).then(() => void 0); // non-fatal
    }
    // If NOT is_super_admin we intentionally fall through without error
    // to prevent user enumeration
  }

  // Always respond identically to prevent email/account enumeration
  return res.status(200).json({ success: true, message: 'If this email is registered, a sign-in link has been sent.' });
}
