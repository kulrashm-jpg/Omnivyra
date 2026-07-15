import { createApiRoute as __createApiRoute } from '../../../lib/platform/routeFactory';

/**
 * POST /api/onboarding/complete
 *
 * Called from /onboarding/profile after Supabase auth to:
 *  1. Ensure user row exists in public.users
 *  2. Create or find company
 *  3. Create free_credit_profiles row
 *  4. Grant 300 initial credits via creditExecutionService
 *  5. Log the 'initial' claim in free_credit_claims
 *
 * Body:
 *  {
 *    fullName?:         string
 *    jobTitle?:         string
 *    industry?:         string
 *    intentGoals?:      string[]
 *    intentTeam?:       string
 *    intentChallenges?: string[]
 *  }
 *
 * Auth: Supabase access token in Authorization: Bearer <token>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabase as supabaseAdmin } from '../../../backend/db/supabaseClient';
import { resolveAuthenticatedUser } from '../../../backend/services/authResolver';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { reviewableResults } from '../../../lib/auth/domainEligibilityModel';
import {
  grantInitialFreeCredit,
  INITIAL_FREE_CREDIT_CATEGORY,
  INITIAL_FREE_CREDIT_DEFAULT,
  INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT,
} from '../../../backend/services/initialFreeCreditService';
import { checkRateLimit, ONBOARDING_COMPLETE_LIMIT, ONBOARDING_UID_LIMIT } from '../../../lib/auth/rateLimit';
import {
  emitSignupEvent,
  ensureSignupCorrelationId,
  requestUserAgent,
} from '../../../backend/services/signupEventService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limiting (IP) ────────────────────────────────────────────────────
  const ip = String(
    req.headers['x-forwarded-for'] ?? (req.socket as any)?.remoteAddress ?? 'unknown'
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, ONBOARDING_COMPLETE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await resolveAuthenticatedUser(req);
  if (authResult.error || !authResult.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  const supabaseUid: string = authResult.user.supabaseUid;
  const authEmail:   string = authResult.user.email;

  // ── App-level email-verification gate (AUTH-001 §1) ──────────────────────
  // This endpoint creates users/companies and grants credits — none of that
  // may happen for a session whose auth identity is unconfirmed.
  if (!authResult.user.emailVerified) {
    return res.status(403).json({ error: 'Please verify your email address first.', code: 'EMAIL_NOT_VERIFIED' });
  }

  // ── Post-auth UID rate limit ──────────────────────────────────────────────
  const rlUid = await checkRateLimit(supabaseUid, ONBOARDING_UID_LIMIT);
  if (!rlUid.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  // Journey correlation (AUTH-001 §10).
  const signupCorrelationId = await ensureSignupCorrelationId(authEmail);

  const supabase = supabaseAdmin;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const {
    fullName         = '',
    jobTitle         = '',
    industry         = '',
    intentGoals      = [],
    intentTeam       = '',
    intentChallenges = [],
  } = body as {
    fullName?:         string;
    jobTitle?:         string;
    industry?:         string;
    intentGoals?:      string[];
    intentTeam?:       string;
    intentChallenges?: string[];
  };

  try {
    // ── 0. Resolve user row ─────────────────────────────────────────────────
    const { data: userRow } = await supabase
      .from('users')
      .select('id, is_deleted')
      .or(`supabase_uid.eq.${supabaseUid},email.eq.${authEmail.toLowerCase()}`)
      .maybeSingle();

    if (userRow && (userRow as any).is_deleted) {
      return res.status(403).json({ error: 'ACCOUNT_DELETED', code: 'AUTH_001' });
    }

    let userId: string | null = (userRow as any)?.id ?? null;

    // ── 0a. Create user row if missing ─────────────────────────────────────
    if (!userId) {
      const { data: inserted } = await supabase
        .from('users')
        .insert({ supabase_uid: supabaseUid, email: authEmail.toLowerCase(), is_email_verified: true })
        .select('id')
        .maybeSingle();
      userId = (inserted as any)?.id ?? null;

      if (!userId) {
        // Might have been created concurrently — look up by email
        const { data: byEmail } = await supabase
          .from('users').select('id').eq('email', authEmail.toLowerCase()).maybeSingle();
        userId = (byEmail as any)?.id ?? null;
      }
    }

    if (!userId) {
      console.error('[onboarding/complete] could not resolve userId for', supabaseUid);
      return res.status(500).json({ error: 'Could not resolve user account. Please sign out and sign in again.' });
    }

    // ── 0b. Update name / job title ─────────────────────────────────────────
    await supabase.from('users').update({
      ...(fullName ? { name: fullName, job_title: jobTitle || null } : {}),
      supabase_uid: supabaseUid,
      updated_at:   new Date().toISOString(),
    }).eq('id', userId);

    // ── 1. (no-op) Initial credit amount + expiry are now resolved by the
    //         shared grantInitialFreeCredit() service from
    //         free_credit_config + the canonical defaults (300 / 30 days).
    //         Kept here only so downstream free_credit_profiles inserts and
    //         the response payload have an authoritative expected amount.
    //         AUTH-001 §12: fallbacks now share the service's exported
    //         constants instead of the stale 50/14 copies that could record
    //         a different amount than what was actually granted.
    const { data: creditConfig } = await supabase
      .from('free_credit_config')
      .select('credits, expiry_days')
      .eq('category', INITIAL_FREE_CREDIT_CATEGORY)
      .eq('is_active', true)
      .maybeSingle();
    const initialCredits = (creditConfig as { credits?: number } | null)?.credits ?? INITIAL_FREE_CREDIT_DEFAULT;
    const expiryDays     = (creditConfig as { expiry_days?: number } | null)?.expiry_days ?? INITIAL_FREE_CREDIT_EXPIRY_DAYS_DEFAULT;
    const expiryAt       = new Date(Date.now() + expiryDays * 86400 * 1000).toISOString();

    // ── 2. Domain eligibility ───────────────────────────────────────────────
    if (authEmail) {
      const eligibility = await checkDomainEligibility(authEmail, userId);
      if (!eligibility.eligible && !reviewableResults.has(eligibility.result)) {
        return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
      }

      // Public email (Gmail etc.) — only allowed via invite or approved access request
      if (eligibility.result === 'PUBLIC_EMAIL') {
        const { data: invite } = await supabase
          .from('user_company_roles')
          .select('id, company_id, role')
          .eq('user_id', userId)
          .eq('status', 'invited')
          .limit(1)
          .maybeSingle();

        const { data: accessRequest } = await supabase
          .from('access_requests')
          .select('id, organization_id')
          .eq('email', authEmail.toLowerCase())
          .eq('status', 'approved')
          .not('organization_id', 'is', null)
          .limit(1)
          .maybeSingle();

        if (!invite && !accessRequest) {
          return res.status(403).json({ code: 'INVITE_REQUIRED', error: 'You can only join via an organization invite' });
        }

        return res.status(200).json({
          success:    true,
          inviteOnly: true,
          companyId:  (invite as any)?.company_id ?? (accessRequest as any)?.organization_id,
        });
      }
    }

    // ── 3. Get or create company ────────────────────────────────────────────
    const emailDomain    = authEmail.includes('@') ? authEmail.split('@')[1].toLowerCase() : '';
    const finalCompanyName = emailDomain ? emailDomain.split('.')[0] : 'Company';

    let companyId: string | null = null;

    const { data: existingCompanies } = await supabase
      .from('companies')
      .select('id')
      .ilike('name', finalCompanyName)
      .limit(1);

    if (existingCompanies && existingCompanies.length > 0) {
      companyId = existingCompanies[0].id;
    } else {
      const website = emailDomain ? `https://${emailDomain}` : 'https://example.com';
      const { data: newCompany, error: createError } = await supabase
        .from('companies')
        .insert({
          name:               finalCompanyName,
          website,
          admin_email_domain: emailDomain || null,
          industry:           industry || null,
          created_at:         new Date().toISOString(),
        })
        .select('id')
        .single();

      if (createError) {
        console.error('[onboarding/complete] company creation failed:', createError.message);
        return res.status(500).json({ error: 'Could not create company' });
      }
      companyId = newCompany.id;

      await supabase.from('company_profiles').upsert({
        company_id:  companyId,
        name:        finalCompanyName,
        website_url: website,
        industry:    industry || null,
        created_at:  new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      }, { onConflict: 'company_id', ignoreDuplicates: true });
    }

    // ── 4. Upsert free_credit_profiles ─────────────────────────────────────
    const { data: existingProfile } = await supabase
      .from('free_credit_profiles')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existingProfile) {
      const { error: profileErr } = await supabase.from('free_credit_profiles').insert({
        user_id:            userId,
        organization_id:    companyId,
        acquisition_source: 'onboarding',
        initial_credits:    initialCredits,
        credit_expiry_at:   expiryAt,
        intent_goals:       intentGoals,
        intent_team:        intentTeam,
        intent_challenges:  intentChallenges,
      });
      if (profileErr) {
        if (profileErr.code === '23505') {
          return res.status(409).json({ error: 'This account has already claimed free credits.' });
        }
        throw profileErr;
      }
    }

    // ── 5. Check if credits already claimed for this company (org-level dedup) ─
    // Block 2nd-and-beyond self-registrations to a previously credited company.
    // (DB enforces one-per-org via the UNIQUE index on free_credit_claims for
    // category='initial_free_credit' — this app-layer check just gives a
    // friendlier 403 than letting the constraint fire.)
    const { data: orgClaim } = await supabase
      .from('free_credit_claims')
      .select('id, user_id')
      .eq('organization_id', companyId)
      .eq('category', INITIAL_FREE_CREDIT_CATEGORY)
      .maybeSingle();

    if (orgClaim && (orgClaim as { user_id: string }).user_id !== userId) {
      return res.status(403).json({
        code:  'INVITE_REQUIRED',
        error: 'This company is already registered. Ask your company admin to invite you.',
      });
    }

    // ── 6. Ensure company role — first registrant gets COMPANY_ADMIN ─────────
    const { data: existingMembership } = await supabase
      .from('user_company_roles')
      .select('id, role')
      .eq('user_id', userId)
      .eq('company_id', companyId)
      .maybeSingle();

    if (!existingMembership) {
      await supabase.from('user_company_roles').insert({
        user_id:    userId,
        company_id: companyId,
        role:       'COMPANY_ADMIN',
        status:     'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    // ── 7. Grant initial free credits via the single shared service ─────────
    const orgId = companyId!;
    const claimDomain = authEmail.includes('@') ? authEmail.split('@')[1].toLowerCase() : null;
    const grantResult = await grantInitialFreeCredit({
      orgId,
      userId,
      emailDomain: claimDomain,
    });

    if (grantResult.granted === false && grantResult.reason === 'grant_failed') {
      await emitSignupEvent({
        event: 'SystemFailure', outcome: 'denied',
        correlationId: signupCorrelationId,
        email: authEmail, userId, companyId: orgId,
        reason: 'CREDIT_GRANT_FAILED', ip, userAgent: requestUserAgent(req),
      });
      return res.status(500).json({
        error: grantResult.message ?? 'Could not grant free credits. Please try again in a moment.',
        code:  'CREDIT_GRANT_FAILED',
      });
    }

    // ── 8. Stamp active_company_id + onboarding_state ───────────────────────
    // Canonical role authority is user_company_roles (already written
    // upstream). users.role / users.company_id are deprecated and no longer
    // written here.
    await supabase
      .from('users')
      .update({ active_company_id: orgId, onboarding_state: 'company_complete' })
      .eq('id', userId);

    if (grantResult.granted) {
      // Canonical journey events (AUTH-001 §9).
      await emitSignupEvent({
        event: 'CreditsGranted', outcome: 'allowed',
        correlationId: signupCorrelationId,
        email: authEmail, userId, companyId: orgId,
        reason: `initial_free_credit credits=${grantResult.credits}`,
        ip, userAgent: requestUserAgent(req),
      });
      await emitSignupEvent({
        event: 'OnboardingCompleted', outcome: 'allowed',
        correlationId: signupCorrelationId,
        email: authEmail, userId, companyId: orgId,
        reason: 'onboarding_state=company_complete', ip, userAgent: requestUserAgent(req),
      });
      return res.status(200).json({
        success:        true,
        credits:        grantResult.credits,
        expiresAt:      grantResult.expiresAt,
        alreadyClaimed: false,
      });
    }

    // already_claimed for this same user (idempotent re-submit)
    return res.status(200).json({
      success:        true,
      credits:        initialCredits,
      expiresAt:      expiryAt,
      alreadyClaimed: true,
    });
  } catch (err: any) {
    console.error('[onboarding/complete]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}

// W0-1 (Gate A): canonical route pipeline — pass-through observability + request context.
export default __createApiRoute(handler, { route: '/api/onboarding/complete' });
