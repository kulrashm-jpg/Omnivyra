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
import { verifySupabaseAuthHeader } from '../../../lib/auth/serverValidation';
import { checkDomainEligibility } from '../../../backend/services/domainEligibilityService';
import { createCredit, makeIdempotencyKey } from '../../../backend/services/creditExecutionService';
import { checkRateLimit, ONBOARDING_COMPLETE_LIMIT, ONBOARDING_UID_LIMIT } from '../../../lib/auth/rateLimit';

const INITIAL_CREDITS_DEFAULT = 300;
const EXPIRY_DAYS_DEFAULT     = 14;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limiting (IP) ────────────────────────────────────────────────────
  const ip = String(
    req.headers['x-forwarded-for'] ?? (req.socket as any)?.remoteAddress ?? 'unknown'
  ).split(',')[0].trim();
  const rl = await checkRateLimit(ip, ONBOARDING_COMPLETE_LIMIT);
  if (!rl.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  let supabaseUid: string;
  let authEmail:   string;
  try {
    const verified = await verifySupabaseAuthHeader(req.headers.authorization);
    supabaseUid = verified.id;
    authEmail   = verified.email;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // ── Post-auth UID rate limit ──────────────────────────────────────────────
  const rlUid = await checkRateLimit(supabaseUid, ONBOARDING_UID_LIMIT);
  if (!rlUid.allowed) return res.status(429).json({ error: 'Too many requests. Please try again later.' });

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

    // ── 1. Load credit config ───────────────────────────────────────────────
    const { data: creditConfig } = await supabase
      .from('free_credit_config')
      .select('credits, expiry_days')
      .eq('category', 'initial')
      .eq('is_active', true)
      .maybeSingle();
    const initialCredits = (creditConfig as any)?.credits    ?? INITIAL_CREDITS_DEFAULT;
    const expiryDays     = (creditConfig as any)?.expiry_days ?? EXPIRY_DAYS_DEFAULT;
    const expiryAt       = new Date(Date.now() + expiryDays * 86400 * 1000).toISOString();

    // ── 2. Domain eligibility ───────────────────────────────────────────────
    if (authEmail) {
      const eligibility = await checkDomainEligibility(authEmail, userId);
      if (eligibility.status === 'blocked') {
        return res.status(403).json({ error: 'Your email domain is not eligible for free credits.' });
      }

      // Public email (Gmail etc.) — only allowed via invite or approved access request
      if (eligibility.reason === 'public_provider') {
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
    // Only the FIRST person to register for a company gets COMPANY_ADMIN + 300 credits.
    // All subsequent members must be added by COMPANY_ADMIN or SUPER_ADMIN via invite.
    const { data: orgClaim } = await supabase
      .from('free_credit_claims')
      .select('id, user_id')
      .eq('organization_id', companyId)
      .eq('category', 'initial')
      .maybeSingle();

    if (orgClaim) {
      // Company already exists and has credits — block self-registration.
      // 2nd person and beyond must be invited by COMPANY_ADMIN or SUPER_ADMIN.
      return res.status(403).json({
        code:  'INVITE_REQUIRED',
        error: 'This company is already registered. Ask your company admin to invite you.',
      });
    }

    // ── 6. Check user's own claim (same user re-submitting) ─────────────────
    const { data: existingClaim } = await supabase
      .from('free_credit_claims')
      .select('id')
      .eq('user_id', userId)
      .eq('category', 'initial')
      .maybeSingle();

    if (existingClaim) {
      return res.status(200).json({ success: true, credits: initialCredits, alreadyClaimed: true });
    }

    // ── 7. Ensure company role — first registrant gets COMPANY_ADMIN ─────────
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

    // ── 8. Grant credits ────────────────────────────────────────────────────
    const orgId = companyId!;

    await supabase.from('organization_credits').upsert({
      organization_id:    orgId,
      free_balance:       0,
      paid_balance:       0,
      incentive_balance:  0,
      lifetime_purchased: 0,
      lifetime_consumed:  0,
      credit_rate_usd:    0.001,
    }, { onConflict: 'organization_id', ignoreDuplicates: true });

    try {
      await createCredit({
        orgId,
        amount:         initialCredits,
        category:       'free',
        referenceType:  'free_credits',
        referenceId:    orgId,
        note:           `Free credits — onboarding (expires ${expiryAt.slice(0, 10)})`,
        performedBy:    userId,
        idempotencyKey: makeIdempotencyKey(orgId, 'initial_free_credit', orgId),
      });
    } catch (creditErr: any) {
      console.error('[onboarding/complete] credit grant failed:', creditErr.message);
    }

    // ── 9. Log claim ────────────────────────────────────────────────────────
    const claimDomain = authEmail.includes('@') ? authEmail.split('@')[1].toLowerCase() : null;
    await supabase.from('free_credit_claims').insert({
      user_id:         userId,
      organization_id: orgId,
      category:        'initial',
      credits_granted: initialCredits,
      domain:          claimDomain,
    });

    // ── 10. Backfill users.company_id ───────────────────────────────────────
    await supabase.from('users').update({ company_id: orgId, role: 'COMPANY_ADMIN' }).eq('id', userId);

    return res.status(200).json({ success: true, credits: initialCredits, expiresAt: expiryAt, alreadyClaimed: false });
  } catch (err: any) {
    console.error('[onboarding/complete]', err);
    return res.status(500).json({ error: err?.message ?? 'Internal server error' });
  }
}
