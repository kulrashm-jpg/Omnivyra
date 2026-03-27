/**
 * GET /api/onboarding/company-domain-check
 *
 * Called on load of /onboarding/company to detect, from the user's email
 * domain alone, whether their company is already on Omnivyra — before the
 * user has to type anything.
 *
 * Returns the company admin's display name so the UI can tell the user
 * exactly who to contact for an invite. Email addresses are never exposed.
 *
 * Returns { matched: false } for:
 *   - free/public email providers (gmail, yahoo, …)
 *   - no matching company in the database
 *   - users who are already a member of the matched company (invited included)
 *
 * Auth: Firebase ID token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase } from '../../../backend/db/supabaseClient';
import { verifySupabaseAuthHeader } from '../../../lib/auth/serverValidation';
import { extractDomain, isFreeEmailDomain } from '../../../backend/services/companyMatchService';

type MatchedResponse = {
  matched: true;
  companyId: string;
  companyName: string;
  /** Display name of the first active COMPANY_ADMIN, or null if none found */
  adminName: string | null;
};
type NoMatchResponse  = { matched: false };
type ErrorResponse    = { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MatchedResponse | NoMatchResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Supabase token ──────────────────────────────────────────────
  let supabaseUid: string;
  let email: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email       = verified.email;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── 2. Skip free / public email domains ───────────────────────────────────
  const emailDomain = extractDomain(email);
  if (!emailDomain || isFreeEmailDomain(emailDomain)) {
    return res.status(200).json({ matched: false });
  }

  // ── 3. Resolve the user's internal ID ────────────────────────────────────
  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .or(`supabase_uid.eq.${supabaseUid},email.eq.${email.toLowerCase()}`)
    .maybeSingle();

  // If the user has no DB row yet (edge case during onboarding), let setup-company handle it
  if (!userRow) return res.status(200).json({ matched: false });

  // ── 4. Find a company whose domain matches the user's email domain ────────
  // Check both website_domain and admin_email_domain.
  const { data: company } = await supabase
    .from('companies')
    .select('id, name')
    .eq('status', 'active')
    .or(`website_domain.eq.${emailDomain},admin_email_domain.eq.${emailDomain}`)
    .maybeSingle();

  if (!company) return res.status(200).json({ matched: false });

  // ── 5. If the user is already a member (any status), skip — they don't
  //    need the "contact admin" screen; setup-company will resolve their role.
  const { data: existingMembership } = await supabase
    .from('user_company_roles')
    .select('id')
    .eq('user_id', userRow.id)
    .eq('company_id', company.id)
    .maybeSingle();

  if (existingMembership) return res.status(200).json({ matched: false });

  // ── 6. Find the first active COMPANY_ADMIN for display name ──────────────
  const { data: adminRole } = await supabase
    .from('user_company_roles')
    .select('user_id')
    .eq('company_id', company.id)
    .eq('role', 'COMPANY_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  let adminName: string | null = null;
  if (adminRole?.user_id) {
    const { data: adminUser } = await supabase
      .from('users')
      .select('name, email')
      .eq('id', adminRole.user_id)
      .maybeSingle();

    // Prefer stored name; fall back to the email local-part
    adminName =
      (adminUser as any)?.name?.trim() ||
      ((adminUser as any)?.email as string | undefined)?.split('@')[0] ||
      null;
  }

  return res.status(200).json({
    matched: true,
    companyId:   company.id,
    companyName: company.name,
    adminName,
  });
}
