
/**
 * POST /api/onboarding/setup-company
 * Authorization: Bearer <supabase_access_token>
 *
 * Creates a company record + links the authenticated user as ADMIN.
 * Idempotent: if user already has a company, returns the existing one.
 *
 * Body: { companyName, website, industry, businessTypes, companySize }
 * Returns: { companyId }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../../backend/db/supabaseClient';
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
import {
  crawlWebsiteSources,
  mergeDiscoveredSocialProfiles,
} from '../../../backend/services/companyProfile/refinementHelpers';
import {
  SELF_REGISTERED_JOIN_SOURCE,
  selectCompatibleCompanyRole,
} from '../../../backend/services/companyMembershipIntegrityService';
import { resolveDomain } from '../../../backend/services/domainCanonicalService';
import { httpStatusFor, ELIGIBILITY_MESSAGES, reviewableResults } from '../../../lib/auth/domainEligibilityModel';
import { checkRateLimit, DOMAIN_RESOLUTION_LIMIT } from '../../../lib/auth/rateLimit';
import { logDomainEvent } from '../../../backend/services/domainEventLogger';
import { notifyAdminAndProspectOfClaimedDomain } from '../../../backend/services/claimedDomainNotifyService';

type Result =
  | { companyId: string; selfJoined?: boolean; matchedCompanyName?: string }
  | { companyExists: true; matchedCompanyId: string; matchedCompanyName: string; adminName: string | null }
  | { code: string; error: string; limit?: number; current?: number | null }
  | { error: string };

function deriveWebsiteFromEmail(email: string | null | undefined): string | null {
  const domain = extractDomain(email ?? '');
  if (!domain || isFreeEmailDomain(domain)) return null;
  return `https://www.${domain}`;
}

/** Returns the display name of the first active COMPANY_ADMIN for a company. */
async function fetchAdminName(
  db: SupabaseClient,
  companyId: string,
): Promise<string | null> {
  const { data: roleRow } = await db
    .from('user_company_roles')
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

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'POST') return res.status(405).end();

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Client IP — used to rate-limit the outbound domain-canonical HTTP probe
  // (caps the SSRF/abuse surface a single IP can drive). Mirrors the
  // extraction in pages/api/auth/sync-supabase-user.ts.
  const clientIp = (() => {
    const raw = String(
      req.headers['x-forwarded-for']
      ?? (req.socket as any)?.remoteAddress
      ?? 'unknown',
    ).split(',')[0].trim();
    return raw && raw !== 'unknown' ? raw : undefined;
  })();

  /**
   * Rule 5 — a verified user from an already-claimed domain tried to create an
   * account. Don't auto-join; email both the prospect (admin contact details)
   * and the company admin (someone from your domain tried to sign up). The
   * "company-exists" screen the client already renders is the on-screen
   * "consult your admin" message; this adds the two emails. Best-effort: the
   * shared service never throws, so onboarding is never blocked by it.
   */
  const notifyClaimedDomain = async (
    matchedCompanyId: string,
    matchedCompanyName: string | null,
  ): Promise<void> => {
    const emailDomain = extractDomain(user.email ?? '') ?? '';
    if (!user.email || !emailDomain || isFreeEmailDomain(emailDomain)) return;
    await notifyAdminAndProspectOfClaimedDomain(supabase, {
      prospectUserId: user.id,
      prospectEmail:  user.email,
      emailDomain,
      companyId:      matchedCompanyId,
      companyName:    matchedCompanyName,
      nowIso:         new Date().toISOString(),
    });
  };

  // Service role bypasses RLS — required for inserts into companies,
  // user_company_roles, company_profiles, and free_credit_profiles.

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    companyName = '',
    website     = '',
    industry    = '',
    businessType = '',
    businessTypes = [],
    companySize = '',
    refCode     = '',
  } = body as {
    companyName?: string;
    website?: string;
    industry?: string;
    businessType?: string;
    businessTypes?: string[];
    companySize?: string;
    refCode?: string;
  };
  const businessTypeLabels: Record<string, string> = {
    product: 'Product company',
    reseller: 'Reseller / distributor',
    service: 'Service provider',
    agency: 'Agency',
  };
  const normalizedBusinessTypes = Array.from(new Set(
    [
      ...(Array.isArray(businessTypes) ? businessTypes : []),
      businessType,
    ]
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => businessTypeLabels[item] ?? item),
  ));
  const businessTypeText = normalizedBusinessTypes.join(', ');
  const { data: userProfileRow } = await supabase
    .from('users')
    .select('name, industry')
    .eq('id', user.id)
    .maybeSingle();
  const typedUserProfileRow = userProfileRow as { name?: string | null; industry?: string | null } | null;
  if (!String(typedUserProfileRow?.name || '').trim()) {
    return res.status(409).json({ error: 'Please complete your personal profile before creating a company profile.' });
  }
  const userProfileIndustry = String(typedUserProfileRow?.industry || '').trim();
  const profileIndustry = industry.trim() || userProfileIndustry;
  const emailDerivedWebsite = deriveWebsiteFromEmail(user.email);
  const canonicalWebsite = emailDerivedWebsite || website.trim();

  if (!companyName.trim()) return res.status(400).json({ error: 'companyName is required' });

  // ── Website validation: must be a real public URL ─────────────────────────
  // Skip for public-email users who join via invite (they don't create a company)
  const websiteErr = validatePublicWebsite(canonicalWebsite);
  if (websiteErr && !isFreeEmailDomain(extractDomain(user.email ?? '') ?? '')) {
    return res.status(400).json({ error: websiteErr });
  }

  // ── Domain eligibility gate ───────────────────────────────────────────────
  if (user.email) {
    const eligibility = await checkDomainEligibility(user.email, user.id);
    if (!eligibility.eligible && !reviewableResults.has(eligibility.result)) {
      return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
    }

    // Public email domain — allowed only via invite or approved access request.
    // Cannot create a company or receive free credits.
    if (eligibility.result === 'PUBLIC_EMAIL') {
      // ── Path A: team invite ──────────────────────────────────────────────
      const { data: invite } = await supabase
        .from('user_company_roles')
        .select('id, company_id, role')
        .eq('user_id', user.id)
        .eq('status', 'invited')
        .limit(1)
        .maybeSingle();

      // ── Path B: approved access request ─────────────────────────────────
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

      // ── Org join limit for public-email users ────────────────────────────
      // Configurable via PUBLIC_EMAIL_MAX_ORGS env var (default: 2).
      // Counts only active memberships — invited/inactive rows don't count.
      const maxOrgs = parseInt(process.env.PUBLIC_EMAIL_MAX_ORGS ?? '2', 10);
      const { count: activeOrgCount } = await supabase
        .from('user_company_roles')
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
        // Accept the team invite: move 'invited' → 'active'
        await supabase
          .from('user_company_roles')
          .update({ status: 'active', accepted_at: now, updated_at: now })
          .eq('id', invite.id);

        // Stamp users.active_company_id only — users.company_id is deprecated.
        await supabase
          .from('users')
          .update({ active_company_id: invite.company_id, updated_at: now })
          .eq('id', user.id);

        return res.status(200).json({ companyId: invite.company_id });
      }

      // Approved access request: attach user to the pre-created company as COMPANY_ADMIN
      const orgId = accessRequest!.organization_id as string;

      // Idempotent: only insert if not already a member
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', orgId)
        .maybeSingle();

      if (!existingRole) {
        await supabase.from('user_company_roles').insert({
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

      // users.role / users.company_id deprecated — only stamp active_company_id
      // and onboarding_state. Canonical role lives in user_company_roles.
      await supabase
        .from('users')
        .update({ active_company_id: orgId, onboarding_state: 'company_complete', updated_at: now })
        .eq('id', user.id);

      return res.status(200).json({ companyId: orgId });
    }
  }

  try {
    // ── 1. Fix any SUPER_ADMIN role — company users must be COMPANY_ADMIN ─────
    await supabase
      .from('user_company_roles')
      .update({ role: 'COMPANY_ADMIN', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('role', 'SUPER_ADMIN');

    // ── 2. Check for existing company membership (idempotent) ────────────────
    const { data: existingRows } = await supabase
      .from('user_company_roles')
      .select('company_id, join_source, created_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (existingRows?.length) {
      const existingCompanyIds = Array.from(new Set(
        existingRows.map((row: any) => row.company_id).filter(Boolean)
      ));
      const { data: existingCompanies } = existingCompanyIds.length
        ? await supabase
            .from('companies')
            .select('id, website_domain, admin_email_domain')
            .in('id', existingCompanyIds)
        : { data: [] as any[] };
      const existingCompanyById = new Map(
        (existingCompanies || []).map((row: any) => [String(row.id), row])
      );
      const compatibleExisting = selectCompatibleCompanyRole({
        rows: existingRows,
        companyById: existingCompanyById,
        userEmail: user.email ?? null,
      });
      if (compatibleExisting?.company_id) {
        return res.status(200).json({ companyId: compatibleExisting.company_id });
      }
      console.warn('[setup-company] ignored mismatched self-registered company membership during onboarding', {
        userId: user.id,
        emailDomain: extractDomain(user.email ?? ''),
        existingCompanyIds,
      });
    }

    // ── 3. Check if a matching company already exists in the system ───────────
    const matched = await findMatchingCompany({
      companyName: companyName.trim(),
      website: canonicalWebsite || null,
      userEmail: user.email ?? null,
    });

    if (matched) {
      // Company already exists — do NOT auto-join. Return a signal so the
      // onboarding UI can prompt the user to request access from the admin.

      // Idempotent: if the user is already a member just let them through
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', matched.company_id)
        .maybeSingle();

      if (existingRole) {
        // Already a member — go straight to dashboard
        return res.status(200).json({ companyId: matched.company_id });
      }

      const adminName = await fetchAdminName(supabase, matched.company_id);
      await notifyClaimedDomain(matched.company_id, matched.company_name);
      return res.status(200).json({
        companyExists:      true,
        matchedCompanyId:   matched.company_id,
        matchedCompanyName: matched.company_name,
        adminName,
      });
    }

    const companyId = randomUUID();
    const now = new Date().toISOString();

    // ── 3. Create companies row ───────────────────────────────────────────────
    // website_domain: normalised domain from the website URL (e.g. "drishiq.com"
    //   from "www.drishiq.com"). Used for fast indexed lookup when a new user
    //   from the same domain signs up independently.
    // admin_email_domain: fallback for companies created without a real website.
    const websiteDomain = (() => {
      const d = extractDomain(canonicalWebsite);
      return d && !isFreeEmailDomain(d) ? d : null;
    })();
    const adminEmailDomain = (() => {
      const d = extractDomain(user.email ?? '');
      return d && !isFreeEmailDomain(d) ? d : null;
    })();

    // ── STEP 1: Domain-first lookup — prevent duplicate companies per domain ──
    // Check website_domain first (www. is stripped so omnivyra.com and
    // www.omnivyra.com resolve to the same record), then admin_email_domain.
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
        // Check if this user is already a member — if so, just return the company.
        const { data: existingRole } = await supabase
          .from('user_company_roles')
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
              .from('user_company_roles')
              .update({ status: 'active', accepted_at: now, updated_at: now })
              .eq('id', role.id);
          }
          await supabase
            .from('users')
            .update({ active_company_id: domainCompany.id, updated_at: new Date().toISOString() })
            .eq('id', user.id);
          return res.status(200).json({ companyId: domainCompany.id });
        }

        // Not a member — do NOT auto-join. Only the first user creates the
        // company; everyone else must be invited by the company admin.
        const adminName = await fetchAdminName(supabase, domainCompany.id);
        await notifyClaimedDomain(domainCompany.id, domainCompany.name);
        return res.status(200).json({
          companyExists:      true,
          matchedCompanyId:   domainCompany.id,
          matchedCompanyName: domainCompany.name,
          adminName,
        });
      }
    }

    // ── Rule 4: the work-email domain must HOST A LIVE WEBSITE on itself ──────
    // (not email/DNS forwarding, not a redirect to another domain). This is
    // the gate that lets the FIRST user of a domain create the company. It
    // runs only here — once the domain is claimed the branches above have
    // already returned, and invited / public-email users never reach this.
    // resolveDomain is SSRF-hardened and fail-closed: any DNS/timeout/fetch
    // failure → resolution_failed, which we treat as "no hosted website".
    if (adminEmailDomain) {
      if (clientIp) {
        const rl = await checkRateLimit(clientIp, DOMAIN_RESOLUTION_LIMIT);
        if (!rl.allowed) {
          return res.status(429).json({
            code:  'DOMAIN_RESOLUTION_FAILED',
            error: 'Too many domain verification attempts. Please try again in a few minutes.',
          });
        }
      }

      let resolution;
      try {
        resolution = await resolveDomain(adminEmailDomain);
      } catch (err) {
        void logDomainEvent({
          event_type:   'DOMAIN_RESOLUTION_FAILED',
          company_id:   null,
          final_domain: adminEmailDomain,
          user_id:      user.id,
          metadata:     { reason: 'threw', message: err instanceof Error ? err.message : String(err) },
        });
        return res.status(503).json({
          code:  'DOMAIN_RESOLUTION_FAILED',
          error: 'We could not verify that your company domain hosts a live website. Please try again shortly.',
        });
      }

      if (resolution.resolution_failed || resolution.resolution_blocked) {
        void logDomainEvent({
          event_type:   resolution.resolution_blocked ? 'DOMAIN_RESOLUTION_BLOCKED' : 'DOMAIN_RESOLUTION_FAILED',
          company_id:   null,
          final_domain: adminEmailDomain,
          user_id:      user.id,
          metadata:     { reason: resolution.resolution_blocked ? 'ssrf_or_rebind' : 'fail_closed' },
        });
        return res.status(httpStatusFor('DOMAIN_NOT_CANONICAL')).json({
          code:  'DOMAIN_NOT_CANONICAL',
          error: ELIGIBILITY_MESSAGES.DOMAIN_NOT_CANONICAL,
        });
      }

      if (resolution.input_domain !== resolution.final_domain) {
        void logDomainEvent({
          event_type:   'DOMAIN_NOT_CANONICAL',
          company_id:   null,
          final_domain: resolution.final_domain,
          user_id:      user.id,
          metadata:     { input_domain: resolution.input_domain, is_forwarding: resolution.is_forwarding },
        });
        return res.status(httpStatusFor('DOMAIN_NOT_CANONICAL')).json({
          code:  'DOMAIN_NOT_CANONICAL',
          error: ELIGIBILITY_MESSAGES.DOMAIN_NOT_CANONICAL,
        });
      }

      if (resolution.is_forwarding) {
        void logDomainEvent({
          event_type:   'DOMAIN_FORWARDING_BLOCKED',
          company_id:   null,
          final_domain: resolution.final_domain,
          user_id:      user.id,
          metadata:     { input_domain: resolution.input_domain },
        });
        return res.status(httpStatusFor('FORWARDING_DOMAIN')).json({
          code:  'FORWARDING_DOMAIN',
          error: ELIGIBILITY_MESSAGES.FORWARDING_DOMAIN,
        });
      }
    }

    const { error: companyErr } = await supabase.from('companies').insert({
      id:                 companyId,
      name:               companyName.trim(),
      website:            canonicalWebsite || companyId, // NOT NULL — use companyId as placeholder if blank
      industry:           profileIndustry || null,
      size:               companySize.trim() || null,
      status:             'active',
      website_domain:     websiteDomain,
      admin_email_domain: adminEmailDomain,
      domain_claimed_at:  adminEmailDomain ? now : null, // STEP 5
      created_at:         now,
    });

    // ── Race condition: another request won the domain UNIQUE race ────────────
    if (companyErr?.code === '23505' && adminEmailDomain) {
      const { data: raceWinner } = await supabase
        .from('companies')
        .select('id, name')
        .eq('admin_email_domain', adminEmailDomain)
        .maybeSingle();

      if (raceWinner) {
        // Another concurrent request won the INSERT race for this domain.
        // Check if this user already has a membership (e.g. the winning request
        // was from the same user session) — if so, let them through.
        const { data: existingRole } = await supabase
          .from('user_company_roles')
          .select('id')
          .eq('user_id', user.id)
          .eq('company_id', raceWinner.id)
          .maybeSingle();

        if (existingRole) {
          return res.status(200).json({ companyId: raceWinner.id });
        }

        // Different user won the race — treat as existing company.
        const adminName = await fetchAdminName(supabase, raceWinner.id);
        await notifyClaimedDomain(raceWinner.id, raceWinner.name);
        return res.status(200).json({
          companyExists:      true,
          matchedCompanyId:   raceWinner.id,
          matchedCompanyName: raceWinner.name,
          adminName,
        });
      }
    }

    if (companyErr) throw companyErr;

    // ── 4. Create user_company_roles row (company admin) ─────────────────────
    const { error: roleErr } = await supabase.from('user_company_roles').insert({
      user_id:     user.id,
      company_id:  companyId,
      role:        'COMPANY_ADMIN',
      status:      'active',
      join_source: SELF_REGISTERED_JOIN_SOURCE,
      created_at:  now,
      updated_at:  now,
    });
    if (roleErr) throw roleErr;

    // Canonical authority: user_company_roles (just inserted above) +
    // users.active_company_id. users.role / users.company_id deprecated.
    await supabase
      .from('users')
      .update({ active_company_id: companyId, onboarding_state: 'company_complete', updated_at: now })
      .eq('id', user.id);

    // ── 5. Create company_profiles row ────────────────────────────────────────
    let discoveredSocialProfile: any = {};
    if (canonicalWebsite) {
      try {
        const crawlResult = await crawlWebsiteSources(canonicalWebsite, new Set());
        discoveredSocialProfile = mergeDiscoveredSocialProfiles(
          { company_id: companyId, website_url: canonicalWebsite } as any,
          crawlResult.social_links,
        );
      } catch (error) {
        console.warn('[setup-company] initial social crawl failed:', error);
      }
    }

    // PART A — upsert (not insert) so a profile row that was auto-created by a
    // concurrent path (e.g. a profile read during the social crawl) gets the
    // validated canonical website instead of silently conflicting and leaving
    // website_url NULL. onConflict keeps a single source of truth at creation.
    await supabase.from('company_profiles').upsert({
      company_id:  companyId,
      name:        companyName.trim(),
      website_url: canonicalWebsite || null,
      industry:    profileIndustry || null,
      geography:   null,
      linkedin_url: discoveredSocialProfile.linkedin_url ?? null,
      facebook_url: discoveredSocialProfile.facebook_url ?? null,
      instagram_url: discoveredSocialProfile.instagram_url ?? null,
      x_url: discoveredSocialProfile.x_url ?? null,
      youtube_url: discoveredSocialProfile.youtube_url ?? null,
      tiktok_url: discoveredSocialProfile.tiktok_url ?? null,
      reddit_url: discoveredSocialProfile.reddit_url ?? null,
      pinterest_url: discoveredSocialProfile.pinterest_url ?? null,
      whatsapp_url: discoveredSocialProfile.whatsapp_url ?? null,
      other_social_links: discoveredSocialProfile.other_social_links ?? null,
      social_profiles: discoveredSocialProfile.social_profiles ?? null,
      report_settings: {
        default_inputs: {
          company_name: companyName.trim(),
          website_domain: websiteDomain,
          canonical_website_source: emailDerivedWebsite ? 'email_domain' : 'user_input',
          business_type: businessTypeText || null,
          industry: profileIndustry || null,
        },
        market_pulse: {
          business_model: businessTypeText || null,
          provider_type: businessTypeText || null,
          updated_at: now,
        },
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
    }, { onConflict: 'company_id' });
    // Non-fatal if profile insert fails — company + role are sufficient

    // ── 6. Update free_credit_profiles with org_id (if exists) ───────────────
    await supabase
      .from('free_credit_profiles')
      .update({ organization_id: companyId, updated_at: now })
      .eq('user_id', user.id);

    // ── 7. Grant initial free credits via the single shared service ─────────
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
      // Non-fatal — company is still created
    }

    // ── 8. Mark profile_complete in setup progress ────────────────────────────
    await supabase.from('company_setup_progress').upsert(
      { company_id: companyId, profile_complete: true, updated_at: now },
      { onConflict: 'company_id' },
    );

    // ── 9. Process referral — grant +200 to referrer if valid ─────────────────
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
