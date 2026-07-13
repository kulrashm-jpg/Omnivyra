
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
} from '../../../backend/services/companyMatchService';
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
import { notifyAdminAndProspectOfClaimedDomain } from '../../../backend/services/claimedDomainNotifyService';
import {
  deriveWebsiteFromEmail,
  resolveValidatedWebsite,
} from '../../../backend/services/validatedWebsiteService';
import { monitorCompanyIdentityDrift } from '../../../backend/services/companyIdentityDriftService';
import { createCompanyIdentity } from '../../../backend/services/companyIdentityWriter';
import { saveDomainRecord } from '../../../backend/services/domainRecordService';
import { checkRateLimit } from '../../../lib/auth/rateLimit';
import {
  emitSignupEvent,
  ensureSignupCorrelationId,
  requestIp,
  requestUserAgent,
} from '../../../backend/services/signupEventService';

// Phase 8: company-legitimacy validation (eligibility, live-website existence,
// canonical/forwarding) is NO LONGER performed here. It is decided ONCE at
// signup by validateCompanyIdentity and consumed via the validated identity on
// the signup intent. setup-company retains ONLY auth, membership, duplicate-
// company, race-protection, invite routing, and credit logic.

type Result =
  | { companyId: string; selfJoined?: boolean; matchedCompanyName?: string }
  | { companyExists: true; matchedCompanyId: string; matchedCompanyName: string; adminName: string | null }
  | { code: string; error: string; limit?: number; current?: number | null }
  | { error: string };

