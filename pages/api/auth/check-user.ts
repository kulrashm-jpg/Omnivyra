/**
 * POST /api/auth/check-user
 * Body: { email: string }
 *
 * Checks whether an email exists in Supabase auth.users using the
 * GoTrue admin REST API (service role key — no side effects, no email sent).
 * Returns { exists: boolean }.
 *
 * Used by the login page to show "No account found" before sending a magic link.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
// Service role key required for GoTrue admin API; falls back to anon key (returns exists:true on error)
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ exists: boolean }>
) {
  if (req.method !== 'POST') return res.status(405).end();

  const { email } = (req.body ?? {}) as { email?: string };
  if (!email?.trim()) return res.status(200).json({ exists: false });

  const normalised = email.trim().toLowerCase();

  try {
    // GoTrue admin list-users endpoint supports ?filter= for ILIKE email search.
    const url = new URL(`${SUPABASE_URL}/auth/v1/admin/users`);
    url.searchParams.set('filter', normalised);
    url.searchParams.set('per_page', '10');
    url.searchParams.set('page', '1');

    const resp = await fetch(url.toString(), {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
    });

    if (!resp.ok) {
      // Fail open — let the login page send OTP anyway
      return res.status(200).json({ exists: true });
    }

    const data = (await resp.json()) as { users?: Array<{ email?: string }> };
    const users = Array.isArray(data.users) ? data.users : [];

    // Exact match (filter is ILIKE so may return partial matches)
    const exists = users.some(
      (u) => u.email?.toLowerCase() === normalised
    );

    return res.status(200).json({ exists });
  } catch {
    // Fail open on network error
    return res.status(200).json({ exists: true });
  }
}
