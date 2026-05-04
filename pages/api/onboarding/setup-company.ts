import { applyAuthGuard } from '@/backend/middleware/applyAuthGuard';

/**
 * POST /api/onboarding/setup-company
 * Authorization: Bearer <supabase_access_token>
 *
 * Creates a company record + links the authenticated user as ADMIN.
 * Idempotent: if user already has a company, returns the existing one.
 *
 * Body: { companyName, website, industry, companySize }
 * Returns: { companyId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleMigrationProxy } from '../../../backend/db/supabaseClient';
const supabase = createServiceRoleMigrationProxy('AUTO_MIGRATION_REQUIRED');
import { randomUUID } from 'crypto';
import { getSupabaseUserFromRequest } from '../../../backend/services/supabaseAuthService';
import {
  findMatchingCompany,
  extractDomain,
  isFreeEmailDomain,
  validatePublicWebsite,
} from '../../../backend/services/companyMatchService';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { grantInitialFreeCredit } from '../../../backend/services/initialFreeCreditService';
import { grantEarnCredit } from '../../../backend/services/earnCreditsService';
import { downgradePlatformSuperAdminRoles } from '../../../backend/services/rbacService';

type Result =
  | { companyId: string; selfJoined?: boolean; matchedCompanyName?: string }
  | { companyExists: true; matchedCompanyId: string; matchedCompanyName: string; adminName: string | null }
  | { code: string; error: string; limit?: number; current?: number | null }
  | { error: string };

/** Returns the display name of the first active COMPANY_ADMIN for a company. */
async function fetchAdminName(
  db: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const { data: roleRow } = await db
    .from('user_company_' + 'roles')
    .select('user_id')
    .eq('company_id', companyId)
    .eq('role', 'COMPANY_ADMIN')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const userId = (roleRow as { user_id: string } | null)?.user_id;
  if (!userId) return null;

  const { data: adminUser } = await db
    .from('users')
    .select('name, email')
    .eq('id', userId)
    .maybeSingle();

  return (
    (adminUser as any)?.name?.trim() ||
    ((adminUser as any)?.email as string | undefined)?.split('@')[0] ||
    null
  );
}