// Website-resolution helpers now live in backend/services/validatedWebsiteService.ts
// (single source shared with the onboarding /validated-identity endpoint so the
// website shown in onboarding is byte-identical to what is persisted here).

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

  // ── Rate limiting (AUTH-001 §4) — this endpoint creates companies and
  // grants credits; previously it had no rate limit at all (auth + DB
  // idempotency only). IP gate before auth, UID gate after.
  const ip = requestIp(req);
  const ipRl = await checkRateLimit(ip, { keyPrefix: 'rl:onboarding:setup-company', limit: 10, windowSecs: 3600 });
  if (!ipRl.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  const { user, error: userErr } = await getSupabaseUserFromRequest(req);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const uidRl = await checkRateLimit(user.id, { keyPrefix: 'rl:uid:setup-company', limit: 5, windowSecs: 3600 });
  if (!uidRl.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  // ── App-level email-verification gate (AUTH-001 §1) ───────────────────────
  // Company creation (and the credit grant below) must never run for a
  // session whose auth identity is unconfirmed — regardless of the Supabase
  // project's "Confirm email" dashboard setting.
  if (!user.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
  }

  // Journey correlation (AUTH-001 §10) — recovered from the signup intent.
  const signupCorrelationId = await ensureSignupCorrelationId(user.email ?? '');
  const emitCompanyEvent = (
    event: Parameters<typeof emitSignupEvent>[0]['event'],
    outcome: 'allowed' | 'denied',
    reason?: string,
    companyId?: string | null,
  ) =>
    emitSignupEvent({
      event, outcome,
      correlationId: signupCorrelationId,
      email: user.email ?? null,
      userId: user.id,
      reason: reason ?? null,
      companyId: companyId ?? null,
      ip,
      userAgent: requestUserAgent(req),
    });

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
  // CONSUME the website validated once at signup (system-of-record). No probe,
  // no existence/canonical/forwarding check happens here. Falls back to the pure
  // email-derived value, then any user-entered value, for paths without an intent.
  const { canonicalWebsite } = await resolveValidatedWebsite(user.email, {
    emailDerived: emailDerivedWebsite,
    userEntered:  website,
  });

  if (!companyName.trim()) return res.status(400).json({ error: 'companyName is required' });

  // ── Public-email routing (invite / approved access only) ──────────────────
  // No legitimacy validation here — see Phase 8 note at the imports. We classify
  // public-email purely to route invited / approved-access users to their join
  // path (they join an existing company; they never create one).
  if (user.email) {
    if (isFreeEmailDomain(extractDomain(user.email) ?? '')) {
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
      await emitCompanyEvent('CompanyExists', 'denied', 'MATCHED_EXISTING_COMPANY', matched.company_id);
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
        await emitCompanyEvent('CompanyExists', 'denied', 'DOMAIN_ALREADY_CLAIMED', domainCompany.id);
        return res.status(200).json({
          companyExists:      true,
          matchedCompanyId:   domainCompany.id,
          matchedCompanyName: domainCompany.name,
          adminName,
        });
      }
    }

    // ── Rule 4 (live-website / canonical / forwarding) REMOVED — Phase 8 ──────
    // This domain-legitimacy probe (resolveDomain) is no longer run here. The
    // FIRST user of a domain was already authoritatively validated at signup by
    // validateCompanyIdentity (live website exists, canonical, non-forwarding)
    // before the account was created. setup-company consumes that verdict and
    // never re-probes. As a result this endpoint can no longer emit
    // DOMAIN_RESOLUTION_FAILED, DOMAIN_NOT_CANONICAL, or FORWARDING_DOMAIN.

    // ── Identity write via the canonical writer (Phase 11C) ───────────────────
    // companyIdentityWriter governs website + website_domain + admin_email_domain
    // atomically (Invariants A–D): they can never be persisted as a partial pair.
    // The legacy `|| companyId` placeholder is dropped — it produced an
    // inconsistent website(set)/website_domain(null) pair and was unreachable for
    // real work-email signups (canonicalWebsite is always set there). Every other
    // column, the explicit companyId, and the 23505 race handling below are
    // unchanged; the injected insert preserves the Postgres error code.
    let companyErr: (Error & { code?: string }) | null = null;
    try {
      await createCompanyIdentity(
        {
          id:                companyId,
          name:              companyName.trim(),
          website:           canonicalWebsite || null,
          websiteDomain:     websiteDomain,
          adminEmailDomain:  adminEmailDomain,
          industry:          profileIndustry || null,
          size:              companySize.trim() || null,
          status:            'active',
          domain_claimed_at: adminEmailDomain ? now : null, // STEP 5
          created_at:        now,
        },
        {
          insertCompany: async (record) => {
            const { data, error } = await supabase
              .from('companies').insert(record).select('id').single();
            if (error) {
              const e = new Error(error.message) as Error & { code?: string };
              e.code = error.code;
              throw e;
            }
            return { id: (data as { id: string }).id };
          },
        },
      );
    } catch (err) {
      companyErr = err as Error & { code?: string };
    }

    // ── Race condition: another request won the domain UNIQUE race ────────────
    // 23505 can now fire on either partial unique index: admin_email_domain
    // (20260322) or website_domain (20260713, AUTH-001 §8). Re-resolve the
    // winner by whichever domain key we hold.
    if (companyErr?.code === '23505' && (adminEmailDomain || websiteDomain)) {
      const { data: raceWinnerByAdmin } = adminEmailDomain
        ? await supabase
            .from('companies')
            .select('id, name')
            .eq('admin_email_domain', adminEmailDomain)
            .maybeSingle()
        : { data: null };
      const { data: raceWinnerByWebsite } = !raceWinnerByAdmin && websiteDomain
        ? await supabase
            .from('companies')
            .select('id, name')
            .eq('website_domain', websiteDomain)
            .maybeSingle()
        : { data: null };
      const raceWinner = (raceWinnerByAdmin ?? raceWinnerByWebsite) as { id: string; name: string } | null;

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
        await emitCompanyEvent('CompanyExists', 'denied', 'DOMAIN_UNIQUE_RACE_LOST', raceWinner.id);
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

    // ── 4b. Canonical domain-registry dual-write (ONBOARD-001 §4) ────────────
    // The legacy companies.website_domain / admin_email_domain columns are
    // still written above (by createCompanyIdentity) for backward compatibility.
    // Here we ALSO write the canonical company_domains row via the governed
    // writer so the registry covers every self-serve company at creation time
    // — completing the migration the audit flagged. saveDomainRecord is
    // idempotent (same-company or brand-new), conflict-safe (never throws,
    // returns a structured conflict), and 'system'-attributed. Best-effort:
    // a registry write failure never blocks company creation (the backfill
    // migration + drift monitor are the safety nets).
    const registryDomain = websiteDomain ?? adminEmailDomain;
    if (registryDomain) {
      try {
        const domainResult = await saveDomainRecord({
          company_id:          companyId,
          input_domain:        registryDomain,
          final_domain:        registryDomain,
          verification_status: 'unverified',
          created_via:         'system',
          is_primary:          true,
        });
        if (!domainResult.ok && domainResult.error !== 'DOMAIN_ALREADY_CLAIMED') {
          console.warn('[setup-company] company_domains write failed (non-fatal):', domainResult.error);
        }
      } catch (e) {
        console.warn('[setup-company] company_domains write threw (non-fatal):', (e as Error)?.message ?? e);
      }
    }

    // ── 5. Create company_profiles row ────────────────────────────────────────
    // ONBOARD-001 §3/§7: the SAME root-page crawl that discovers social links
    // now also returns identity/brand/SEO metadata (favicon, logo, OG, title,
    // description, language, country, brand colour) — no second crawl. The AI
    // refinement in step 5b (getProfile autoRefine) still enriches the deeper
    // fields; this fills the cheap, deterministic ones immediately.
    let discoveredSocialProfile: any = {};
    let discoveredMetadata: import('../../../backend/services/companyProfile/websiteMetadataExtractor').DiscoveredWebsiteMetadata | null = null;
    if (canonicalWebsite) {
      try {
        const crawlResult = await crawlWebsiteSources(canonicalWebsite, new Set());
        discoveredSocialProfile = mergeDiscoveredSocialProfiles(
          { company_id: companyId, website_url: canonicalWebsite } as any,
          crawlResult.social_links,
        );
        discoveredMetadata = crawlResult.metadata;
      } catch (error) {
        console.warn('[setup-company] initial social crawl failed:', error);
      }
    }

    // Provenance (§3: "System Discovered / User Editable"). Discovered fields
    // are listed here with source='system_discovered' and stored inside
    // report_settings.discovered_metadata (below) — NOT in the field_confidence
    // column, which is owned by the AI refiner (step 5b) and must not be
    // pre-seeded lest it perturb the refiner's replacement logic. The existing
    // user_locked_fields mechanism governs user edits (User Editable), so
    // nothing here is ever overwritten once a user touches it.
    const systemDiscoveredFields: string[] = [];
    if (discoveredMetadata) {
      if (discoveredMetadata.faviconUrl) systemDiscoveredFields.push('favicon_url');
      if (discoveredMetadata.logoUrl) systemDiscoveredFields.push('logo_url');
      if (discoveredMetadata.country) systemDiscoveredFields.push('geography');
      if (discoveredMetadata.description) systemDiscoveredFields.push('description');
      if (discoveredMetadata.language) systemDiscoveredFields.push('language');
      if (discoveredMetadata.brandColor) systemDiscoveredFields.push('brand_color');
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
      // §3/§7 — system-discovered brand assets + country (deterministic, from
      // the crawl HTML). AI refinement (step 5b) fills the rest and owns
      // field_confidence.
      geography:   discoveredMetadata?.country ?? null,
      logo_url:    discoveredMetadata?.logoUrl ?? null,
      favicon_url: discoveredMetadata?.faviconUrl ?? null,
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
        // §3/§7 — full system-discovered metadata bundle (description,
        // language, brand colour, OpenGraph, SEO keywords, title/site name).
        // Values without a dedicated column live here; all marked discovered.
        ...(discoveredMetadata ? {
          discovered_metadata: {
            source: 'system_discovered',
            discovered_at: now,
            discovered_fields: systemDiscoveredFields,
            title: discoveredMetadata.title,
            description: discoveredMetadata.description,
            site_name: discoveredMetadata.siteName,
            language: discoveredMetadata.language,
            country: discoveredMetadata.country,
            brand_color: discoveredMetadata.brandColor,
            seo_keywords: discoveredMetadata.keywords,
            open_graph: discoveredMetadata.openGraph,
            logo_url: discoveredMetadata.logoUrl,
            favicon_url: discoveredMetadata.faviconUrl,
          },
        } : {}),
      },
      created_at:  now,
      updated_at:  now,
    }, { onConflict: 'company_id' });
    // Non-fatal if profile insert fails — company + role are sufficient

    // ── 5a. Timezone capture (§3 "Timezone") ─────────────────────────────────
    // The browser sends its IANA timezone (Intl.DateTimeFormat().resolvedOptions()
    // .timeZone). Persist it to the canonical home — company_scheduler_prefs —
    // instead of the 'UTC' default. Best-effort; a bad/absent value leaves the
    // default untouched.
    const clientTimezone = String((body as { timezone?: string }).timezone ?? '').trim();
    if (clientTimezone && /^[A-Za-z]+\/[A-Za-z0-9_+\-]+$/.test(clientTimezone)) {
      await supabase.from('company_scheduler_prefs').upsert(
        { company_id: companyId, timezone: clientTimezone, updated_at: now },
        { onConflict: 'company_id' },
      ).then(({ error }) => {
        if (error) console.warn('[setup-company] timezone persist failed (non-fatal):', error.message);
      });
    }

    // ── 5b. Eager profile scoring trigger ─────────────────────────────────────
    // Profiles were previously only scored lazily, on a later getProfile()
    // autoRefine read — so a newly created profile that nothing happened to read
    // through that path kept overall_confidence=0 / last_refined_at=null forever.
    // Fire the existing refinement once at creation so the profile is scored
    // automatically. Best-effort and fully non-fatal: it never blocks the
    // onboarding response and never fails setup. Only when a website exists,
    // since extraction needs a source to produce a non-zero score.
    if (canonicalWebsite) {
      void import('../../../backend/services/companyProfileService')
        .then(({ getProfile }) => getProfile(companyId, { autoRefine: true }))
        .catch((e) =>
          console.warn('[setup-company] eager profile scoring failed (non-fatal):', (e as Error)?.message ?? e),
        );
    }

    // ── 6. Update free_credit_profiles with org_id (if exists) ───────────────
    await supabase
      .from('free_credit_profiles')
      .update({ organization_id: companyId, updated_at: now })
      .eq('user_id', user.id);

    // ── 7. Grant initial free credits via the single shared service ─────────
    // The service is idempotent at the DB layer (UNIQUE on
    // free_credit_claims.organization_id WHERE category='initial_free_credit')
    // so calling it from multiple onboarding paths is safe. Reads the amount
    // and expiry from free_credit_config; defaults to 300 / 30 days
    // (INITIAL_FREE_CREDIT_DEFAULT in initialFreeCreditService).
    const grantResult = await grantInitialFreeCredit({
      orgId: companyId,
      userId: user.id,
      emailDomain: adminEmailDomain,
    });
    if (grantResult.granted === false && grantResult.reason === 'grant_failed') {
      console.error('[setup-company] credit grant failed:', grantResult.message);
      await emitCompanyEvent('SystemFailure', 'denied', 'CREDIT_GRANT_FAILED', companyId);
      // Non-fatal — company is still created; the login-time reconciler retries.
    } else if (grantResult.granted === true) {
      await emitCompanyEvent('CreditsGranted', 'allowed', 'initial_free_credit', companyId);
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

    // ── Telemetry only: detect company-identity drift at creation (never blocks).
    monitorCompanyIdentityDrift({
      id:                 companyId,
      name:               companyName.trim(),
      website:            canonicalWebsite || null,
      website_domain:     websiteDomain,
      admin_email_domain: adminEmailDomain,
    });

    // Canonical journey events (AUTH-001 §9): company creation is also the
    // moment onboarding_state flips to 'company_complete' (step 4 above).
    await emitCompanyEvent('CompanyCreated', 'allowed', undefined, companyId);
    await emitCompanyEvent('OnboardingCompleted', 'allowed', 'onboarding_state=company_complete', companyId);

    return res.status(200).json({ companyId });
  } catch (err: any) {
    console.error('[onboarding/setup-company]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
