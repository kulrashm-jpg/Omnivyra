/**
 * GET /api/auth/get-stored-phone
 * Authorization: Bearer <supabase_access_token>
 *
 * Returns the phone number stored in free_credit_profiles for the
 * authenticated user, plus a masked version for display.
 *
 * Used by /onboarding/verify-phone to know which number to send OTP to.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as supabaseAdmin } from '../../../backend/db/supabaseClient';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';

function maskPhone(phone: string): string {
  // e.g. +447911123456 → +44 ••• ••• 456
  if (phone.length < 4) return '•••';
  const last3 = phone.slice(-3);
  const prefix = phone.slice(0, Math.min(4, phone.length - 3));
  return `${prefix} ••• ••• ${last3}`;
}

type Payload =
  | { phone: string; maskedPhone: string }
  | { phone: null; maskedPhone: null }
  | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Payload>
) {
  if (req.method !== 'GET') return res.status(405).end();

  const { user, error } = await getSupabaseUserFromRequest(req);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error: dbErr } = await supabaseAdmin
    .from('free_credit_profiles')
    .select('phone_number')
    .eq('user_id', user.id)
    .single();

  if (dbErr || !data?.phone_number) {
    return res.status(200).json({ phone: null, maskedPhone: null });
  }

  return res.status(200).json({
    phone: data.phone_number,
    maskedPhone: maskPhone(data.phone_number),
  });
}