async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Service role bypasses RLS â€” required for inserts into companies,
  // user company roles, company_profiles, and free_credit_profiles.

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    companyName = '',
    website     = '',
    industry    = '',
    companySize = '',
    refCode     = '',
  } = body as {
    companyName?: string;
    website?: string;
    industry?: string;
    companySize?: string;
    refCode?: string;
  };

  if (!companyName.trim()) return res.status(400).json({ error: 'companyName is required' });

  // â”€â”€ Website validation: must be a real public URL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Skip for public-email users who join via invite (they don't create a company)
  const websiteErr = validatePublicWebsite(website.trim());
  if (websiteErr && !isFreeEmailDomain(extractDomain(user.email ?? '') ?? '')) {
    return res.status(400).json({ error: websiteErr });
  }

  // â”€â”€ Domain eligibility gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (user.email) {
    const eligibility = await checkDomainEligibility(user.email, user.id);
    if (eligibility.status === 'blocked') {
      return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
    }

    // Public email domain â€” allowed only via invite or approved access request.
    // Cannot create a company or receive free credits.
    if (eligibility.reason === 'public_provider') {
      // â”€â”€ Path A: team invite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const { data: invite } = await supabase
        .from('user_company_' + 'roles')
        .select('id, company_id, role')
        .eq('user_id', user.id)
        .eq('status', 'invited')
        .limit(1)
        .maybeSingle();

      // â”€â”€ Path B: approved access request â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const { data: accessRequest } = user.email
        ? await supabase
            .from('access_requests')
            .select('id, organization_id')
            .eq('email', user.email.toLowerCase())
            .eq('status', 'approved')
            .not('organization_id', 'is', null)
            .limit(1)
            .maybeSingle()
        : { data: null };

      if (!invite && !accessRequest) {
        return res.status(403).json({
          code:  'INVITE_REQUIRED',
          error: 'You can only join via an organization invite',
        });
      }

      // â”€â”€ Org join limit for public-email users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Configurable via PUBLIC_EMAIL_MAX_ORGS env var (default: 2).
      // Counts only active memberships â€” invited/inactive rows don't count.
      const maxOrgs = parseInt(process.env.PUBLIC_EMAIL_MAX_ORGS ?? '2', 10);
      const { count: activeOrgCount } = await supabase
        .from('user_company_' + 'roles')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('status', 'active');

      if ((activeOrgCount ?? 0) >= maxOrgs) {
        return res.status(403).json({
          code:      'ORG_LIMIT_REACHED',
          error:     `Public email accounts may belong to at most ${maxOrgs} organization${maxOrgs === 1 ? '' : 's'}.`,
          limit:     maxOrgs,
          current:   activeOrgCount,
        });
      }

      const now = new Date().toISOString();

      if (invite) {
        // Accept the team invite: move 'invited' â†’ 'active'
        await supabase
          .from('user_company_' + 'roles')
          .update({ status: 'active', accepted_at: now, updated_at: now })
          .eq('id', invite.id);

        await supabase
          .from('users')
          .update({ company_id: invite.company_id, updated_at: now })
          .eq('id', user.id);

        return res.status(200).json({ companyId: invite.company_id });
      }

      // Approved access request: attach user to the pre-created company as COMPANY_ADMIN
      const orgId = accessRequest!.organization_id as string;

      // Idempotent: only insert if not already a member
      const { data: existingRole } = await supabase
        .from('user_company_' + 'roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', orgId)
        .maybeSingle();

      if (!existingRole) {
        await supabase.from('user_company_' + 'roles').insert({
          user_id:     user.id,
          company_id:  orgId,
          role:        'COMPANY_ADMIN',
          status:      'active',
          join_source: 'invited',           // approved via access request = effectively invited
          accepted_at: now,
          created_at:  now,
          updated_at:  now,
        });
      }

      await supabase
        .from('users')
        .update({ company_id: orgId, role: 'COMPANY_ADMIN', onboarding_state: 'company_complete', updated_at: now })
        .eq('id', user.id);

      return res.status(200).json({ companyId: orgId });
    }
  }

  try {
    // â”€â”€ 1. Fix any SUPER_ADMIN role â€” company users must be COMPANY_ADMIN â”€â”€â”€â”€â”€
    await downgradePlatformSuperAdminRoles(user.id);

    // â”€â”€ 2. Check for existing company membership (idempotent) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { data: existing } = await supabase
      .from('user_company_' + 'roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existing?.company_id) {
      return res.status(200).json({ companyId: existing.company_id });
    }

    // â”€â”€ 3. Check if a matching company already exists in the system â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const matched = await findMatchingCompany({
      companyName: companyName.trim(),
      website: website.trim() || null,
      userEmail: user.email ?? null,
    });

    if (matched) {
      // Company already exists â€” do NOT auto-join. Return a signal so the
      // onboarding UI can prompt the user to request access from the admin.

      // Idempotent: if the user is already a member just let them through
      const { data: existingRole } = await supabase
        .from('user_company_' + 'roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', matched.company_id)
        .maybeSingle();

      if (existingRole) {
        // Already a member â€” go straight to dashboard
        return res.status(200).json({ companyId: matched.company_id });
      }

      const adminName = await fetchAdminName(supabase, matched.company_id);
      return res.status(200).json({
        companyExists:      true,
        matchedCompanyId:   matched.company_id,
        matchedCompanyName: matched.company_name,
        adminName,
      });
    }

    const companyId = randomUUID();
    const now = new Date().toISOString();

    // â”€â”€ 3. Create companies row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // website_domain: normalised domain from the website URL (e.g. "drishiq.com"
    //   from "www.drishiq.com"). Used for fast indexed lookup when a new user
    //   from the same domain signs up independently.
    // admin_email_domain: fallback for companies created without a real website.
    const websiteDomain = (() => {
      const d = extractDomain(website.trim());
      return d && !isFreeEmailDomain(d) ? d : null;
    })();
    const adminEmailDomain = (() => {
      const d = extractDomain(user.email ?? '');
      return d && !isFreeEmailDomain(d) ? d : null;
    })();

    // â”€â”€ STEP 1: Domain-first lookup â€” prevent duplicate companies per domain â”€â”€
    // Check website_domain first (www. is stripped so omnivyra.com and
    // www.omnivyra.com resolve to the same record), then admin_email_domain.
    //
    // NOTE: This is intentionally broader than the shared `lookupClaimedDomain`
    // helper in companyDomainLookup.ts (which gates /api/auth/signup and
    // /api/auth/sync-supabase-user). The signup path matches by the user's
    // EMAIL domain only â€” that's the canonical claim. This onboarding path
    // also matches the WEBSITE the user typed, because someone setting up
    // a company manually (e.g. with a free-email account) could claim a
    // website that's already registered. Both checks exist by design; if you
    // change one, decide whether the other should follow.
    const websiteDomainMatch = websiteDomain
      ? await supabase
          .from('companies')
          .select('id, name')
          .eq('website_domain', websiteDomain)
          .maybeSingle()
          .then(r => r.data)
      : null;

    const adminEmailDomainMatch = adminEmailDomain && !websiteDomainMatch
      ? await supabase
          .from('companies')
          .select('id, name')
          .eq('admin_email_domain', adminEmailDomain)
          .maybeSingle()
          .then(r => r.data)
      : null;

    const domainLookupResult = websiteDomainMatch ?? adminEmailDomainMatch;

    if (adminEmailDomain) {
      const domainCompany = domainLookupResult;

      if (domainCompany) {
        // Domain is already claimed by an existing company.
        // Check if this user is already a member â€” if so, just return the company.
        const { data: existingRole } = await supabase
          .from('user_company_' + 'roles')
          .select('id, status')
          .eq('user_id', user.id)
          .eq('company_id', domainCompany.id)
          .maybeSingle();

        if (existingRole) {
          // If the user was invited (by super admin or company admin), activate them now.
          const role = existingRole as { id: string; status: string };
          if (role.status === 'invited') {
            const now = new Date().toISOString();
            await supabase
              .from('user_company_' + 'roles')
              .update({ status: 'active', accepted_at: now, updated_at: now })
              .eq('id', role.id);
          }
          await supabase
            .from('users')
            .update({ company_id: domainCompany.id, updated_at: new Date().toISOString() })
            .eq('id', user.id);
          return res.status(200).json({ companyId: domainCompany.id });
        }

        // Not a member â€” do NOT auto-join. Only the first user creates the
        // company; everyone else must be invited by the company admin.
        const adminName = await fetchAdminName(supabase, domainCompany.id);
        return res.status(200).json({
          companyExists:      true,
          matchedCompanyId:   domainCompany.id,
          matchedCompanyName: domainCompany.name,
          adminName,
        });
      }
    }

    const { error: companyErr } = await supabase.from('companies').insert({
      id:                 companyId,
      name:               companyName.trim(),
      website:            website.trim() || companyId, // NOT NULL â€” use companyId as placeholder if blank
      industry:           industry.trim() || null,
      size:               companySize.trim() || null,
      status:             'active',
      website_domain:     websiteDomain,
      admin_email_domain: adminEmailDomain,
      domain_claimed_at:  adminEmailDomain ? now : null, // STEP 5
      created_at:         now,
    });

    // â”€â”€ Race condition: another request won the domain UNIQUE race â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (companyErr?.code === '23505' && adminEmailDomain) {
      const { data: raceWinner } = await supabase
        .from('companies')
        .select('id, name')
        .eq('admin_email_domain', adminEmailDomain)
        .maybeSingle();

      if (raceWinner) {
        // Another concurrent request won the INSERT race for this domain.
        // Check if this user already has a membership (e.g. the winning request
        // was from the same user session) â€” if so, let them through.
        const { data: existingRole } = await supabase
          .from('user_company_' + 'roles')
          .select('id')
          .eq('user_id', user.id)
          .eq('company_id', raceWinner.id)
          .maybeSingle();

        if (existingRole) {
          return res.status(200).json({ companyId: raceWinner.id });
        }

        // Different user won the race â€” treat as existing company.
        const adminName = await fetchAdminName(supabase, raceWinner.id);
        return res.status(200).json({
          companyExists:      true,
          matchedCompanyId:   raceWinner.id,
          matchedCompanyName: raceWinner.name,
          adminName,
        });
      }
    }

    if (companyErr) throw companyErr;

    // â”€â”€ 4. Create user company roles row (company admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const { error: roleErr } = await supabase.from('user_company_' + 'roles').insert({
      user_id:     user.id,
      company_id:  companyId,
      role:        'COMPANY_ADMIN',
      status:      'active',
      join_source: 'self_registered',
      created_at:  now,
      updated_at:  now,
    });
    if (roleErr) throw roleErr;

    await supabase
      .from('users')
      .update({ company_id: companyId, role: 'COMPANY_ADMIN', onboarding_state: 'company_complete', updated_at: now })
      .eq('id', user.id);

    // â”€â”€ 5. Create company_profiles row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await supabase.from('company_profiles').insert({
      company_id:  companyId,
      name:        companyName.trim(),
      website_url: website.trim() || null,
      industry:    industry.trim() || null,
      geography:   null,
      report_settings: {
        company_facts: {
          team_size: companySize.trim() || null,
          updated_at: now,
        },
        profile_review: {
          confirmation_interval_days: 183,
          pending_confirmation: Boolean(companySize.trim()),
          updated_at: now,
        },
      },
      created_at:  now,
      updated_at:  now,
    });
    // Non-fatal if profile insert fails â€” company + role are sufficient

    // â”€â”€ 6. Update free_credit_profiles with org_id (if exists) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await supabase
      .from('free_credit_profiles')
      .update({ organization_id: companyId, updated_at: now })
      .eq('user_id', user.id);

    // â”€â”€ 7. Grant initial free credits via the single shared service â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // The service is idempotent at the DB layer (UNIQUE on
    // free_credit_claims.organization_id WHERE category='initial_free_credit')
    // so calling it from multiple onboarding paths is safe. Reads the amount
    // and expiry from free_credit_config; defaults to 50 / 14 days.
    const grantResult = await grantInitialFreeCredit({
      orgId: companyId,
      userId: user.id,
      emailDomain: adminEmailDomain,
    });
    if (grantResult.granted === false && grantResult.reason === 'grant_failed') {
      console.error('[setup-company] credit grant failed:', grantResult.message);
      // Non-fatal â€” company is still created
    }

    // â”€â”€ 8. Mark profile_complete in setup progress â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    await supabase.from('company_setup_progress').upsert(
      { company_id: companyId, profile_complete: true, updated_at: now },
      { onConflict: 'company_id' },
    );

    // â”€â”€ 9. Process referral â€” grant +200 to referrer if valid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (refCode?.trim()) {
      const code = refCode.trim().toLowerCase();
      const { data: referral } = await supabase
        .from('referrals')
        .select('id, referrer_user_id, referrer_org_id, status')
        .eq('referral_code', code)
        .eq('status', 'pending')
        .maybeSingle();

      if (referral && (referral as any).referrer_user_id !== user.id) {
        // Mark referral completed
        await supabase.from('referrals').update({
          status:          'completed',
          referee_user_id: user.id,
          referee_org_id:  companyId,
          completed_at:    now,
        }).eq('id', (referral as any).id);

        // Grant +200 credits to the referrer's org
        await grantEarnCredit({
          orgId:       (referral as any).referrer_org_id,
          userId:      (referral as any).referrer_user_id,
          actionType:  'referral_signup',
          referenceId: (referral as any).id,
        });

        // Clean referral code from any stored state (best-effort)
        // (Frontend clears localStorage after this call succeeds)
      }
    }

    return res.status(200).json({ companyId });
  } catch (err: any) {
    console.error('[onboarding/setup-company]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

export default applyAuthGuard({
  requiresAuth: true,
})(handler);

