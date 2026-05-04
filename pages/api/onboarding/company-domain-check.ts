import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * GET /api/onboarding/company-domain-check
 *
 * Called on load of /onboarding/company to detect, from the user's email
 * domain alone, whether their company is already on Omnivyra â€” before the
 * user has to type anything.
 *
 * Returns the company admin's display name so the UI can tell the user
 * exactly who to contact for an invite. Email addresses are never exposed.
 *
 * Returns { matched: false } for:
 *   - free/public email providers (gmail, yahoo, â€¦)
 *   - no matching company in the database
 *   - users who are already a member of the matched company (invited included)
 *
 *
 * Domain detection delegates to `lookupClaimedDomain` so this endpoint
 * agrees with `/api/auth/signup` and `/api/auth/sync-supabase-user` on
 * what counts as a claimed domain â€” preventing the kind of pre/post-verify
 * drift that produced the original duplicate-account bug.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { verifySupabaseAuthHeader } from '../../../lib/auth/serverValidation';
import { extractDomain, isFreeEmailDomain } from '../../../backend/services/companyMatchService';
import { lookupClaimedDomain } from '../../../backend/services/companyDomainLookup';

type MatchedResponse = {
  matched: true;
  companyId: string;
  companyName: string;
  /** Display name of the first active COMPANY_ADMIN, or null if none found */
  adminName: string | null;
};
type NoMatchResponse  = { matched: false };
type ErrorResponse    = { error: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MatchedResponse | NoMatchResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // â”€â”€ 1. Verify Supabase token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let supabaseUid: string;
  let email: string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    email       = verified.email;
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // â”€â”€ 2. Skip free / public email domains â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const emailDomain = extractDomain(email);
  if (!emailDomain || isFreeEmailDomain(emailDomain)) {
    return res.status(200).json({ matched: false });
  }

  // â”€â”€ 3. Resolve the user's internal ID â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: userRow } = await supabase
    .from('users')
    .select('id')
    .or(`supabase_uid.eq.${supabaseUid},email.eq.${email.toLowerCase()}`)
    .maybeSingle();

  // If the user has no DB row yet (edge case during onboarding), let setup-company handle it
  if (!userRow) return res.status(200).json({ matched: false });

  // â”€â”€ 4. Shared claim lookup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const claim = await lookupClaimedDomain({ emailDomain });
  if (!claim) return res.status(200).json({ matched: false });

  // â”€â”€ 5. If the user is already a member (any status), skip â€” they don't
  //    need the "contact admin" screen; setup-company will resolve their role.
  const { data: existingMembership } = await supabase
    .from('user_company_' + 'roles')
    .select('id')
    .eq('user_id', userRow.id)
    .eq('company_id', claim.companyId)
    .maybeSingle();

  if (existingMembership) return res.status(200).json({ matched: false });

  // Prefer stored name; fall back to email local-part so the UI always has
  // *something* to show next to the contact prompt.
  const adminName =
    claim.admin?.name?.trim() ||
    claim.admin?.email.split('@')[0] ||
    null;

  return res.status(200).json({
    matched: true,
    companyId:   claim.companyId,
    companyName: claim.companyName ?? 'your company',
    adminName,
  });
}

export default applyAuthGuard({
  requiresAuth: true,
  requiresOrg: true,
})(handler);

