/**
 * POST /api/auth/check-user
 * Body: { email: string }
 *
 * Checks whether an email exists in the users table (database).
 * Returns { exists: boolean }.
 *
 * Used by the login page to show "No account found" before sending a magic link.
 * This ensures only users with existing accounts can proceed with login.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ exists: boolean; error?: string }>
) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email?.trim()) return res.status(200).json({ exists: false });

  const normalised = email.trim().toLowerCase();

  try {
    // Check database users table for the email
    const { data, error } = await supabase
      .from('users')
      .select('id, email')
      .ilike('email', normalised)
      .limit(1);

    if (error) {
      console.error('[check-user] Database error:', error);
      // Fail open on database error — allow login to proceed
      return res.status(200).json({ exists: true });
    }

    // Check if exact match exists (ilike returns case-insensitive, so verify)
    const exists = Array.isArray(data) && data.length > 0 && 
      data.some(u => u.email?.toLowerCase() === normalised);

    return res.status(200).json({ exists });
  } catch (err) {
    console.error('[check-user] Error:', err);
    // Fail open on error — let the login page send OTP anyway
    return res.status(200).json({ exists: true });
  }
}
