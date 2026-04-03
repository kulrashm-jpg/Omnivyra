
/**
 * POST /api/auth/magic-link
 *
 * Public endpoint. Validates that an email exists in public.users.
 * Returns { proceed: true } so the frontend can call signInWithOtp().
 *
 * Body: { email: string }
 * No auth required.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';

type SuccessResponse = { proceed: true };
type ErrorResponse   = { error: string; code?: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SuccessResponse | ErrorResponse>,
) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { email } = body as { email?: string };

  if (!email?.trim()) return res.status(400).json({ error: 'email is required' });

  const normalizedEmail = email.trim().toLowerCase();

  // ── 1. Check user exists in public.users ──────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id, is_deleted')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (!userRow) {
    // Return generic error to avoid email enumeration
    return res.status(400).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  if ((userRow as any).is_deleted) {
    return res.status(400).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  // ── 2. Return proceed — frontend calls signInWithOtp() ────────────────────
  return res.status(200).json({ proceed: true });
}
