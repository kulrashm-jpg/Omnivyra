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
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import {
  findMatchingCompany,
  notifyCompanyAdminsOfSelfJoin,
  extractDomain,
  isFreeEmailDomain,
} from '../../../backend/services/companyMatchService';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { createCredit, makeIdempotencyKey } from '../../../backend/services/creditExecutionService';

type Result =
  | { companyId: string; selfJoined?: boolean; matchedCompanyName?: string }
  | { code: string; error: string; limit?: number; current?: number | null }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Result>) {
  if (req.method !== 'POST') return res.status(405).end();

  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });

  // Verify token with anon client, then use service role for table writes
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  // Service role bypasses RLS — required for inserts into companies,
  // user_company_roles, company_profiles, and free_credit_profiles.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    companyName = '',
    website     = '',
    industry    = '',
    companySize = '',
  } = body as {
    companyName?: string;
    website?: string;
    industry?: string;
    companySize?: string;
  };

  if (!companyName.trim()) return res.status(400).json({ error: 'companyName is required' });

  // ── Domain eligibility gate ───────────────────────────────────────────────
  if (user.email) {
    const eligibility = await checkDomainEligibility(user.email, user.id);
    if (eligibility.status === 'blocked') {
      return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
    }

    // Public email domain — allowed only via invite or approved access request.
    // Cannot create a company or receive free credits.
    if (eligibility.reason === 'public_provider') {
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
    const { data: existing } = await supabase
      .from('user_company_roles')
      .select('company_id')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existing?.company_id) {
      return res.status(200).json({ companyId: existing.company_id });
    }

    // ── 3. Check if a matching company already exists in the system ───────────
    const matched = await findMatchingCompany({
      companyName: companyName.trim(),
      website: website.trim() || null,
      userEmail: user.email ?? null,
    });

    if (matched) {
      // User's company already exists — add them as CONTENT_CREATOR (self-joined)
      const now = new Date().toISOString();

      // Idempotent: skip if already a member
      const { data: existingRole } = await supabase
        .from('user_company_roles')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', matched.company_id)
        .maybeSingle();

      if (!existingRole) {
        const { error: roleErr } = await supabase.from('user_company_roles').insert({
          user_id:     user.id,
          company_id:  matched.company_id,
          role:        'CONTENT_CREATOR',
          status:      'active',
          join_source: 'self_joined',
          created_at:  now,
          updated_at:  now,
          invited_at:  now,
        });
        if (roleErr) throw roleErr;
      }

      // Update free_credit_profiles with the org_id
      await supabase
        .from('free_credit_profiles')
        .update({ organization_id: matched.company_id, updated_at: now })
        .eq('user_id', user.id);

      // Notify all company admins (non-fatal)
      try {
        await notifyCompanyAdminsOfSelfJoin({
          companyId: matched.company_id,
          companyName: matched.company_name,
          newUserId: user.id,
          newUserEmail: user.email ?? null,
          matchType: matched.match_type,
        });
      } catch (notifyErr: any) {
        console.warn('[setup-company] admin notification failed:', notifyErr?.message);
      }

      return res.status(200).json({
        companyId: matched.company_id,
        selfJoined: true,
        matchedCompanyName: matched.company_name,
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
      const d = extractDomain(website.trim());
      return d && !isFreeEmailDomain(d) ? d : null;
    })();
    const adminEmailDomain = (() => {
      const d = extractDomain(user.email ?? '');
      return d && !isFreeEmailDomain(d) ? d : null;
    })();

    // ── STEP 1: Domain-first lookup — prevent duplicate companies per domain ──
    // If a company already exists for this admin email domain, route to self-join
    // instead of creating a second company. Handles both the pre-check (common
    // path) and the post-insert race (rare path via unique violation below).
    if (adminEmailDomain) {
      const { data: domainCompany } = await supabase
        .from('companies')
        .select('id, name')
        .eq('admin_email_domain', adminEmailDomain)
        .maybeSingle();

      if (domainCompany) {
        // Domain is already claimed — join the existing company instead
        const domainNow = new Date().toISOString();
        const { data: existingRole } = await supabase
          .from('user_company_roles')
          .select('id')
          .eq('user_id', user.id)
          .eq('company_id', domainCompany.id)
          .maybeSingle();

        if (!existingRole) {
          await supabase.from('user_company_roles').insert({
            user_id:     user.id,
            company_id:  domainCompany.id,
            role:        'CONTENT_CREATOR',
            status:      'active',
            join_source: 'self_joined',
            created_at:  domainNow,
            updated_at:  domainNow,
            invited_at:  domainNow,
          });
        }

        await supabase
          .from('free_credit_profiles')
          .update({ organization_id: domainCompany.id, updated_at: domainNow })
          .eq('user_id', user.id);

        try {
          await notifyCompanyAdminsOfSelfJoin({
            companyId:    domainCompany.id,
            companyName:  domainCompany.name,
            newUserId:    user.id,
            newUserEmail: user.email ?? null,
            matchType:    'admin_email_domain',
          });
        } catch (notifyErr: any) {
          console.warn('[setup-company] domain self-join notification failed:', notifyErr?.message);
        }

        return res.status(200).json({
          companyId:          domainCompany.id,
          selfJoined:         true,
          matchedCompanyName: domainCompany.name,
        });
      }
    }

    const { error: companyErr } = await supabase.from('companies').insert({
      id:                 companyId,
      name:               companyName.trim(),
      website:            website.trim() || companyId, // NOT NULL — use companyId as placeholder if blank
      industry:           industry.trim() || null,
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
        const raceNow = new Date().toISOString();
        const { data: existingRole } = await supabase
          .from('user_company_roles')
          .select('id')
          .eq('user_id', user.id)
          .eq('company_id', raceWinner.id)
          .maybeSingle();

        if (!existingRole) {
          await supabase.from('user_company_roles').insert({
            user_id:     user.id,
            company_id:  raceWinner.id,
            role:        'CONTENT_CREATOR',
            status:      'active',
            join_source: 'self_joined',
            created_at:  raceNow,
            updated_at:  raceNow,
            invited_at:  raceNow,
          });
        }

        await supabase
          .from('free_credit_profiles')
          .update({ organization_id: raceWinner.id, updated_at: raceNow })
          .eq('user_id', user.id);

        return res.status(200).json({
          companyId:          raceWinner.id,
          selfJoined:         true,
          matchedCompanyName: raceWinner.name,
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
      join_source: 'invited',
      created_at:  now,
      updated_at:  now,
      invited_at:  now,
    });
    if (roleErr) throw roleErr;

    // ── 5. Create company_profiles row ────────────────────────────────────────
    await supabase.from('company_profiles').insert({
      company_id:  companyId,
      name:        companyName.trim(),
      website_url: website.trim() || null,
      industry:    industry.trim() || null,
      geography:   companySize.trim() || null, // repurpose for team size hint
      created_at:  now,
      updated_at:  now,
    });
    // Non-fatal if profile insert fails — company + role are sufficient

    // ── 6. Update free_credit_profiles with org_id (if exists) ───────────────
    await supabase
      .from('free_credit_profiles')
      .update({ organization_id: companyId, updated_at: now })
      .eq('user_id', user.id);

    // ── 7. Retroactively grant pending free credits ───────────────────────────
    // onboarding/complete runs BEFORE setup-company, so orgId is null when
    // credits are first attempted. Grant them now that the org exists.
    const { data: pendingProfile } = await supabase
      .from('free_credit_profiles')
      .select('id, initial_credits, credit_expiry_at')
      .eq('user_id', user.id)
      .maybeSingle();

    if (pendingProfile?.initial_credits) {
      // ── STEP 2: One free credit grant per domain ──────────────────────────
      // Block the grant if any other org on the same admin_email_domain has
      // already received an initial credit grant.
      let domainAlreadyClaimed = false;
      if (adminEmailDomain) {
        const { data: domainSiblings } = await supabase
          .from('companies')
          .select('id')
          .eq('admin_email_domain', adminEmailDomain)
          .neq('id', companyId);

        const siblingIds = (domainSiblings ?? []).map((r: any) => r.id);
        if (siblingIds.length > 0) {
          const { data: siblingClaim } = await supabase
            .from('free_credit_claims')
            .select('id')
            .eq('category', 'initial')
            .in('organization_id', siblingIds)
            .limit(1)
            .maybeSingle();
          domainAlreadyClaimed = !!siblingClaim;
        }
      }

      const { data: existingClaim } = await supabase
        .from('free_credit_claims')
        .select('id, organization_id')
        .eq('user_id', user.id)
        .eq('category', 'initial')
        .maybeSingle();

      if (!existingClaim && !domainAlreadyClaimed) {
        // ── STEP 4: Read initial credit amount from config with fallback ──
        const { data: config } = await supabase
          .from('free_credit_config')
          .select('credits, expiry_days')
          .eq('category', 'initial')
          .eq('is_active', true)
          .maybeSingle();
        const creditAmount  = (config as any)?.credits   ?? pendingProfile.initial_credits;
        const expiryDays    = (config as any)?.expiry_days ?? 14;
        const expiryAt      = new Date(Date.now() + expiryDays * 86400 * 1000).toISOString();
        const expiryNote    = ` (expires ${expiryAt.slice(0, 10)})`;

        try {
          await createCredit({
            orgId:          companyId,
            amount:         creditAmount,
            category:       'free',
            referenceType:  'free_credits',
            referenceId:    companyId,                       // STEP 3: org-scoped referenceId
            note:           `Free credits — onboarding${expiryNote}`,
            performedBy:    user.id,
            // STEP 3: org-scoped idempotency key — same key regardless of which
            // user triggers the grant for this org.
            idempotencyKey: makeIdempotencyKey(companyId, 'initial_free_credit', companyId),
          });
          await supabase.from('free_credit_claims').insert({
            user_id:         user.id,
            organization_id: companyId,
            category:        'initial',
            credits_granted: creditAmount,
            domain:          adminEmailDomain,   // domain-level UNIQUE enforcement
          });
        } catch (creditErr: any) {
          console.error('[setup-company] credit grant failed:', creditErr.message);
          // Non-fatal — company is still created
        }
      } else if (existingClaim && !existingClaim.organization_id) {
        // Claim was logged without an org — backfill the org reference and domain
        await supabase
          .from('free_credit_claims')
          .update({ organization_id: companyId, domain: adminEmailDomain })
          .eq('user_id', user.id)
          .eq('category', 'initial');
        // Grant credits (skipped earlier because orgId was null); idempotent if already granted
        try {
          await createCredit({
            orgId:          companyId,
            amount:         pendingProfile.initial_credits,
            category:       'free',
            referenceType:  'free_credits',
            referenceId:    companyId,
            note:           `Free credits — onboarding retroactive`,
            performedBy:    user.id,
            idempotencyKey: makeIdempotencyKey(companyId, 'initial_free_credit', companyId),
          });
        } catch (creditErr: any) {
          console.error('[setup-company] retroactive credit grant failed:', creditErr.message);
        }
      }
    }

    return res.status(200).json({ companyId });
  } catch (err: any) {
    console.error('[onboarding/setup-company]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
