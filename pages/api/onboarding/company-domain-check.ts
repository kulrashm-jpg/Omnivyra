import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

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
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { extractDomain, isFreeEmailDomain } from '../../../backend/services/companyMatchService';

type MatchedResponse = {
  matched: true;
  companyName: string;
  /** Display name of the first active COMPANY_ADMIN, or null if none found */
  adminName: string | null;
};
type NoMatchResponse  = { matched: false };
type ErrorResponse    = { error: string; code?: string };

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MatchedResponse | NoMatchResponse | ErrorResponse>,
) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Verify Supabase token (Bearer header OR Supabase auth cookie) ─────
  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const supabaseUid: string = authResult.user.supabaseUid;
  const email: string = authResult.user.email;

  // SECURITY (e1, 2026-11-12): the email domain is the ONLY evidence this endpoint uses, so it must be
  // VERIFIED - an unverified session at someone else's domain learned their company and admin.
  if (!authResult.user.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
  }

  // ── 2. Skip free / public email domains ───────────────────────────────────
  const emailDomain = extractDomain(email);
  if (!emailDomain || isFreeEmailDomain(emailDomain)) {
    return res.status(200).json({ matched: false });
  }

  // ── 3. Resolve the user's internal ID ────────────────────────────────────
  // Two exact reads - never an interpolated .or() filter string. A read error refuses.
  const byUid = await supabase.from('users').select('id').eq('supabase_uid', supabaseUid).maybeSingle();
  const byEmail = byUid.data || byUid.error
    ? { data: null, error: null }
    : await supabase.from('users').select('id').eq('email', email.toLowerCase()).maybeSingle();
  if (byUid.error || byEmail.error) return res.status(500).json({ error: 'Could not check your company.' });
  const userRow = byUid.data ?? byEmail.data;

  // If the user has no DB row yet (edge case during onboarding), let setup-company handle it
  if (!userRow) return res.status(200).json({ matched: false });

  // ── 4. Find a company whose domain matches the user's email domain ────────
  // Check both website_domain and admin_email_domain.
  // website_domain first, then admin_email_domain - two exact reads, no interpolated .or().
  const byWebsite = await supabase
    .from('companies').select('id, name').eq('status', 'active').eq('website_domain', emailDomain).maybeSingle();
  const byAdminDomain = byWebsite.data || byWebsite.error
    ? { data: null, error: null }
    : await supabase
        .from('companies').select('id, name').eq('status', 'active').eq('admin_email_domain', emailDomain).maybeSingle();
  if (byWebsite.error || byAdminDomain.error) return res.status(500).json({ error: 'Could not check your company.' });
  const company = byWebsite.data ?? byAdminDomain.data;

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
      .select('name')
      .eq('id', adminRole.user_id)
      .maybeSingle();

    // Display name only - never the email (nor its local-part).
    adminName = (adminUser as any)?.name?.trim() || null;
  }

  return res.status(200).json({
    matched: true,
    companyName: company.name,
    adminName,
  });
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/onboarding/company-domain-check' });
